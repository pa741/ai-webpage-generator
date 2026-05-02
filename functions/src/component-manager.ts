
import { generateText, stepCountIs, tool } from "ai";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "./logger";
import { resolveLanguageModel, resolveProviderName } from "./ai-model-provider";
import { loadPrompt, requireEnv } from "./prompt-loader";

const componentDesignerPrompt = loadPrompt("component_designer");
const componentCodegenPrompt = loadPrompt("component_codegen");
const componentEvaluatorPrompt = loadPrompt("component_evaluator");
import { GetUserPreferences, formatPreferencesForPrompt } from "./user-manager";
import { z } from "zod";

const log = logger.child("component-manager");

const COMPONENTS_COLLECTION = "components";
const USERS_COLLECTION = "users";
const USER_COMPONENTS_SUBCOLLECTION = "components";
const COMPONENTS_STORAGE_PREFIX = "components";
const MAX_TOOL_CALLS_PER_GENERATION = 16;
const MAX_RECURSION_DEPTH = 3;
const MAX_CODEGEN_RETRIES = 1;

export interface ComponentSummary {
    id: string;
    shortDesc: string;
    gsPath: string;
    role?: string;
    builtIn?: boolean;
}

// Returned by GetComponents — includes the fields callers need to use a component correctly.
export interface ComponentUsageSummary {
    id: string;
    shortDesc: string;
    role?: string;
    props?: ComponentSpecProp[];
    slots?: ComponentSpecSlot[];
    styling?: {
        tailwindClasses: string;
        palette: string[];
        notes: string;
    };
    builtIn?: boolean;
}

export interface ComponentRejection {
    rejected: true;
    id: string;
    reason: string;
    suggestion?: string;
}

export type ComponentMutationResult = ComponentSummary | ComponentRejection;

export function isRejection(result: ComponentMutationResult): result is ComponentRejection {
    return (result as ComponentRejection).rejected === true;
}

export interface ComponentSpecProp {
    name: string;
    type: "string" | "number" | "boolean" | "json";
    required: boolean;
    description: string;
    default?: unknown;
}

export interface ComponentSpecSlot {
    name: string;
    description: string;
    accepts: string;
}

export interface ComponentSpecDependency {
    id: string;
    usage: string;
}

export interface ComponentSpecInteraction {
    trigger: string;
    method: "POST" | "PUT" | "DELETE" | "PATCH";
    route: string;
    bodyShape: string;
}

export interface ComponentSpec {
    id: string;
    shortDesc: string;
    role: string;
    props: ComponentSpecProp[];
    slots: ComponentSpecSlot[];
    styling: {
        tailwindClasses: string;
        palette: string[];
        notes: string;
    };
    dependencies: ComponentSpecDependency[];
    interactions: ComponentSpecInteraction[];
    accessibility: string;
    markupSketch: string;
}

