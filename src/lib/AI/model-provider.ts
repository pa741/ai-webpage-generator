import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { CEREBRAS_API_KEY } from '$env/static/private';
import { env } from '$env/dynamic/private';

const GEMINI_MODEL_MARKER = /gemini/i;

function requireValue(value: string | undefined, message: string): string {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(message);
    }

    return normalized;
}

export function isGeminiModel(modelId: string): boolean {
    return GEMINI_MODEL_MARKER.test(modelId);
}

export function resolveProviderName(modelId: string): 'google' | 'cerebras' {
    return isGeminiModel(modelId) ? 'google' : 'cerebras';
}

export function resolveLanguageModel(modelId: string): LanguageModel {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) {
        throw new Error('Model ID is required.');
    }

    if (isGeminiModel(normalizedModelId)) {
        const googleApiKey = requireValue(
            env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY,
            `Missing Google API key for model '${normalizedModelId}'. Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY.`
        );

        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        return google(normalizedModelId);
    }

    const cerebrasApiKey = requireValue(
        CEREBRAS_API_KEY,
        `Missing CEREBRAS_API_KEY for model '${normalizedModelId}'.`
    );

    const cerebras = createCerebras({ apiKey: cerebrasApiKey });
    return cerebras(normalizedModelId);
}
