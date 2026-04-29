
import { generateText, stepCountIs, tool } from "ai";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "./logger";
import { resolveLanguageModel, resolveProviderName } from "./ai-model-provider";
import componentGeneratorPrompt from "../prompts/component_generator.json";
import { z } from "zod";

const log = logger.child("component-manager");

const COMPONENTS_COLLECTION = "components";
const COMPONENTS_STORAGE_PREFIX = "components";
const MAX_TOOL_CALLS_PER_GENERATION = 16;
const MAX_RECURSION_DEPTH = 3;

export interface ComponentSummary {
    id: string;
    shortDesc: string;
    gsPath: string;
}

interface ComponentDocument extends ComponentSummary {
    prompt: string;
    dependencies: string[];
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

interface GeneratedComponentPayload {
    shortDesc: string;
    dependencies: string[];
    code: string;
}

interface ToolExecutionContext {
    depth: number;
    lineage: string[];
}

type ComponentMutationMode = "create" | "update";

interface ComponentToolDeclaration {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export const componentToolDeclarations: ComponentToolDeclaration[] = [
    {
        name: "GetAllComponents",
        description: "Returns all existing reusable components as summaries.",
        inputSchema: {}
    },
    {
        name: "GetComponents",
        description: "Finds existing reusable components that match a specific purpose.",
        inputSchema: {
            purpose: {
                type: "string",
                description: "Short description of what kind of component you need."
            }
        }
    },
    {
        name: "CreateComponent",
        description: "Creates a new reusable JavaScript web component and stores it in Firebase.",
        inputSchema: {
            id: {
                type: "string",
                description: "Unique component ID, preferably kebab-case."
            },
            prompt: {
                type: "string",
                description: "Specification for the component to generate."
            }
        }
    },
    {
        name: "UpdateComponent",
        description: "Updates an existing reusable JavaScript web component and stores the new version.",
        inputSchema: {
            id: {
                type: "string",
                description: "ID of the existing component to update."
            },
            prompt: {
                type: "string",
                description: "Requested changes to apply to the component."
            }
        }
    }
];

export const componentTools = componentToolDeclarations;

export async function executeComponentToolCall(toolName: string, args: unknown): Promise<unknown> {
    return executeComponentToolCallInternal(toolName, args, { depth: 0, lineage: [] });
}

export async function GetAllComponents(): Promise<ComponentSummary[]> {
    ensureFirebaseApp();
    const db = getFirestore();
    const snapshot = await db.collection(COMPONENTS_COLLECTION).limit(250).get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() as Partial<ComponentDocument>;
        return {
            id: doc.id,
            shortDesc: typeof data.shortDesc === "string" ? data.shortDesc : "",
            gsPath: typeof data.gsPath === "string" ? data.gsPath : ""
        };
    });
}

