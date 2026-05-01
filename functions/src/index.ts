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
    ResetComponents,
    UpdateComponent,
    isRejection,
    type ComponentMutationResult
} from "./component-manager";
import { SaveUserPreference, GetUserPreferences, formatPreferencesForPrompt } from "./user-manager";
import { activeToolkit } from "./toolkits/active";
import { loadPrompt, requireEnv } from "./prompt-loader";

const feedbackEvaluatorPrompt = loadPrompt("feedback_evaluator");
const componentInitializerPrompt = loadPrompt("component_initializer");
const componentCuratorPrompt = loadPrompt("component_curator");

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
                model: resolveLanguageModel(requireEnv("FEEDBACK_EVALUATOR_MODEL")),
                system: feedbackEvaluatorPrompt,
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

// ---------------------------------------------------------------------------
// initializeComponents — human-triggered seeding of the shared default
// component library, given an initial prompt + the active toolkit's domain
// description and tool inventory. Reuses CreateComponent end-to-end.
//
// updateComponents — human-triggered curation of the shared default library.
// Reuses UpdateComponent (called with no userId, so writes go to the default
// scope, never to per-user overrides).
//
// Both are deliberately NOT registered as MCP tools — they are explicit human
// actions, not something the page-render loop can invoke.
// ---------------------------------------------------------------------------

const MAX_INIT_TOOL_STEPS = 24;
const MAX_UPDATE_TOOL_STEPS = 24;
const MAX_OPERATOR_PROMPT_CHARS = 2000;

interface InitSkippedEntry {
    id: string;
    reason: string;
}

interface InitResult {
    summary: string;
    created: string[];
    skipped: InitSkippedEntry[];
}

interface UpdateResult {
    summary: string;
    updated: string[];
    skipped: InitSkippedEntry[];
}

function parseAgentJson(rawText: string): Record<string, unknown> | null {
    const trimmed = rawText.trim();
    if (!trimmed) return null;
    const fenceStripped = trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
    const start = fenceStripped.indexOf("{");
    const end = fenceStripped.lastIndexOf("}");
    const candidate = (start !== -1 && end > start) ? fenceStripped.slice(start, end + 1) : fenceStripped;
    try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
        // fall through
    }
    return null;
}

