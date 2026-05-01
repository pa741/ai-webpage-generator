/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
import { HttpsError, onCall, onRequest, Request } from "firebase-functions/https";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { getRemoteConfig, type ServerConfig } from "firebase-admin/remote-config";
import { initializeApp } from "firebase-admin/app";
import { GetModel } from "./asset-manager";
import { mcpHandler } from "./mcp";
import { generateRequestId, logger, withRequestContext } from "./logger";
import { resolveLanguageModel, resolveProviderName } from "./ai-model-provider";
import {
    CreateComponent,
    GetAllComponents,
    GetComponents,
    UpdateComponent,
    isRejection,
    type ComponentMutationResult
} from "./component-manager";
import { SaveUserPreference, GetUserPreferences, formatPreferencesForPrompt } from "./user-manager";
import feedbackEvaluatorPrompt from "../prompts/feedback_evaluator.json";

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


const MAX_SCENE_TOOL_STEPS = 16;

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
        sceneLog.info("scene_params", {
            model,
            provider: resolveProviderName(model),
            description_chars: description.length,
            tools: ["GetModel"]
        });

        let toolCallTotal = 0;

        const result = await generateText({
            model: resolveLanguageModel(model),
            system: prompt,
            prompt: description,
            tools: {
                GetModel: tool({
                    description: "Get a 3D model .glb url based on a search term. Use this to add objects to your 3D scene. These models are low poly",
                    inputSchema: z.object({
                        search: z.string().min(1).describe(
                            "Search term for the 3D model (e.g. 'cat', 'car', 'tree', 'building'), keep it short and simple."
                        )
                    }),
                    execute: async ({ search }) => {
                        toolCallTotal += 1;
                        const toolStop = sceneLog.time("tool_call", { tool: "GetModel", search });
                        try {
                            const url = await GetModel(search);
                            toolStop({ ok: true, result_chars: url.length });
                            return url;
                        } catch (error) {
                            const message = error instanceof Error ? error.message : "Unknown error";
                            toolStop({ ok: false, error: message });
                            sceneLog.warn("tool_failed", { tool: "GetModel", error: message });
                            return { error: message };
                        }
                    }
                })
            },
            stopWhen: stepCountIs(MAX_SCENE_TOOL_STEPS),
            onStepFinish(step) {
                sceneLog.debug("step_finished", {
                    step_number: step.stepNumber,
                    tool_calls: step.toolCalls.length,
                    finish_reason: step.finishReason
                });
            }
        });

        const script = result.text ?? "";
        stop({
            ok: true,
            iterations: result.steps.length,
            tool_calls_total: toolCallTotal,
            script_chars: script.length,
            finish_reason: result.finishReason,
            total_tokens: result.totalUsage.totalTokens
        });
        return { script };
    });
});

// ---------------------------------------------------------------------------
// evaluateFeedback — routes free-form user feedback into either a component
// mutation (per-user override) or a stored user preference (consumed by the
// page designer / component designer on the next request).
// ---------------------------------------------------------------------------

const MAX_FEEDBACK_TOOL_STEPS = 8;
const MAX_FEEDBACK_CHARS = 1000;

interface FeedbackAction {
    kind: "saved_preference" | "updated_component" | "created_component" | "rejected_component" | "none";
    text?: string;
    id?: string;
    reason?: string;
}

interface FeedbackResult {
    summary: string;
    actions: FeedbackAction[];
}

