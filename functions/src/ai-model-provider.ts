import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

const GEMINI_MODEL_MARKER = /gemini/i;

function requireAnyEnv(varNames: string[], modelId: string): string {
    for (const varName of varNames) {
        const value = process.env[varName]?.trim();
        if (value) {
            return value;
        }
    }

    throw new Error(
        `Missing API key for model '${modelId}'. Set one of: ${varNames.join(", ")}.`
    );
}

export function isGeminiModel(modelId: string): boolean {
    return GEMINI_MODEL_MARKER.test(modelId);
}

export function resolveProviderName(modelId: string): "google" | "cerebras" {
    return isGeminiModel(modelId) ? "google" : "cerebras";
}

// Cerebras reasoning models include `reasoning_content` on assistant messages in their
// responses. The SDK stores these verbatim and re-sends them in subsequent requests, where
// the field is invalid. Strip it from outgoing messages before each request.
async function cerebrasNormalizingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (init?.body && typeof init.body === 'string') {
        try {
            const body = JSON.parse(init.body);
            if (Array.isArray(body?.messages)) {
                for (const msg of body.messages as Record<string, unknown>[]) {
                    if (msg.role === 'assistant') delete msg.reasoning_content;
                }
                init = { ...init, body: JSON.stringify(body) };
            }
        } catch {
            // not JSON — pass through unchanged
        }
    }
    return fetch(input, init);
}

export function resolveLanguageModel(modelId: string): LanguageModel {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) {
        throw new Error("Model ID is required.");
    }

    if (isGeminiModel(normalizedModelId)) {
        const apiKey = requireAnyEnv([
            "GOOGLE_GENERATIVE_AI_API_KEY",
            "GEMINI_API_KEY"
        ], normalizedModelId);

        const google = createGoogleGenerativeAI({ apiKey });
        return google(normalizedModelId);
    }

    const cerebrasApiKey = requireAnyEnv(["CEREBRAS_API_KEY"], normalizedModelId);
    const cerebras = createCerebras({ apiKey: cerebrasApiKey, fetch: cerebrasNormalizingFetch });
    return cerebras(normalizedModelId);
}
