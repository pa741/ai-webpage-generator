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
    const cerebras = createCerebras({ apiKey: cerebrasApiKey});
    return cerebras(normalizedModelId);
}