interface ComponentDocument extends ComponentSummary {
    prompt: string;
    dependencies: string[];
    spec?: ComponentSpec;
    builtIn?: boolean;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

interface ToolExecutionContext {
    depth: number;
    lineage: string[];
    userId?: string | null;
}

type ComponentMutationMode = "create" | "update";

type Scope = { kind: "default" } | { kind: "user"; userId: string };

interface ComponentToolDeclaration {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export const componentToolDeclarations: ComponentToolDeclaration[] = [
    {
        name: "GetAllComponents",
        description: "Returns all existing reusable components as lightweight summaries (id, shortDesc, role). Use for a broad library survey; call GetComponents for detailed prop and slot information.",
        inputSchema: {}
    },
    {
        name: "GetComponents",
        description: "Finds reusable components matching a purpose string. Returns each component's id, shortDesc, role, props, slots, and styling — enough to use the component correctly in a page spec or to borrow its design tokens.",
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

// ---------------------------------------------------------------------------
// Built-in components
//
// These are Svelte-compiled custom elements that ship in the SvelteKit bundle
// (see src/Components/*.svelte and their `customElement` option). They are
// always defined at page load by +layout.svelte's side-effect imports, so
// resolveComponentScripts must NOT inject a <script> for them. They are also
// not regeneratable: CreateComponent/UpdateComponent reject built-in ids.
// ---------------------------------------------------------------------------

export const BUILT_IN_COMPONENTS: ComponentDocument[] = [
    {
        id: "google-login",
        shortDesc: "Google sign-in button. Renders a button when no user is signed in; renders nothing when a user is already signed in.",
        gsPath: "",
        prompt: "Built-in Svelte custom element wrapping firebase/auth Google sign-in.",
        dependencies: [],
        builtIn: true,
        spec: {
            id: "google-login",
            shortDesc: "Google sign-in button. Renders a button when no user is signed in; renders nothing when a user is already signed in.",
            role: "auth-control",
            props: [
                {
                    name: "label",
                    type: "string",
                    required: false,
                    description: "Optional button label override.",
                    default: "Sign in with Google"
                }
            ],
            slots: [],
            styling: {
                tailwindClasses: "",
                palette: [],
                notes: "Self-styled (rounded white pill button). Renders nothing when a user is signed in, so callers should not assume layout space is reserved."
            },
            dependencies: [],
            interactions: [
                {
                    trigger: "click on the button",
                    method: "POST",
                    route: "/__session-auth",
                    bodyShape: "{ \"idToken\": \"string\", \"outputFormat\": { \"ok\": \"boolean\" } }"
                }
            ],
            accessibility: "Native button element; label is read by screen readers.",
            markupSketch: "<google-login label=\"Sign in with Google\"></google-login>"
        }
    },
    {
        id: "feedback-fab",
        shortDesc: "Globally-rendered feedback FAB. Renders a floating action button that opens a mini modal for submitting free-form feedback, which is routed to the evaluateFeedback agent for processing and incorporation into user preferences or component overrides.",
        gsPath: "",
        prompt: "Built-in Svelte custom element that lets a signed-in user submit free-form preferences which the evaluateFeedback agent then routes into per-user component overrides or stored preferences.",
        dependencies: [],
        builtIn: true,
        spec: {
            id: "feedback-fab",
            shortDesc: "Floating feedback action button + mini modal that captures free-form user preferences for an authenticated user.",
            role: "feedback-control",
            props: [],
            slots: [],
            styling: {
                tailwindClasses: "",
                palette: [],
                notes: "Self-styled. Fixed position bottom-right, z-index above page content. Renders nothing when no user is signed in."
            },
            dependencies: [],
            interactions: [
                {
                    trigger: "click submit on the feedback modal",
                    method: "POST",
                    route: "(internal: Firebase httpsCallable evaluateFeedback)",
                    bodyShape: "{ \"feedback\": \"string\", \"outputFormat\": { \"summary\": \"string\", \"actions\": \"array\" } }"
                }
            ],
            accessibility: "Button has an aria-label; modal traps focus while open; Escape closes the modal.",
            markupSketch: "<feedback-fab></feedback-fab>"
        }
    }
];

const BUILT_IN_IDS = new Set(BUILT_IN_COMPONENTS.map((c) => c.id));

interface ComponentFullRecord {
    id: string;
    shortDesc: string;
    gsPath: string;
    role?: string;
    props?: ComponentSpecProp[];
    slots?: ComponentSpecSlot[];
    styling?: ComponentSpec['styling'];
    builtIn?: boolean;
}

function builtInFullRecords(): ComponentFullRecord[] {
    return BUILT_IN_COMPONENTS.map((c) => ({
        id: c.id,
        shortDesc: c.shortDesc,
        gsPath: c.gsPath,
        role: c.spec?.role,
        props: c.spec?.props,
        slots: c.spec?.slots,
        styling: c.spec?.styling,
        builtIn: true
    }));
}

function fullToUsage(c: ComponentFullRecord): ComponentUsageSummary {
    return {
        id: c.id,
        shortDesc: c.shortDesc,
        ...(c.role !== undefined && { role: c.role }),
        ...(c.props !== undefined && { props: c.props }),
        ...(c.slots !== undefined && { slots: c.slots }),
        ...(c.styling !== undefined && { styling: c.styling }),
        ...(c.builtIn !== undefined && { builtIn: c.builtIn })
    };
}

async function getAllComponentsFull(userId?: string | null): Promise<ComponentFullRecord[]> {
    ensureFirebaseApp();
    const db = getFirestore();
    const [defaultSnap, userSnap] = await Promise.all([
        db.collection(COMPONENTS_COLLECTION).limit(250).get(),
        userId ? db.collection(USERS_COLLECTION).doc(userId).collection(USER_COMPONENTS_SUBCOLLECTION).limit(250).get() : Promise.resolve(null)
    ]);

    const merged = new Map<string, ComponentFullRecord>();

    for (const c of builtInFullRecords()) {
        merged.set(c.id, c);
    }

    for (const doc of defaultSnap.docs) {
        const data = doc.data() as Partial<ComponentDocument>;
        const spec = data.spec as ComponentSpec | undefined;
        merged.set(doc.id, {
            id: doc.id,
            shortDesc: typeof data.shortDesc === "string" ? data.shortDesc : "",
            gsPath: typeof data.gsPath === "string" ? data.gsPath : "",
            ...(spec?.role && { role: spec.role }),
            ...(spec?.props && { props: spec.props }),
            ...(spec?.slots && { slots: spec.slots }),
            ...(spec?.styling && { styling: spec.styling })
        });
    }

    if (userSnap) {
        for (const doc of userSnap.docs) {
            const data = doc.data() as Partial<ComponentDocument>;
            if (BUILT_IN_IDS.has(doc.id)) continue;
            const spec = data.spec as ComponentSpec | undefined;
            merged.set(doc.id, {
                id: doc.id,
                shortDesc: typeof data.shortDesc === "string" ? data.shortDesc : "",
                gsPath: typeof data.gsPath === "string" ? data.gsPath : "",
                ...(spec?.role && { role: spec.role }),
                ...(spec?.props && { props: spec.props }),
                ...(spec?.slots && { slots: spec.slots }),
                ...(spec?.styling && { styling: spec.styling })
            });
        }
    }

    return Array.from(merged.values());
}

export function getBuiltInComponent(id: string): ComponentDocument | undefined {
    return BUILT_IN_COMPONENTS.find((c) => c.id === id);
}

export function isBuiltInComponentId(id: string): boolean {
    return BUILT_IN_IDS.has(id);
}

// ---------------------------------------------------------------------------
// Public tool entry points
// ---------------------------------------------------------------------------

export async function executeComponentToolCall(toolName: string, args: unknown, userId?: string | null): Promise<unknown> {
    return executeComponentToolCallInternal(toolName, args, { depth: 0, lineage: [], userId: userId ?? null });
}

export interface ResetComponentsResult {
    defaultDocsDeleted: number;
    userDocsDeleted: number;
    storageObjectsDeleted: number;
}

/**
 * Wipes every default-scope and per-user-override component from Firestore and
 * the corresponding Storage objects. Built-in components are not stored, so
 * they are unaffected. Destructive — intended for dev/admin reset flows only.
 */
export async function ResetComponents(): Promise<ResetComponentsResult> {
    ensureFirebaseApp();
    const db = getFirestore();
    const bucket = getStorage().bucket();
    const stop = log.child("reset").time("reset");

    // collectionGroup("components") matches both the top-level collection AND
    // every users/{uid}/components subcollection, in one query.
    const snap = await db.collectionGroup(USER_COMPONENTS_SUBCOLLECTION).get();

    let defaultDocsDeleted = 0;
    let userDocsDeleted = 0;
    const userPrefixes = new Set<string>();

    let batch = db.batch();
    let batchOps = 0;
    const FIRESTORE_BATCH_LIMIT = 400;

    for (const doc of snap.docs) {
        const userParent = doc.ref.parent.parent;
        if (userParent) {
            userDocsDeleted += 1;
            userPrefixes.add(`${USERS_COLLECTION}/${userParent.id}/${COMPONENTS_STORAGE_PREFIX}/`);
        } else {
            defaultDocsDeleted += 1;
        }
        batch.delete(doc.ref);
        batchOps += 1;
        if (batchOps >= FIRESTORE_BATCH_LIMIT) {
            await batch.commit();
            batch = db.batch();
            batchOps = 0;
        }
    }
    if (batchOps > 0) await batch.commit();

    // Storage cleanup. Default-scope: blanket-delete the components/ prefix to
    // also catch orphans from doc-write failures. User-scope: only delete
    // prefixes derived from Firestore docs we actually saw, to avoid touching
    // anything else that might live under users/.
    let storageObjectsDeleted = 0;
    const deletePrefix = async (prefix: string): Promise<number> => {
        const [files] = await bucket.getFiles({ prefix });
        await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true }).catch(() => undefined)));
        return files.length;
    };

