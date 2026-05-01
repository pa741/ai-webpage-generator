import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "./logger";

const log = logger.child("user-manager");

const USERS_COLLECTION = "users";
const MAX_PREFERENCES = 32;
const MAX_PREFERENCE_CHARS = 500;

export interface UserPreference {
    text: string;
    createdAt: Timestamp | null;
}

function ensureFirebaseApp(): void {
    if (getApps().length === 0) {
        initializeApp();
    }
}

export async function GetUserPreferences(userId: string): Promise<UserPreference[]> {
    if (!userId) return [];

    ensureFirebaseApp();
    const db = getFirestore();

    try {
        const snap = await db.collection(USERS_COLLECTION).doc(userId).get();
        if (!snap.exists) return [];

        const raw = snap.data()?.preferences;
        if (!Array.isArray(raw)) return [];

        return raw
            .filter((entry): entry is { text: unknown; createdAt?: unknown } => Boolean(entry) && typeof entry === "object")
            .map((entry) => ({
                text: typeof entry.text === "string" ? entry.text : "",
                createdAt: entry.createdAt instanceof Timestamp ? entry.createdAt : null
            }))
            .filter((entry) => entry.text.trim().length > 0);
    } catch (error) {
        log.warn("get_preferences_failed", { userId, error });
        return [];
    }
}

export async function SaveUserPreference(userId: string, text: string): Promise<{ ok: true; total: number }> {
    if (!userId) {
        throw new Error("SaveUserPreference requires an authenticated userId.");
    }

    const trimmed = text.trim().slice(0, MAX_PREFERENCE_CHARS);
    if (!trimmed) {
        throw new Error("SaveUserPreference requires non-empty text.");
    }

    ensureFirebaseApp();
    const db = getFirestore();
    const ref = db.collection(USERS_COLLECTION).doc(userId);

    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = (snap.exists && Array.isArray(snap.data()?.preferences))
            ? (snap.data()!.preferences as Array<{ text: unknown; createdAt?: unknown }>)
            : [];

        const filtered = existing
            .filter((entry) => Boolean(entry) && typeof entry === "object")
            .filter((entry) => typeof entry.text === "string" && entry.text.trim() !== trimmed);

        const next = [
            ...filtered.slice(-(MAX_PREFERENCES - 1)),
            { text: trimmed, createdAt: FieldValue.serverTimestamp() }
        ];

        tx.set(ref, { preferences: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return next.length;
    });

    log.info("preference_saved", { userId, total: result, chars: trimmed.length });
    return { ok: true, total: result };
}

export function formatPreferencesForPrompt(preferences: UserPreference[]): string {
    if (!preferences.length) return "";
    return preferences.map((p, i) => `${i + 1}. ${p.text}`).join("\n");
}
