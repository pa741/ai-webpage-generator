import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from '$lib/logger';
import '$lib/firebase_admin';

const log = logger.child('user-preferences');

const USERS_COLLECTION = 'users';

export interface UserPreference {
    text: string;
}

export async function loadUserPreferences(userId: string | undefined): Promise<UserPreference[]> {
    if (!userId) return [];

    try {
        const snap = await getFirestore().collection(USERS_COLLECTION).doc(userId).get();
        if (!snap.exists) return [];

        const raw = snap.data()?.preferences;
        if (!Array.isArray(raw)) return [];

        return raw
            .filter((entry): entry is { text: unknown; createdAt?: unknown } => Boolean(entry) && typeof entry === 'object')
            .map((entry) => ({ text: typeof entry.text === 'string' ? entry.text : '' }))
            .filter((entry) => entry.text.trim().length > 0);
    } catch (error) {
        log.warn('load_failed', { userId, error });
        return [];
    }
}

export function formatPreferencesForPrompt(preferences: UserPreference[]): string {
    if (!preferences.length) return '';
    return preferences.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
}

// Re-export so callers can detect Timestamp values without re-importing.
export { Timestamp };