    storageObjectsDeleted += await deletePrefix(`${COMPONENTS_STORAGE_PREFIX}/`);
    for (const prefix of userPrefixes) {
        storageObjectsDeleted += await deletePrefix(prefix);
    }

    stop({ defaultDocsDeleted, userDocsDeleted, storageObjectsDeleted });
    return { defaultDocsDeleted, userDocsDeleted, storageObjectsDeleted };
}

export async function GetAllComponents(userId?: string | null): Promise<ComponentSummary[]> {
    const all = await getAllComponentsFull(userId);
    return all.map(c => ({
        id: c.id,
        shortDesc: c.shortDesc,
        gsPath: c.gsPath,
        ...(c.role !== undefined && { role: c.role }),
        ...(c.builtIn !== undefined && { builtIn: c.builtIn })
    }));
}

export async function GetComponents(purpose: string, userId?: string | null): Promise<ComponentUsageSummary[]> {
    const allComponents = await getAllComponentsFull(userId);
    const normalizedPurpose = purpose.toLowerCase().trim();
    if (!normalizedPurpose) {
        return allComponents.slice(0, 20).map(fullToUsage);
    }

    const terms = normalizedPurpose.split(/\s+/g).filter((term) => term.length > 1);
    if (terms.length === 0) {
        return allComponents.slice(0, 20).map(fullToUsage);
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

    return (scored.length > 0 ? scored : allComponents.slice(0, 5)).map(fullToUsage);
}

export async function CreateComponent(id: string, prompt: string, userId?: string | null): Promise<ComponentMutationResult> {
    return createOrUpdateComponent("create", id, prompt, { depth: 0, lineage: [], userId: userId ?? null });
}

export async function UpdateComponent(id: string, prompt: string, userId?: string | null): Promise<ComponentMutationResult> {
    return createOrUpdateComponent("update", id, prompt, { depth: 0, lineage: [], userId: userId ?? null });
}

async function executeComponentToolCallInternal(
    toolName: string,
    args: unknown,
    context: ToolExecutionContext
): Promise<unknown> {
    const safeArgs = toObjectArgs(args);

    switch (toolName) {
        case "GetAllComponents":
            return GetAllComponents(context.userId);
        case "GetComponents":
            return GetComponents(readRequiredStringArg(safeArgs, "purpose", toolName), context.userId);
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


function ensureTwind(code: string) : string {
    let dependency = `import install from "https://esm.sh/@twind/with-web-components";
    import  { defineConfig } from "https://esm.sh/@twind/core";
import presetAutoprefix from 'https://esm.sh/@twind/preset-autoprefix';
import presetTailwind from 'https://esm.sh/@twind/preset-tailwind';
    const config =  defineConfig({
        presets: [
            presetAutoprefix(),
            presetTailwind()
        ],
        hash: false
});
    let withTwind = install(config)`;
    if (!code.includes("@twind/with-web-components")) {
        code = `${dependency}\n\n${code}`;
    }
    let extendsTwind = "extends withTwind(HTMLElement)";
    if (!code.includes(extendsTwind)) {
        code = code.replace("extends HTMLElement", extendsTwind);
    }
    return code;

}
// ---------------------------------------------------------------------------
// createOrUpdateComponent — orchestrates design + codegen, routes writes
// ---------------------------------------------------------------------------

async function createOrUpdateComponent(
    mode: ComponentMutationMode,
    rawId: string,
    prompt: string,
    context: ToolExecutionContext
): Promise<ComponentMutationResult> {
    if (context.depth > MAX_RECURSION_DEPTH) {
        log.warn("max_depth_exceeded", { depth: context.depth, lineage: context.lineage, rawId });
        throw new Error(`Max component recursion depth (${MAX_RECURSION_DEPTH}) exceeded.`);
    }

    ensureFirebaseApp();

    const id = normalizeComponentId(rawId, prompt);

    if (BUILT_IN_IDS.has(id)) {
        throw new Error(`Component '${id}' is a built-in and cannot be created or updated.`);
    }

    if (context.lineage.includes(id)) {
        log.warn("cycle_detected", { id, lineage: context.lineage });
        throw new Error(`Recursive component cycle detected for component '${id}'.`);
    }

    // Decide which scope this mutation writes to:
    //   create               → default (shared library)
    //   update + userId      → user override
    //   update + no userId   → default (preserves prior behaviour for unauthenticated flows;
    //                          in practice the MCP layer hides UpdateComponent when no userId,
    //                          so this branch is rare).
    const writeScope: Scope = mode === "update" && context.userId
        ? { kind: "user", userId: context.userId }
        : { kind: "default" };

    const opLog = log.child(mode, {
        id,
        depth: context.depth,
        lineage: context.lineage,
        scope: writeScope.kind,
        userId: context.userId ?? null
    });
    const stop = opLog.time("op", { prompt_chars: prompt.length });

    // Resolve previous code/spec from the user override first (if applicable),
    // falling back to the default. This makes the first user override start
    // from the default's spec, which is what we want.
    const userExisting = context.userId ? await readComponentDocAt({ kind: "user", userId: context.userId }, id) : null;
    const defaultExisting = await readComponentDocAt({ kind: "default" }, id);

    const writeScopeExisting = writeScope.kind === "user" ? userExisting : defaultExisting;
    const lookupExisting = userExisting ?? defaultExisting;

    if (mode === "create" && writeScopeExisting?.gsPath) {
        stop({ reused: true, scope: writeScope.kind });
        return {
            id,
            shortDesc: writeScopeExisting.shortDesc ?? "",
            gsPath: writeScopeExisting.gsPath
        };
    }

    const previousCode = lookupExisting?.gsPath ? await readComponentSourceFromGsPath(lookupExisting.gsPath) : "";
    const previousSpec = lookupExisting?.spec;
    
    const designResult = await designComponent({
        id,
        prompt,
        mode,
        previousSpec,
        context: {
            depth: context.depth,
            lineage: [...context.lineage, id],
            userId: context.userId ?? null
        }
    });

    if (designResult.kind === "rejected") {
        opLog.warn("design_rejected", {
            id,
            reason: designResult.reason,
            suggestion: designResult.suggestion ?? null
        });
        stop({ rejected: true, scope: writeScope.kind });
        return {
            rejected: true,
            id,
            reason: designResult.reason,
            ...(designResult.suggestion ? { suggestion: designResult.suggestion } : {})
        };
    }

    const spec = designResult.spec;
    let code = await generateAndEvaluateCode({ id, spec, previousCode, mode });
    code = ensureTwind(code);
    const gsPath = await storeComponentSourceAt(writeScope, id, code);

    const dependencyIds = Array.from(new Set(spec.dependencies.map((d) => d.id).filter((s): s is string => typeof s === "string" && s.length > 0)));

    const payload: Record<string, unknown> = {
        id,
        shortDesc: spec.shortDesc,
        gsPath,
        prompt,
        dependencies: dependencyIds,
        spec,
        updatedAt: FieldValue.serverTimestamp()
    };

    payload.createdAt = writeScopeExisting?.createdAt ?? FieldValue.serverTimestamp();

    const docRef = docRefFor(writeScope, id);
    await docRef.set(payload, { merge: true });

    stop({
        reused: false,
        code_chars: code.length,
        dependencies: dependencyIds,
        gsPath,
        scope: writeScope.kind
    });

    return {
        id,
        shortDesc: spec.shortDesc,
        gsPath
    };
}

// ---------------------------------------------------------------------------
// Phase 1: designComponent — agentic; uses tools to discover/create dependencies
// ---------------------------------------------------------------------------

type DesignerOutcome =
    | { kind: "spec"; spec: ComponentSpec }
    | { kind: "rejected"; reason: string; suggestion?: string };

async function designComponent(input: {
    id: string;
    prompt: string;
    mode: ComponentMutationMode;
    previousSpec?: ComponentSpec;
    context: ToolExecutionContext;
}): Promise<DesignerOutcome> {
    const userPreferences = input.context.userId ? await GetUserPreferences(input.context.userId) : [];
    const messageParts: string[] = [
        `Component ID: ${input.id}`,
        `Operation: ${input.mode}`,
        `Task: ${input.prompt}`,
        input.previousSpec
            ? `Existing spec to revise:\n\n${JSON.stringify(input.previousSpec, null, 2)}`
            : "No existing spec was found for this component."
    ];

    if (userPreferences.length) {
        messageParts.push(
            `User preferences (apply these to the spec where they make sense — styling, language, copy tone, accessibility, etc.):\n${formatPreferencesForPrompt(userPreferences)}`
        );
    }

    messageParts.push("Begin by inspecting the existing component library so the new component aligns with the established visual language. Then return strict JSON only matching the ComponentSpec shape described in the system prompt.");

    const userMessage = messageParts.join("\n\n");

    const systemInstruction = componentDesignerPrompt;
    const model = requireEnv("COMPONENT_DESIGNER_MODEL");

    const designLog = log.child("design", {
        id: input.id,
        mode: input.mode,
        depth: input.context.depth,
        model,
        provider: resolveProviderName(model),
        userId: input.context.userId ?? null
    });

    let toolCallCount = 0;

    const executeWithBudget = async (toolName: string, fn: () => Promise<unknown>): Promise<unknown> => {
        toolCallCount += 1;
        if (toolCallCount > MAX_TOOL_CALLS_PER_GENERATION) {
            throw new Error(`Exceeded max tool calls (${MAX_TOOL_CALLS_PER_GENERATION}) while designing component '${input.id}'.`);
        }

        const toolStop = designLog.time("tool_call", {
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

    // Tools are assembled into a loosely-typed record to allow conditionally
    // including UpdateComponent. The AI SDK's `tool()` factory is generic, so a
    // single concrete `Record<string, Tool<...>>` cannot express tools with
    // different input schemas. We rely on the AI SDK's runtime tool dispatch.
    const tools: Record<string, unknown> = {
        GetAllComponents: tool({
            description: "Returns all existing reusable components as summaries.",
            inputSchema: z.object({}),
            execute: async () => executeWithBudget("GetAllComponents", () => GetAllComponents(input.context.userId))
        }),
        GetComponents: tool({
            description: "Finds existing reusable components that match a specific purpose.",
            inputSchema: z.object({
                purpose: z.string().min(1).describe("Short description of what kind of component you need.")
            }),
            execute: async ({ purpose }) => executeWithBudget("GetComponents", () => GetComponents(purpose, input.context.userId))
        }),
        CreateComponent: tool({
            description: "Creates a new reusable JavaScript web component and stores it in Firebase.",
            inputSchema: z.object({
                id: z.string().min(1).describe("Unique component ID, preferably kebab-case."),
                prompt: z.string().min(1).describe("Specification for the component to generate.")
            }),
            execute: async ({ id, prompt }) => executeWithBudget("CreateComponent", () => createOrUpdateComponent("create", id, prompt, {
                depth: input.context.depth + 1,
                lineage: [...input.context.lineage],
                userId: input.context.userId ?? null
            }))
        })
    };

    if (input.context.userId) {
        tools.UpdateComponent = tool({
            description: "Updates an existing reusable JavaScript web component and stores the new version as a per-user override.",
            inputSchema: z.object({
                id: z.string().min(1).describe("ID of the existing component to update."),
                prompt: z.string().min(1).describe("Requested changes to apply to the component.")
            }),
            execute: async ({ id, prompt }) => executeWithBudget("UpdateComponent", () => createOrUpdateComponent("update", id, prompt, {
                depth: input.context.depth + 1,
                lineage: [...input.context.lineage],
                userId: input.context.userId ?? null
            }))
        });
    }

    const llmStop = designLog.time("llm_call");
    const result = await generateText({
        model: resolveLanguageModel(model),
        system: systemInstruction,
        prompt: userMessage,
        tools: tools as Parameters<typeof generateText>[0]["tools"],
        stopWhen: stepCountIs(MAX_TOOL_CALLS_PER_GENERATION + 1),
        onStepFinish(step) {
            designLog.debug("step_finished", {
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
        designLog.error("empty_final_text", { steps: result.steps.length, toolCallCount });
        throw new Error(`Designer returned an empty response while designing component '${input.id}'.`);
    }

    designLog.info("design_complete", {
        iterations: result.steps.length,
        tool_calls_total: toolCallCount,
        final_chars: finalText.length
    });

    return parseDesignerOutput(finalText, input.id);
}

// ---------------------------------------------------------------------------
// Phase 2: generateComponentCodeFromSpec — single-shot, no tools
// ---------------------------------------------------------------------------

async function generateComponentCodeFromSpec(input: {
    id: string;
    spec: ComponentSpec;
    previousCode: string;
    mode: ComponentMutationMode;
    evaluatorFeedback?: { issues: string[]; suggestion?: string };
}): Promise<string> {
    const messageParts: string[] = [
        `Component ID: ${input.id}`,
        `Operation: ${input.mode}`,
        `Spec:\n\n${JSON.stringify(input.spec, null, 2)}`,
        input.previousCode
            ? `Existing source to revise:\n\n${input.previousCode}`
            : "No existing source was found."
    ];

    if (input.evaluatorFeedback) {
        const issuesBlock = input.evaluatorFeedback.issues.map((line) => `- ${line}`).join("\n");
        const feedback = [
            "Evaluator feedback from previous attempt — fix every issue listed before emitting code:",
            issuesBlock,
            input.evaluatorFeedback.suggestion ? `Suggested fix: ${input.evaluatorFeedback.suggestion}` : ""
        ].filter((part) => part.length > 0).join("\n");
        messageParts.push(feedback);
    }

    messageParts.push("Output ONLY the final JavaScript source for this component. No JSON wrapper, no markdown fences, no commentary.");

    const userMessage = messageParts.join("\n\n");

    const model = requireEnv("COMPONENT_CODEGEN_MODEL");
    const codegenLog = log.child("codegen", {
        id: input.id,
        mode: input.mode,
        model,
        provider: resolveProviderName(model)
    });

    const llmStop = codegenLog.time("llm_call");
    const result = await generateText({
        model: resolveLanguageModel(model),
        system: componentCodegenPrompt,
        prompt: userMessage
    });
    llmStop({
        ok: true,
        finish_reason: result.finishReason,
        total_tokens: result.totalUsage.totalTokens
    });

    const finalText = result.text?.trim();
    if (!finalText) {
        codegenLog.error("empty_final_text", { id: input.id });
        throw new Error(`Codegen returned an empty response for component '${input.id}'.`);
    }

    let code = stripCodeFence(finalText).trim();
    if (!code) {
        throw new Error(`Could not extract code for component '${input.id}'.`);
    }
    // add twind

    /*
      import install from "@twind/with-web-components";
  let withTwind = install({})
  https://esm.sh/@twind/preset-autoprefix
    */
    
    // ensure connectedCallback and disconnectedCallback call super:
    
    codegenLog.info("codegen_complete", { code_chars: code.length });
    return code;
}

// ---------------------------------------------------------------------------
// Phase 2b: evaluator-optimizer loop around codegen
//
// Single-retry evaluator: generate → evaluate → on failure, regenerate once
// with feedback, then accept whatever the second attempt produced. The retry
// budget is intentionally tight — the evaluator is a quality safety net, not
// an open-ended search.
// ---------------------------------------------------------------------------

interface EvaluatorVerdict {
    ok: boolean;
    issues: string[];
    suggestion?: string;
}

async function evaluateComponentCode(input: { id: string; spec: ComponentSpec; code: string }): Promise<EvaluatorVerdict> {
    const userMessage = [
        `Component ID: ${input.id}`,
        `Spec:\n\n${JSON.stringify(input.spec, null, 2)}`,
        `Generated source:\n\n${input.code}`,
        "Evaluate the source against every rule in the system prompt. Return JSON only."
    ].join("\n\n");

    const model = requireEnv("COMPONENT_EVALUATOR_MODEL");
    const evalLog = log.child("evaluator", {
        id: input.id,
        model,
        provider: resolveProviderName(model)
    });

    const llmStop = evalLog.time("llm_call");
    let result;
    try {
        result = await generateText({
            model: resolveLanguageModel(model),
            system: componentEvaluatorPrompt,
            prompt: userMessage
        });
    } catch (error) {
        llmStop({ ok: false, error });
        evalLog.warn("eval_failed", { id: input.id, error });
        return { ok: true, issues: [] };
    }
    llmStop({
        ok: true,
        finish_reason: result.finishReason,
        total_tokens: result.totalUsage.totalTokens
    });

    const finalText = result.text?.trim() ?? "";
    if (!finalText) {
        evalLog.warn("empty_verdict", { id: input.id });
        return { ok: true, issues: [] };
    }

    const text = stripCodeFence(finalText).trim();
    const candidate = extractJsonCandidate(text) ?? text;

    let parsed: Record<string, unknown> | null = null;
    try {
        const value = JSON.parse(candidate);
        if (value && typeof value === "object" && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>;
        }
    } catch {
        evalLog.warn("verdict_parse_failed", { id: input.id, sample: text.slice(0, 200) });
        return { ok: true, issues: [] };
    }

    const ok = parsed?.ok === true;
    const issues = Array.isArray(parsed?.issues)
        ? (parsed!.issues as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : [];
    const suggestion = typeof parsed?.suggestion === "string" && parsed.suggestion.trim()
        ? parsed.suggestion.trim()
        : undefined;

    evalLog.info("eval_done", { id: input.id, ok, issue_count: issues.length });

    return { ok, issues, suggestion };
}

async function generateAndEvaluateCode(input: {
    id: string;
    spec: ComponentSpec;
    previousCode: string;
    mode: ComponentMutationMode;
}): Promise<string> {
    const optimizerLog = log.child("optimizer", { id: input.id });

    let code = await generateComponentCodeFromSpec({
        id: input.id,
        spec: input.spec,
        previousCode: input.previousCode,
        mode: input.mode
    });

    let verdict = await evaluateComponentCode({ id: input.id, spec: input.spec, code });
    if (verdict.ok) {
        return code;
    }

    for (let attempt = 1; attempt <= MAX_CODEGEN_RETRIES; attempt++) {
        optimizerLog.info("codegen_retry", {
            id: input.id,
            attempt,
            issues: verdict.issues,
            suggestion: verdict.suggestion ?? null
        });

        code = await generateComponentCodeFromSpec({
            id: input.id,
            spec: input.spec,
            previousCode: input.previousCode,
            mode: input.mode,
            evaluatorFeedback: { issues: verdict.issues, suggestion: verdict.suggestion }
        });

        verdict = await evaluateComponentCode({ id: input.id, spec: input.spec, code });
        if (verdict.ok) {
            return code;
        }
    }

    optimizerLog.warn("codegen_unresolved", {
        id: input.id,
        issues: verdict.issues,
        suggestion: verdict.suggestion ?? null
    });
    return code;
}

// ---------------------------------------------------------------------------
// Spec parsing
// ---------------------------------------------------------------------------

function parseDesignerOutput(rawText: string, fallbackId: string): DesignerOutcome {
    const text = stripCodeFence(rawText).trim();
    const candidate = extractJsonCandidate(text) ?? text;

    let parsed: Record<string, unknown> | null = null;
    try {
        const value = JSON.parse(candidate);
        if (value && typeof value === "object" && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>;
        }
    } catch {
        // fall through — parseComponentSpec will log its own warning if the spec is unrecoverable.
    }

    if (parsed && parsed.rejected === true) {
        const reason = typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : "Component designer refused without giving a reason.";
        const suggestion = typeof parsed.suggestion === "string" && parsed.suggestion.trim()
            ? parsed.suggestion.trim()
            : undefined;
        return { kind: "rejected", reason, suggestion };
    }

    return { kind: "spec", spec: parseComponentSpec(rawText, fallbackId) };
}

function parseComponentSpec(rawText: string, fallbackId: string): ComponentSpec {
    const text = stripCodeFence(rawText).trim();
    const candidate = extractJsonCandidate(text) ?? text;

    let parsed: Partial<ComponentSpec> = {};
    try {
        parsed = JSON.parse(candidate) as Partial<ComponentSpec>;
    } catch {
        log.warn("spec_parse_failed", { id: fallbackId, sample: text.slice(0, 200) });
    }

    const styling = (parsed.styling && typeof parsed.styling === "object") ? parsed.styling as ComponentSpec["styling"] : undefined;

    return {
        id: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : fallbackId,
        shortDesc: typeof parsed.shortDesc === "string" && parsed.shortDesc.trim()
            ? parsed.shortDesc.trim()
            : "Generated reusable component",
        role: typeof parsed.role === "string" && parsed.role.trim() ? parsed.role.trim() : "leaf",
        props: Array.isArray(parsed.props) ? parsed.props.filter(isObject) as ComponentSpecProp[] : [],
        slots: Array.isArray(parsed.slots) ? parsed.slots.filter(isObject) as ComponentSpecSlot[] : [],
        styling: {
            tailwindClasses: typeof styling?.tailwindClasses === "string" ? styling.tailwindClasses : "",
            palette: Array.isArray(styling?.palette) ? styling!.palette.filter((p): p is string => typeof p === "string") : [],
            notes: typeof styling?.notes === "string" ? styling.notes : ""
        },
        dependencies: Array.isArray(parsed.dependencies)
            ? parsed.dependencies.filter(isObject).map((d) => ({
                id: typeof (d as ComponentSpecDependency).id === "string" ? (d as ComponentSpecDependency).id : "",
                usage: typeof (d as ComponentSpecDependency).usage === "string" ? (d as ComponentSpecDependency).usage : ""
            })).filter((d) => d.id)
            : [],
        interactions: Array.isArray(parsed.interactions) ? parsed.interactions.filter(isObject) as ComponentSpecInteraction[] : [],
        accessibility: typeof parsed.accessibility === "string" ? parsed.accessibility : "",
        markupSketch: typeof parsed.markupSketch === "string" ? parsed.markupSketch : ""
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Storage / Firestore helpers
// ---------------------------------------------------------------------------

function objectPathFor(scope: Scope, id: string): string {
    if (scope.kind === "user") {
        return `${USERS_COLLECTION}/${scope.userId}/${COMPONENTS_STORAGE_PREFIX}/${id}.js`;
    }
    return `${COMPONENTS_STORAGE_PREFIX}/${id}.js`;
}

function docRefFor(scope: Scope, id: string) {
    const db = getFirestore();
    if (scope.kind === "user") {
        return db.collection(USERS_COLLECTION).doc(scope.userId).collection(USER_COMPONENTS_SUBCOLLECTION).doc(id);
    }
    return db.collection(COMPONENTS_COLLECTION).doc(id);
}

async function readComponentDocAt(scope: Scope, id: string): Promise<ComponentDocument | null> {
    const docSnap = await docRefFor(scope, id).get();
    if (!docSnap.exists) return null;
    return docSnap.data() as ComponentDocument;
}

async function storeComponentSourceAt(scope: Scope, id: string, code: string): Promise<string> {
    ensureFirebaseApp();
    const bucket = getStorage().bucket();
    const objectPath = objectPathFor(scope, id);
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

async function readComponentSourceFromGsPath(gsPath: string): Promise<string> {
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
    let candidate = rawId.trim() || prompt.trim();
    if (!candidate.startsWith("g-")) {
        candidate = `g-${candidate}`;
    }
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
