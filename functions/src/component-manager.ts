
import { Content, FunctionDeclaration, GoogleGenAI, Type } from "@google/genai";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? "AIzaSyBhxmOBFzUkmyFG2eeyyULG2t2IQ_oP3Z0"
});

const COMPONENTS_COLLECTION = "components";
const COMPONENTS_STORAGE_PREFIX = "components";
const COMPONENT_GENERATOR_MODEL = process.env.COMPONENT_GENERATOR_MODEL ?? "gemini-2.5-flash";
const MAX_TOOL_CALLS_PER_GENERATION = 16;
const MAX_RECURSION_DEPTH = 3;

export interface ComponentSummary {
    id: string;
    shortDeck: string;
    gsPath: string;
}

interface ComponentDocument extends ComponentSummary {
    prompt: string;
    dependencies: string[];
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

interface GeneratedComponentPayload {
    shortDeck: string;
    dependencies: string[];
    code: string;
}

interface ToolExecutionContext {
    depth: number;
    lineage: string[];
}

type ComponentMutationMode = "create" | "update";

export const componentToolDeclarations: FunctionDeclaration[] = [
    {
        name: "GetAllComponents",
        description: "Returns all existing reusable components as summaries.",
        parameters: {
            type: Type.OBJECT,
            properties: {}
        }
    },
    {
        name: "GetComponents",
        description: "Finds existing reusable components that match a specific purpose.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                purpose: {
                    type: Type.STRING,
                    description: "Short description of what kind of component you need."
                }
            },
            required: ["purpose"]
        }
    },
    {
        name: "CreateComponent",
        description: "Creates a new reusable JavaScript web component and stores it in Firebase.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                id: {
                    type: Type.STRING,
                    description: "Unique component ID, preferably kebab-case."
                },
                prompt: {
                    type: Type.STRING,
                    description: "Specification for the component to generate."
                }
            },
            required: ["id", "prompt"]
        }
    },
    {
        name: "UpdateComponent",
        description: "Updates an existing reusable JavaScript web component and stores the new version.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                id: {
                    type: Type.STRING,
                    description: "ID of the existing component to update."
                },
                prompt: {
                    type: Type.STRING,
                    description: "Requested changes to apply to the component."
                }
            },
            required: ["id", "prompt"]
        }
    }
];

export const componentTools = [{ functionDeclarations: componentToolDeclarations }];

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
            shortDeck: typeof data.shortDeck === "string" ? data.shortDeck : "",
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
            const haystack = `${component.id} ${component.shortDeck}`.toLowerCase();
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
        throw new Error(`Max component recursion depth (${MAX_RECURSION_DEPTH}) exceeded.`);
    }

    ensureFirebaseApp();

    const id = normalizeComponentId(rawId, prompt);
    if (context.lineage.includes(id)) {
        throw new Error(`Recursive component cycle detected for component '${id}'.`);
    }

    const db = getFirestore();
    const docRef = db.collection(COMPONENTS_COLLECTION).doc(id);
    const existingDoc = await docRef.get();
    const existingData = existingDoc.exists ? (existingDoc.data() as Partial<ComponentDocument>) : undefined;

    if (mode === "create" && existingData?.gsPath) {
        return {
            id,
            shortDeck: existingData.shortDeck ?? "",
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
        shortDeck: generation.shortDeck,
        gsPath,
        prompt,
        dependencies: generation.dependencies,
        updatedAt: FieldValue.serverTimestamp()
    };

    payload.createdAt = existingData?.createdAt ?? FieldValue.serverTimestamp();

    await docRef.set(payload, { merge: true });

    return {
        id,
        shortDeck: generation.shortDeck,
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
        "Return strict JSON only with keys: shortDeck, dependencies, code."
    ].join("\n\n");

    const systemInstruction = [
        "You create modular JavaScript Web Components for a dictionary website.",
        "Rules:",
        "1. Always generate valid plain JavaScript (no TypeScript).",
        "2. Prefer reusing existing components by calling tools before creating new ones.",
        "3. If another reusable component is needed, call CreateComponent or UpdateComponent.",
        "4. Return JSON only: {\"shortDeck\": string, \"dependencies\": string[], \"code\": string}.",
        "5. The 'dependencies' array must contain component IDs used by the generated code.",
        "6. Keep shortDeck concise and human readable (one sentence).",
        "7. Any fetch() that mutates state (POST/PUT/DELETE) MUST send a JSON body that includes an 'outputFormat' field. The value is a short description of the expected response shape (for example: \"{ ok: boolean, favoriteCount: number }\"). Then consume the response according to that exact shape. The action runner on the server uses 'outputFormat' to decide what JSON to return."
    ].join("\n");

    let conversationHistory: Content[] = [
        {
            role: "user",
            parts: [{ text: userMessage }]
        }
    ];

    let aiResponse = await ai.models.generateContent({
        model: COMPONENT_GENERATOR_MODEL,
        config: {
            systemInstruction,
            tools: componentTools
        },
        contents: conversationHistory
    });

    let toolCallCount = 0;

    while (aiResponse.functionCalls && aiResponse.functionCalls.length > 0) {
        if (toolCallCount >= MAX_TOOL_CALLS_PER_GENERATION) {
            throw new Error(`Exceeded max tool calls (${MAX_TOOL_CALLS_PER_GENERATION}) while generating component '${input.id}'.`);
        }

        conversationHistory.push({
            role: "assistant",
            parts: aiResponse.functionCalls.map((functionCall) => ({
                functionCall: {
                    name: functionCall.name,
                    args: functionCall.args
                }
            }))
        });

        const toolResults = [];
        for (const functionCall of aiResponse.functionCalls) {
            toolCallCount += 1;
            try {
                const result = await executeComponentToolCallInternal(functionCall.name ?? "", functionCall.args, {
                    depth: input.context.depth + 1,
                    lineage: [...input.context.lineage]
                });

                toolResults.push({
                    functionResponse: {
                        name: functionCall.name,
                        response: { result }
                    }
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown tool execution error";
                toolResults.push({
                    functionResponse: {
                        name: functionCall.name,
                        response: { error: message }
                    }
                });
            }
        }

        conversationHistory.push({
            role: "user",
            parts: toolResults
        });

        aiResponse = await ai.models.generateContent({
            model: COMPONENT_GENERATOR_MODEL,
            config: {
                systemInstruction,
                tools: componentTools
            },
            contents: conversationHistory
        });
    }

    const finalText = aiResponse.text?.trim();
    if (!finalText) {
        throw new Error(`Model returned an empty response while generating component '${input.id}'.`);
    }

    return parseGeneratedPayload(finalText);
}

function parseGeneratedPayload(rawText: string): GeneratedComponentPayload {
    const text = stripCodeFence(rawText).trim();
    const jsonCandidate = extractJsonCandidate(text);

    if (jsonCandidate) {
        try {
            const parsed = JSON.parse(jsonCandidate) as Partial<GeneratedComponentPayload>;
            const shortDeck = typeof parsed.shortDeck === "string" && parsed.shortDeck.trim()
                ? parsed.shortDeck.trim()
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

            return { shortDeck, dependencies, code };
        } catch {
            // Fallback to direct text parsing below.
        }
    }

    const extractedCode = extractCodeBlock(rawText) ?? rawText;
    if (!extractedCode.trim()) {
        throw new Error("Could not parse generated component source code.");
    }

    return {
        shortDeck: "Generated reusable component",
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