import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { CEREBRAS_API_KEY } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { logger } from '$lib/logger';

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
    logger.info("fetch_info", { input, init });
    return fetch(input, init);
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

    const cerebras = createCerebras({ apiKey: cerebrasApiKey, fetch: cerebrasNormalizingFetch });
    return cerebras(normalizedModelId);
}