export async function GetComponents(purpose: string): Promise<ComponentSummary[]> {
    const allComponents = await GetAllComponents();
    const normalizedPurpose = purpose.toLowerCase().trim();
    if (!normalizedPurpose) {
        return allComponents.slice(0, 20);
    }

    const terms = normalizedPurpose.split(/\s+/g).filter((term) => term.length > 1);
    if (terms.length === 0) {
        return allComponents.slice(0, 20);
    }

    const scored = allComponents
        .map((component) => {
            const haystack = `${component.id} ${component.shortDesc}`.toLowerCase();
            const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? term.length : 0), 0);
            return { component, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((entry) => entry.component);

    return scored.length > 0 ? scored : allComponents.slice(0, 5);
}

export async function CreateComponent(id: string, prompt: string): Promise<ComponentSummary> {
    return createOrUpdateComponent("create", id, prompt, { depth: 0, lineage: [] });
}

export async function UpdateComponent(id: string, prompt: string): Promise<ComponentSummary> {
    return createOrUpdateComponent("update", id, prompt, { depth: 0, lineage: [] });
}

async function executeComponentToolCallInternal(
    toolName: string,
    args: unknown,
    context: ToolExecutionContext
): Promise<unknown> {
    const safeArgs = toObjectArgs(args);

    switch (toolName) {
        case "GetAllComponents":
            return GetAllComponents();
        case "GetComponents":
            return GetComponents(readRequiredStringArg(safeArgs, "purpose", toolName));
        case "CreateComponent":
            return createOrUpdateComponent(
                "create",
                readRequiredStringArg(safeArgs, "id", toolName),
                readRequiredStringArg(safeArgs, "prompt", toolName),
                context
            );
        case "UpdateComponent":
            return createOrUpdateComponent(
                "update",
                readRequiredStringArg(safeArgs, "id", toolName),
                readRequiredStringArg(safeArgs, "prompt", toolName),
                context
            );
        default:
            throw new Error(`Unknown component tool: ${toolName}`);
    }
}

async function createOrUpdateComponent(
    mode: ComponentMutationMode,
    rawId: string,
    prompt: string,
    context: ToolExecutionContext
): Promise<ComponentSummary> {
    if (context.depth > MAX_RECURSION_DEPTH) {
        log.warn("max_depth_exceeded", { depth: context.depth, lineage: context.lineage, rawId });
        throw new Error(`Max component recursion depth (${MAX_RECURSION_DEPTH}) exceeded.`);
    }

    ensureFirebaseApp();

    const id = normalizeComponentId(rawId, prompt);
    if (context.lineage.includes(id)) {
        log.warn("cycle_detected", { id, lineage: context.lineage });
        throw new Error(`Recursive component cycle detected for component '${id}'.`);
    }

    const opLog = log.child(mode, { id, depth: context.depth, lineage: context.lineage });
    const stop = opLog.time("op", { prompt_chars: prompt.length });

    const db = getFirestore();
    const docRef = db.collection(COMPONENTS_COLLECTION).doc(id);
    const existingDoc = await docRef.get();
    const existingData = existingDoc.exists ? (existingDoc.data() as Partial<ComponentDocument>) : undefined;

    if (mode === "create" && existingData?.gsPath) {
        stop({ reused: true });
        return {
            id,
            shortDesc: existingData.shortDesc ?? "",
            gsPath: existingData.gsPath
        };
    }

    const previousCode = existingData?.gsPath ? await readComponentSource(existingData.gsPath) : "";
    const generation = await generateComponentCode({
        id,
        prompt,
        mode,
        previousCode,
        context: {
            depth: context.depth,
            lineage: [...context.lineage, id]
        }
    });

    const gsPath = await storeComponentSource(id, generation.code);

    const payload: Record<string, unknown> = {
        id,
        shortDesc: generation.shortDesc,
        gsPath,
        prompt,
        dependencies: generation.dependencies,
        updatedAt: FieldValue.serverTimestamp()
    };

    payload.createdAt = existingData?.createdAt ?? FieldValue.serverTimestamp();

    await docRef.set(payload, { merge: true });

    stop({
        reused: false,
        code_chars: generation.code.length,
        dependencies: generation.dependencies,
        gsPath
    });

    return {
        id,
        shortDesc: generation.shortDesc,
        gsPath
    };
}

async function generateComponentCode(input: {
    id: string;
    prompt: string;
    mode: ComponentMutationMode;
    previousCode: string;
    context: ToolExecutionContext;
}): Promise<GeneratedComponentPayload> {
    const userMessage = [
        `Component ID: ${input.id}`,
        `Operation: ${input.mode}`,
        `Task: ${input.prompt}`,
        input.previousCode
            ? `Existing source to update:\n\n${input.previousCode}`
            : "No existing source was found for this component.",
        "Return strict JSON only with keys: shortDesc, dependencies, code."
    ].join("\n\n");

    const systemInstruction = componentGeneratorPrompt.prompt;
    const model = componentGeneratorPrompt.model;

    const genLog = log.child("gen", {
        id: input.id,
        mode: input.mode,
        depth: input.context.depth,
        model,
        provider: resolveProviderName(model)
    });

    let toolCallCount = 0;

    const executeWithBudget = async (toolName: string, fn: () => Promise<unknown>): Promise<unknown> => {
        toolCallCount += 1;
        if (toolCallCount > MAX_TOOL_CALLS_PER_GENERATION) {
            throw new Error(`Exceeded max tool calls (${MAX_TOOL_CALLS_PER_GENERATION}) while generating component '${input.id}'.`);
        }

        const toolStop = genLog.time("tool_call", {
            tool: toolName,
            tool_index: toolCallCount
        });

        try {
            const result = await fn();
            toolStop({ ok: true });
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown tool execution error";
            toolStop({ ok: false, error: message });
            throw error;
        }
    };

    const llmStop = genLog.time("llm_call");
    const result = await generateText({
        model: resolveLanguageModel(model),
        system: systemInstruction,
        prompt: userMessage,
        
        tools: {
            GetAllComponents: tool({
                description: "Returns all existing reusable components as summaries.",
                inputSchema: z.object({}),
                execute: async () => executeWithBudget("GetAllComponents", () => GetAllComponents())
            }),
            GetComponents: tool({
                description: "Finds existing reusable components that match a specific purpose.",
                inputSchema: z.object({
                    purpose: z.string().min(1).describe("Short description of what kind of component you need.")
                }),
                execute: async ({ purpose }) => executeWithBudget("GetComponents", () => GetComponents(purpose))
            }),
            CreateComponent: tool({
                description: "Creates a new reusable JavaScript web component and stores it in Firebase.",
                inputSchema: z.object({
                    id: z.string().min(1).describe("Unique component ID, preferably kebab-case."),
                    prompt: z.string().min(1).describe("Specification for the component to generate.")
                }),
                execute: async ({ id, prompt }) => executeWithBudget("CreateComponent", () => createOrUpdateComponent("create", id, prompt, {
                    depth: input.context.depth + 1,
                    lineage: [...input.context.lineage]
                }))
            }),
            UpdateComponent: tool({
                description: "Updates an existing reusable JavaScript web component and stores the new version.",
                inputSchema: z.object({
                    id: z.string().min(1).describe("ID of the existing component to update."),
                    prompt: z.string().min(1).describe("Requested changes to apply to the component.")
                }),
                execute: async ({ id, prompt }) => executeWithBudget("UpdateComponent", () => createOrUpdateComponent("update", id, prompt, {
                    depth: input.context.depth + 1,
                    lineage: [...input.context.lineage]
                }))
            })
        },
        stopWhen: stepCountIs(MAX_TOOL_CALLS_PER_GENERATION + 1),
        onStepFinish(step) {
            genLog.debug("step_finished", {
                step_number: step.stepNumber,
                tool_calls: step.toolCalls.length,
                finish_reason: step.finishReason
            });
        }
    });
    llmStop({
        ok: true,
        steps: result.steps.length,
        tool_calls_total: toolCallCount,
        finish_reason: result.finishReason,
        total_tokens: result.totalUsage.totalTokens
    });

    const finalText = result.text?.trim();
    if (!finalText) {
        genLog.error("empty_final_text", { steps: result.steps.length, toolCallCount });
        throw new Error(`Model returned an empty response while generating component '${input.id}'.`);
    }

    genLog.info("generation_complete", {
        iterations: result.steps.length,
        tool_calls_total: toolCallCount,
        final_chars: finalText.length
    });

    return parseGeneratedPayload(finalText);
}

function parseGeneratedPayload(rawText: string): GeneratedComponentPayload {
    const text = stripCodeFence(rawText).trim();
    const jsonCandidate = extractJsonCandidate(text);

    if (jsonCandidate) {
        try {
            const parsed = JSON.parse(jsonCandidate) as Partial<GeneratedComponentPayload>;
            const shortDesc = typeof parsed.shortDesc === "string" && parsed.shortDesc.trim()
                ? parsed.shortDesc.trim()
                : "Generated reusable component";

            const dependencies = Array.isArray(parsed.dependencies)
                ? parsed.dependencies.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                : [];

            const code = typeof parsed.code === "string" && parsed.code.trim()
                ? parsed.code
                : "";

            if (!code) {
                throw new Error("Parsed payload did not include code.");
            }

            return { shortDesc, dependencies, code };
        } catch {
            // Fallback to direct text parsing below.
        }
    }

    const extractedCode = extractCodeBlock(rawText) ?? rawText;
    if (!extractedCode.trim()) {
        throw new Error("Could not parse generated component source code.");
    }

    return {
        shortDesc: "Generated reusable component",
        dependencies: [],
        code: extractedCode.trim()
    };
}

async function storeComponentSource(id: string, code: string): Promise<string> {
    ensureFirebaseApp();
    const bucket = getStorage().bucket();
    const objectPath = `${COMPONENTS_STORAGE_PREFIX}/${id}.js`;
    const file = bucket.file(objectPath);

    await file.save(code, {
        resumable: false,
        contentType: "application/javascript; charset=utf-8",
        metadata: {
            cacheControl: "public, max-age=60"
        }
    });

    return `gs://${bucket.name}/${objectPath}`;
}

async function readComponentSource(gsPath: string): Promise<string> {
    ensureFirebaseApp();
    const bucket = getStorage().bucket();
    const objectPath = parseGsPath(gsPath, bucket.name);

    try {
        const [buffer] = await bucket.file(objectPath).download();
        return buffer.toString("utf8");
    } catch {
        return "";
    }
}

function parseGsPath(gsPath: string, bucketName: string): string {
    const prefix = `gs://${bucketName}/`;
    if (!gsPath.startsWith(prefix)) {
        throw new Error(`gsPath '${gsPath}' does not belong to the default bucket '${bucketName}'.`);
    }

    return gsPath.slice(prefix.length);
}

function normalizeComponentId(rawId: string, prompt: string): string {
    const candidate = rawId.trim() || prompt.trim();
    const normalized = candidate
        .toLowerCase()
        .replace(/[^a-z0-9-_\s]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);

    if (!normalized) {
        return `component-${Date.now()}`;
    }

    return normalized;
}

function ensureFirebaseApp(): void {
    if (getApps().length === 0) {
        initializeApp();
    }
}

function toObjectArgs(args: unknown): Record<string, unknown> {
    if (args && typeof args === "object" && !Array.isArray(args)) {
        return args as Record<string, unknown>;
    }

    return {};
}

function readRequiredStringArg(args: Record<string, unknown>, key: string, toolName: string): string {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Tool '${toolName}' requires a non-empty string argument '${key}'.`);
    }

    return value;
}

function stripCodeFence(value: string): string {
    const trimmed = value.trim();
    if (!trimmed.startsWith("```")) {
        return trimmed;
    }

    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
}

function extractJsonCandidate(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
        return null;
    }

    return text.slice(start, end + 1);
}

function extractCodeBlock(text: string): string | null {
    const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    return match?.[1] ?? null;
}