export const evaluateFeedback = onCall({
    region: "europe-southwest1"
}, async (request) => {
    const requestId = (request.rawRequest.headers["x-request-id"] as string | undefined) ?? generateRequestId();
    return withRequestContext(requestId, { fn: "evaluateFeedback" }, async () => {
        const fbLog = log.child("evaluateFeedback");
        const stop = fbLog.time("call");

        const userId = process.env.FUNCTIONS_EMULATOR === "true" && !request.auth?.uid
            ? "emulator-user"
            : request.auth?.uid;

        if (!userId) {
            stop({ ok: false, reason: "unauthenticated" });
            throw new HttpsError("unauthenticated", "Sign in is required to submit feedback.");
        }

        const rawFeedback = typeof request.data?.feedback === "string" ? request.data.feedback : "";
        const feedback = rawFeedback.trim().slice(0, MAX_FEEDBACK_CHARS);
        if (!feedback) {
            stop({ ok: false, reason: "empty_feedback" });
            throw new HttpsError("invalid-argument", "Feedback text is required.");
        }

        const actions: FeedbackAction[] = [];
        let toolCallTotal = 0;

        const tools: Record<string, unknown> = {
            GetAllComponents: tool({
                description: "Returns all existing reusable components as summaries.",
                inputSchema: z.object({}),
                execute: async () => {
                    toolCallTotal += 1;
                    return GetAllComponents(userId);
                }
            }),
            GetComponents: tool({
                description: "Finds existing reusable components that match a specific purpose.",
                inputSchema: z.object({
                    purpose: z.string().min(1).describe("Short description of the component you are looking for.")
                }),
                execute: async ({ purpose }) => {
                    toolCallTotal += 1;
                    return GetComponents(purpose, userId);
                }
            }),
            UpdateComponent: tool({
                description: "Updates an existing reusable JavaScript web component as a per-user override.",
                inputSchema: z.object({
                    id: z.string().min(1),
                    prompt: z.string().min(1).describe("Product-brief description of the changes to apply.")
                }),
                execute: async ({ id, prompt }) => {
                    toolCallTotal += 1;
                    const result: ComponentMutationResult = await UpdateComponent(id, prompt, userId);
                    if (isRejection(result)) {
                        actions.push({ kind: "rejected_component", id: result.id, reason: result.reason });
                    } else {
                        actions.push({ kind: "updated_component", id: result.id });
                    }
                    return result;
                }
            }),
            CreateComponent: tool({
                description: "Creates a new reusable JavaScript web component.",
                inputSchema: z.object({
                    id: z.string().min(1).describe("Unique component ID, kebab-case."),
                    prompt: z.string().min(1).describe("Product-brief description of the new component.")
                }),
                execute: async ({ id, prompt }) => {
                    toolCallTotal += 1;
                    const result: ComponentMutationResult = await CreateComponent(id, prompt, userId);
                    if (isRejection(result)) {
                        actions.push({ kind: "rejected_component", id: result.id, reason: result.reason });
                    } else {
                        actions.push({ kind: "created_component", id: result.id });
                    }
                    return result;
                }
            }),
            SaveUserPreference: tool({
                description: "Stores one cross-cutting preference for this user. Future page and component generations include these preferences automatically.",
                inputSchema: z.object({
                    text: z.string().min(1).describe("A single, directive sentence describing the preference. e.g. 'Render all body text in Spanish.'")
                }),
                execute: async ({ text }) => {
                    toolCallTotal += 1;
                    const result = await SaveUserPreference(userId, text);
                    actions.push({ kind: "saved_preference", text });
                    return result;
                }
            })
        };

        const existingPreferences = await GetUserPreferences(userId);
        const preferencesBlock = existingPreferences.length
            ? `Existing user preferences (already stored — do not duplicate):\n${formatPreferencesForPrompt(existingPreferences)}`
            : "No existing user preferences are stored yet.";

        const userMessage = [
            `User feedback:\n${feedback}`,
            preferencesBlock,
            "Decide how to route this feedback per the system prompt, then call the relevant tools and emit your final JSON summary."
        ].join("\n\n");

        const llmStop = fbLog.time("llm_call");
        let result;
        try {
            result = await generateText({
                model: resolveLanguageModel(feedbackEvaluatorPrompt.model),
                system: feedbackEvaluatorPrompt.prompt,
                prompt: userMessage,
                tools: tools as Parameters<typeof generateText>[0]["tools"],
                stopWhen: stepCountIs(MAX_FEEDBACK_TOOL_STEPS),
                onStepFinish(step) {
                    fbLog.debug("step_finished", {
                        step_number: step.stepNumber,
                        tool_calls: step.toolCalls.length,
                        finish_reason: step.finishReason
                    });
                }
            });
        } catch (error) {
            llmStop({ ok: false, error });
            stop({ ok: false, reason: "llm_failed" });
            fbLog.error("llm_failed", { error });
            throw new HttpsError("internal", "Could not evaluate feedback.");
        }

        llmStop({
            ok: true,
            steps: result.steps.length,
            tool_calls_total: toolCallTotal,
            finish_reason: result.finishReason,
            total_tokens: result.totalUsage.totalTokens
        });

        const summary = parseFeedbackSummary(result.text ?? "", actions);

        if (actions.length === 0) {
            actions.push({ kind: "none", reason: "Feedback could not be acted on." });
        }

        const payload: FeedbackResult = { summary: summary.summary, actions };
        stop({
            ok: true,
            tool_calls_total: toolCallTotal,
            actions: actions.map((a) => a.kind)
        });
        return payload;
    });
});

function parseFeedbackSummary(rawText: string, actions: FeedbackAction[]): { summary: string } {
    const trimmed = rawText.trim();
    if (!trimmed) {
        return { summary: defaultSummary(actions) };
    }

    const fenceStripped = trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
    const start = fenceStripped.indexOf("{");
    const end = fenceStripped.lastIndexOf("}");
    const candidate = (start !== -1 && end > start) ? fenceStripped.slice(start, end + 1) : fenceStripped;

    try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && typeof parsed.summary === "string" && parsed.summary.trim()) {
            return { summary: parsed.summary.trim() };
        }
    } catch {
        // fall through
    }

    return { summary: defaultSummary(actions) };
}

function defaultSummary(actions: FeedbackAction[]): string {
    if (actions.length === 0) {
        return "Thanks — your feedback has been recorded.";
    }
    const counts = actions.reduce<Record<string, number>>((acc, a) => {
        acc[a.kind] = (acc[a.kind] ?? 0) + 1;
        return acc;
    }, {});
    const parts = Object.entries(counts).map(([kind, n]) => `${n} ${kind.replace(/_/g, " ")}`);
    return `Thanks — applied ${parts.join(", ")}.`;
}
