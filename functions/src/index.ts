/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
import { onCall, onRequest, Request } from "firebase-functions/https";
import { streamText } from "ai";
import { GoogleGenAI, FunctionDeclaration, Type, Content } from "@google/genai";
import { getRemoteConfig, type ServerConfig } from "firebase-admin/remote-config";
import { initializeApp } from "firebase-admin/app";
import { GetHdri, GetModel } from "./asset-manager";
import { mcpHandler } from "./mcp";
import { generateRequestId, logger, withRequestContext } from "./logger";
import { resolveLanguageModel, resolveProviderName } from "./ai-model-provider";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
});

// 3abc7eff92ea4a8eb4d2e4af396e1aa9 -> poly.pizza
const app = initializeApp();
const log = logger.child("index");

async function GetConfig(headers: Request): Promise<ServerConfig> {
    const remoteConfig = getRemoteConfig(app);
    const stop = log.child("config").time("fetch_remote_config");
    const template = await remoteConfig.getServerTemplate();
    const config = template.evaluate({
        platform: headers.get('Sec-CH-UA-Platform') || 'unknown',
        userAgent: headers.get('User-Agent') || 'unknown',
        acceptLanguage: headers.get('Accept-Language') || 'en-US',
        referer: headers.get('Referer') || ''
    });
    stop({ ok: true });
    return config;
}

export const mcp = onRequest({
    region: "europe-southwest1",
    timeoutSeconds: 3600
}, async (request, response) => {
    await mcpHandler(request, response);
});

export const generateContent = onCall({
    region: "europe-southwest1"
}, async (request, response) => {
    const requestId = (request.rawRequest.headers["x-request-id"] as string | undefined) ?? generateRequestId();
    return withRequestContext(requestId, { fn: "generateContent" }, async () => {
        const stop = log.child("generateContent").time("call");
        const { description } = request.data;
        if (!description) {
            stop({ ok: false, reason: "missing_description" });
            throw new Error("Prompt is required");
        }

        const config = await GetConfig(request.rawRequest);
        const prompt = config.getString("content_writter_prompt");
        const model = config.getString("content_writter_model");
        log.info("generateContent.params", {
            model,
            provider: resolveProviderName(model),
            description_chars: description.length
        });

        const aiResponse = streamText({
            model: resolveLanguageModel(model),
            system: prompt,
            prompt: description
        });
        const fullResponse: string[] = [];

        for await (const textPart of aiResponse.textStream) {
            if (request.acceptsStreaming) {
                response?.sendChunk({ content: textPart });
            }
            fullResponse.push(textPart);
        }

        const usage = await aiResponse.totalUsage;

        stop({
            ok: true,
            chunks: fullResponse.length,
            total_chars: fullResponse.join("").length,
            total_tokens: usage.totalTokens
        });
        return fullResponse;
    });
});


// Tool definitions for the LLM
/*
const getHdriTool: FunctionDeclaration = {
    name: "GetHdri",
    description: "Get an HDRI environment map URL based on descriptive tags. Use this to set realistic lighting and backgrounds for 3D scenes.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Array of descriptive tags for the HDRI environment (e.g. ['sunset', 'forest'], ['city', 'night'], ['studio', 'bright'])"
            }
        },
        required: ["tags"]
    }
};
*/

const getModelTool: FunctionDeclaration = {
    name: "GetModel",
    description: "Get a 3D model .glb url based on a search term. Use this to add objects to your 3D scene. These models are low poly",
    parameters: {
        type: Type.OBJECT,
        properties: {
            search: {
                type: Type.STRING,
                description: "Search term for the 3D model (e.g. 'cat', 'car', 'tree', 'building'), keep it short and simple."
            }
        },
        required: ["search"]
    }
};

async function executeTool(toolName: string, args: any): Promise<string> {
    switch (toolName) {
        case "GetHdri":
            return await GetHdri(args.tags);
        case "GetModel":
            return await GetModel(args.search, ai);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

export const createScene = onCall({
    region: "europe-southwest1"
}, async (request) => {
    const requestId = (request.rawRequest.headers["x-request-id"] as string | undefined) ?? generateRequestId();
    return withRequestContext(requestId, { fn: "createScene" }, async () => {
        const sceneLog = log.child("createScene");
        const stop = sceneLog.time("call");

        const { description } = request.data as { description: string };
        if (!description) {
            stop({ ok: false, reason: "missing_description" });
            throw new Error("Prompt is required");
        }

        const config = await GetConfig(request.rawRequest);
        const prompt = config.getString("three_generator_prompt");
        const model = config.getString("three_generator_model");
        sceneLog.info("scene_params", { model, description_chars: description.length, tools: ["GetModel"] });

        const initStop = sceneLog.time("gemini_call", { iteration: 0 });
        let aiResponse = await ai.models.generateContent({
            model,
            config: {
                systemInstruction: prompt,
                tools: [{ functionDeclarations: [getModelTool] }]
            },
            contents: [{ role: "user", parts: [{ text: description }] }]
        });
        initStop({ has_function_calls: Boolean(aiResponse.functionCalls?.length) });

        const conversationHistory: Content[] = [
            { role: "user", parts: [{ text: description }] }
        ];

        let toolCallTotal = 0;
        let iteration = 1;

        while (aiResponse.functionCalls && aiResponse.functionCalls.length > 0) {
            conversationHistory.push({
                role: "assistant",
                parts: aiResponse.functionCalls.map(fc => ({
                    functionCall: { name: fc.name, args: fc.args }
                }))
            });

            const toolResults = [];
            for (const functionCall of aiResponse.functionCalls) {
                toolCallTotal += 1;
                const toolStop = sceneLog.time("tool_call", { tool: functionCall.name, iteration });
                try {
                    const result = await executeTool(functionCall.name!, functionCall.args!);
                    toolResults.push({ functionResponse: { name: functionCall.name, response: { result } } });
                    toolStop({ ok: true, result_chars: typeof result === "string" ? result.length : undefined });
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unknown error";
                    toolResults.push({ functionResponse: { name: functionCall.name, response: { error: message } } });
                    toolStop({ ok: false, error: message });
                    sceneLog.warn("tool_failed", { tool: functionCall.name, error: message });
                }
            }

            conversationHistory.push({ role: "user", parts: toolResults });

            const nextStop = sceneLog.time("gemini_call", { iteration });
            aiResponse = await ai.models.generateContent({
                model,
                config: {
                    systemInstruction: prompt,
                    tools: [{ functionDeclarations: [getModelTool] }]
                },
                contents: conversationHistory
            });
            nextStop({ has_function_calls: Boolean(aiResponse.functionCalls?.length) });
            iteration += 1;
        }

        const script = aiResponse.text;
        stop({
            ok: true,
            iterations: iteration,
            tool_calls_total: toolCallTotal,
            script_chars: typeof script === "string" ? script.length : 0
        });
        return { script };
    });
});
