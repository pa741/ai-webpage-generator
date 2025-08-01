/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
// gemini api key -> AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0

import { onCall,  Request } from "firebase-functions/https";
import { GoogleGenAI, FunctionDeclaration, Type, Content, } from "@google/genai";
import { getRemoteConfig, type ServerConfig } from "firebase-admin/remote-config";
import { initializeApp } from "firebase-admin/app";
import { GetHdri, GetModel } from "./asset-manager";



const ai = new GoogleGenAI({ apiKey: "AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0" });

// 3abc7eff92ea4a8eb4d2e4af396e1aa9 -> poly.pizza
const app = initializeApp();


async function GetConfig(headers: Request): Promise<ServerConfig> {
    const remoteConfig = getRemoteConfig(app);
    console.log('Fetching remote config...');
    console.log('Remote config:', remoteConfig);
    //list methods of remoteConfig
    let methods = Object.getOwnPropertyNames(Object.getPrototypeOf(remoteConfig));
    console.log('Remote config methods:', methods);

    const template = await remoteConfig.getServerTemplate()
    console.log('Remote config template:', template);
    //await template.load();


    const config = template.evaluate({
        platform: headers.get('Sec-CH-UA-Platform') || 'unknown',
        userAgent: headers.get('User-Agent') || 'unknown',
        acceptLanguage: headers.get('Accept-Language') || 'en-US',
        referer: headers.get('Referer') || '',
    });


    return config;
}




export const generateContent = onCall({
    region: "europe-southwest1"
    //, cors:[/groots.es$/]
}, async (request, response) => {
    const { description } = request.data;
    if (!description) {
        throw new Error("Prompt is required");
    }
    const config = await GetConfig(request.rawRequest);
    const prompt = config.getString("content_writter_prompt");
    const model = config.getString("content_writter_model");

    let aiResponse = await ai.models.generateContentStream({
        model: model,
        config: {

            systemInstruction: prompt
        },
        contents: description
    });
    const fullResponse = [];

    for await (const chunk of aiResponse) {
        if (request.acceptsStreaming) {
            response?.sendChunk({
                content: chunk.text,
            });
        }
        fullResponse.push(chunk.text);
    }
    return fullResponse;

})


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

// Tool execution handler
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
    //, cors:[/groots.es$/]
}, async (request, response) => {
    const { description } = request.data as { description: string };
    if (!description) {
        throw new Error("Prompt is required");
    }
    const config = await GetConfig(request.rawRequest);
    const prompt = config.getString("three_generator_prompt");
    const model = config.getString("three_generator_model");
    //print tools
    console.log("Available tools:", [getModelTool]);

    // Initial AI request with tools available
    let aiResponse = await ai.models.generateContent({
        model: model,
        config: {
            systemInstruction: prompt,
            tools: [{ functionDeclarations: [getModelTool] }]
        },
        contents: [
            { role: "user", parts: [{ text: description }] }
        ]
    });

    // Check if the model wants to use tools
    let conversationHistory = [
        { role: "user", parts: [{ text: description }] }
    ] as Content[];

    // Handle tool calls iteratively
    while (aiResponse.functionCalls && aiResponse.functionCalls.length > 0) {
        console.log("AI wants to use tools:", aiResponse.functionCalls);

        // Add the AI's response with function calls to conversation
        conversationHistory.push({
            role: "assistant",
            parts: aiResponse.functionCalls.map(fc => ({
                functionCall: {
                    name: fc.name,
                    args: fc.args
                }
            }))
        });

        // Execute each tool call and collect results
        const toolResults = [];
        for (const functionCall of aiResponse.functionCalls) {
            try {
                const result = await executeTool(functionCall.name!, functionCall.args!);
                toolResults.push({
                    functionResponse: {
                        name: functionCall.name,
                        response: { result }
                    }
                });
                console.log(`Tool ${functionCall.name} returned:`, result);
            } catch (error) {
                console.error(`Error executing tool ${functionCall.name}:`, error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                toolResults.push({
                    functionResponse: {
                        name: functionCall.name,
                        response: { error: errorMessage }
                    }
                });
            }
        }

        // Add tool results to conversation
        conversationHistory.push({
            role: "user",
            parts: toolResults
        });

        // Get the next response from AI with tool results
        aiResponse = await ai.models.generateContent({
            model: model,
            config: {
                systemInstruction: prompt,
                tools: [{ functionDeclarations: [getModelTool] }]
            },
            contents: conversationHistory
        });
    }

    return { script: aiResponse.text };

})