function readStringField(obj: Record<string, unknown> | null, key: string): string | null {
    if (!obj) return null;
    const v = obj[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
}

function formatToolInventory(): string {
    if (activeToolkit.tools.length === 0) return "(no domain tools registered)";
    return activeToolkit.tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
}

function formatComponentSummariesForPrompt(summaries: Awaited<ReturnType<typeof GetAllComponents>>): string {
    if (summaries.length === 0) return "(library is empty)";
    return summaries.map((c) => `- ${c.id}: ${c.shortDesc}`).join("\n");
}

function readOperatorPrompt(raw: unknown, fieldName: string): string {
    if (typeof raw !== "string") {
        throw new HttpsError("invalid-argument", `'${fieldName}' must be a string.`);
    }
    const trimmed = raw.trim().slice(0, MAX_OPERATOR_PROMPT_CHARS);
    if (!trimmed) {
        throw new HttpsError("invalid-argument", `'${fieldName}' is required.`);
    }
    return trimmed;
}

export const initializeComponents = onCall({
    region: "europe-southwest1"
}, async (request) => {
    const requestId = (request.rawRequest.headers["x-request-id"] as string | undefined) ?? generateRequestId();
    return withRequestContext(requestId, { fn: "initializeComponents" }, async () => {
        const initLog = log.child("initializeComponents");
        const stop = initLog.time("call");

        const operatorPrompt = readOperatorPrompt(request.data?.prompt, "prompt");

        const created: string[] = [];
        const skipped: InitSkippedEntry[] = [];
        let toolCallTotal = 0;

        const tools: Record<string, unknown> = {
            GetAllComponents: tool({
                description: "Returns all existing reusable components as summaries.",
                inputSchema: z.object({}),
                execute: async () => {
                    toolCallTotal += 1;
                    return GetAllComponents();
                }
            }),
            GetComponents: tool({
                description: "Finds existing reusable components that match a specific purpose.",
                inputSchema: z.object({
                    purpose: z.string().min(1).describe("Short description of the component you are looking for.")
                }),
                execute: async ({ purpose }) => {
                    toolCallTotal += 1;
                    return GetComponents(purpose);
                }
            }),
            CreateComponent: tool({
                description: "Creates a new reusable JavaScript web component in the shared default library.",
                inputSchema: z.object({
                    id: z.string().min(1).describe("Unique component ID, kebab-case."),
                    prompt: z.string().min(1).describe("Product-brief description of the new component.")
                }),
                execute: async ({ id, prompt }) => {
                    toolCallTotal += 1;
                    // Default-library write is enforced here by passing no userId.
                    const result: ComponentMutationResult = await CreateComponent(id, prompt);
                    if (isRejection(result)) {
                        skipped.push({ id: result.id, reason: result.reason });
                    } else if (!created.includes(result.id)) {
                        created.push(result.id);
                    }
                    return result;
                }
            })
        };

        const existingSummaries = await GetAllComponents();
        const userMessage = [
            `Initial prompt:\n${operatorPrompt}`,
            `Domain description:\n${activeToolkit.description}`,
            `Available domain tools:\n${formatToolInventory()}`,
            `Existing components (already in the library — do not duplicate):\n${formatComponentSummariesForPrompt(existingSummaries)}`,
            "Plan the foundational archetypes for this domain, then call CreateComponent for each gap. Emit the final JSON summary when done."
        ].join("\n\n");

        const llmStop = initLog.time("llm_call");
        let result;
        try {
            result = await generateText({
                model: resolveLanguageModel(requireEnv("COMPONENT_INITIALIZER_MODEL")),
                system: componentInitializerPrompt,
                prompt: userMessage,
                tools: tools as Parameters<typeof generateText>[0]["tools"],
                stopWhen: stepCountIs(MAX_INIT_TOOL_STEPS),
                onStepFinish(step) {
                    initLog.debug("step_finished", {
                        step_number: step.stepNumber,
                        tool_calls: step.toolCalls.length,
                        finish_reason: step.finishReason
                    });
                }
            });
        } catch (error) {
            llmStop({ ok: false, error });
            stop({ ok: false, reason: "llm_failed" });
            initLog.error("llm_failed", { error });
            throw new HttpsError("internal", "Could not initialize components.");
        }

        llmStop({
            ok: true,
            steps: result.steps.length,
            tool_calls_total: toolCallTotal,
            finish_reason: result.finishReason,
            total_tokens: result.totalUsage.totalTokens
        });

        const parsed = parseAgentJson(result.text ?? "");
        const summary =
            readStringField(parsed, "summary") ??
            (created.length > 0
                ? `Seeded ${created.length} component${created.length === 1 ? "" : "s"}: ${created.join(", ")}.`
                : "No components were created.");

        const payload: InitResult = { summary, created, skipped };
        stop({
            ok: true,
            tool_calls_total: toolCallTotal,
            created_count: created.length,
            skipped_count: skipped.length
        });
        return payload;
    });
});

export const updateComponents = onCall({
    region: "europe-southwest1"
}, async (request) => {
    const requestId = (request.rawRequest.headers["x-request-id"] as string | undefined) ?? generateRequestId();
    return withRequestContext(requestId, { fn: "updateComponents" }, async () => {
        const updLog = log.child("updateComponents");
        const stop = updLog.time("call");

        const operatorPrompt = readOperatorPrompt(request.data?.prompt, "prompt");

        const updated: string[] = [];
        const skipped: InitSkippedEntry[] = [];
        let toolCallTotal = 0;

        const tools: Record<string, unknown> = {
            GetAllComponents: tool({
                description: "Returns all existing reusable components as summaries.",
                inputSchema: z.object({}),
                execute: async () => {
                    toolCallTotal += 1;
                    return GetAllComponents();
                }
            }),
            GetComponents: tool({
                description: "Finds existing reusable components that match a specific purpose.",
                inputSchema: z.object({
                    purpose: z.string().min(1).describe("Short description of the component you are looking for.")
                }),
                execute: async ({ purpose }) => {
                    toolCallTotal += 1;
                    return GetComponents(purpose);
                }
            }),
            UpdateComponent: tool({
                description: "Updates an existing reusable component in the shared default library.",
                inputSchema: z.object({
                    id: z.string().min(1).describe("ID of the component to update."),
                    prompt: z.string().min(1).describe("Product-brief description of the desired new state.")
                }),
                execute: async ({ id, prompt }) => {
                    toolCallTotal += 1;
                    // Critical: no userId argument => default-scope write. Do not
                    // forward any auth context here, even if it exists on the request.
                    const result: ComponentMutationResult = await UpdateComponent(id, prompt);
                    if (isRejection(result)) {
                        skipped.push({ id: result.id, reason: result.reason });
                    } else if (!updated.includes(result.id)) {
                        updated.push(result.id);
                    }
                    return result;
                }
            })
        };

        const existingSummaries = await GetAllComponents();
        const userMessage = [
            `Curation prompt:\n${operatorPrompt}`,
            `Domain description:\n${activeToolkit.description}`,
            `Available domain tools:\n${formatToolInventory()}`,
            `Existing components (the candidates for change):\n${formatComponentSummariesForPrompt(existingSummaries)}`,
            "Identify the components the prompt targets, then call UpdateComponent for each. Emit the final JSON summary when done."
        ].join("\n\n");

        const llmStop = updLog.time("llm_call");
        let result;
        try {
            result = await generateText({
                model: resolveLanguageModel(requireEnv("COMPONENT_CURATOR_MODEL")),
                system: componentCuratorPrompt,
                prompt: userMessage,
                tools: tools as Parameters<typeof generateText>[0]["tools"],
                stopWhen: stepCountIs(MAX_UPDATE_TOOL_STEPS),
                onStepFinish(step) {
                    updLog.debug("step_finished", {
                        step_number: step.stepNumber,
                        tool_calls: step.toolCalls.length,
                        finish_reason: step.finishReason
                    });
                }
            });
        } catch (error) {
            llmStop({ ok: false, error });
            stop({ ok: false, reason: "llm_failed" });
            updLog.error("llm_failed", { error });
            throw new HttpsError("internal", "Could not update components.");
        }

        llmStop({
            ok: true,
            steps: result.steps.length,
            tool_calls_total: toolCallTotal,
            finish_reason: result.finishReason,
            total_tokens: result.totalUsage.totalTokens
        });

        const parsed = parseAgentJson(result.text ?? "");
        const summary =
            readStringField(parsed, "summary") ??
            (updated.length > 0
                ? `Updated ${updated.length} component${updated.length === 1 ? "" : "s"}: ${updated.join(", ")}.`
                : "No components were updated.");

        const payload: UpdateResult = { summary, updated, skipped };
        stop({
            ok: true,
            tool_calls_total: toolCallTotal,
            updated_count: updated.length,
            skipped_count: skipped.length
        });
        return payload;
    });
});

// ---------------------------------------------------------------------------
// resetComponents — destructive: wipes every default-scope and per-user-override
// component (Firestore + Storage). Built-in components and user preferences are
// untouched. Requires a `confirm: "RESET"` field in the request body to guard
// against accidental invocation, since the endpoint is unauthenticated.
// ---------------------------------------------------------------------------

const RESET_CONFIRMATION_TOKEN = "RESET";

export const resetComponents = onCall({
    region: "europe-southwest1"
}, async (request) => {
    const requestId = (request.rawRequest.headers["x-request-id"] as string | undefined) ?? generateRequestId();
    return withRequestContext(requestId, { fn: "resetComponents" }, async () => {
        const resetLog = log.child("resetComponents");
        const stop = resetLog.time("call");

        const confirm = typeof request.data?.confirm === "string" ? request.data.confirm : "";
        if (confirm !== RESET_CONFIRMATION_TOKEN) {
            stop({ ok: false, reason: "missing_confirmation" });
            throw new HttpsError(
                "failed-precondition",
                `Reset is destructive. Pass { confirm: "${RESET_CONFIRMATION_TOKEN}" } to proceed.`
            );
        }

        let result;
        try {
            result = await ResetComponents();
        } catch (error) {
            stop({ ok: false, reason: "reset_failed", error });
            resetLog.error("reset_failed", { error });
            throw new HttpsError("internal", "Could not reset components.");
        }

        const summary =
            `Cleared ${result.defaultDocsDeleted} default component(s), ` +
            `${result.userDocsDeleted} user-override component(s), and ` +
            `${result.storageObjectsDeleted} storage object(s).`;

        stop({ ok: true, ...result });
        return { summary, ...result };
    });
});
