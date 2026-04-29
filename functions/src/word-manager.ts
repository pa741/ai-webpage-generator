import fs from "node:fs";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<Record<string, unknown>>;

const USERS_COLLECTION = "users";
const FAVORITES_COLLECTION = "favoriteWords";
const MAX_SEARCH_LIMIT = 50;
const MAX_FAVORITES_LIMIT = 100;

const WORD_OF_DAY_DATE_REGEX = /^\d{4}\/\d{2}\/\d{2}$/;

export const WORD_OF_DAY_PROVIDERS = ["merriamWebster", "dictionaryWord", "wordThink"] as const;
export type WordOfDayProvider = typeof WORD_OF_DAY_PROVIDERS[number];

interface FuseSearchResult {
    item: string;
    score?: number;
}

interface FuseIndex {
    search(query: string, options?: { limit?: number }): FuseSearchResult[];
}

interface FuseConstructor {
    new(list: readonly string[], options: Record<string, unknown>): FuseIndex;
}

interface DictionaryApiResponse {
    code?: string;
    message?: string;
    payload?: unknown;
}

interface DictionaryApiClient {
    getDefinitionFor(input: { word: string; lang?: string }): Promise<DictionaryApiResponse>;
}

interface FavoriteWordDocument {
    word?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
}

let cachedWords: string[] | null = null;
let cachedWordSet: Set<string> | null = null;
let cachedFuse: FuseIndex | null = null;

export async function GetWord(word: string): Promise<Record<string, unknown>> {
    const exactWord = await ensureExactWordMatch(word);
    const dictionaryClient = await getDictionaryApiClient();
    const dictionaryResponse = await dictionaryClient.getDefinitionFor({ word: exactWord });

    return {
        word: exactWord,
        exactMatch: true,
        dictionary: dictionaryResponse,
        found: dictionaryResponse.code === "api-ok"
    };
}

export async function SearchWords(query: string, limit = 20): Promise<Record<string, unknown>> {
    const normalizedQuery = normalizeWord(query);
    if (!normalizedQuery) {
        return {
            query: "",
            limit: 0,
            results: []
        };
    }

    const safeLimit = clamp(Math.trunc(limit), 1, MAX_SEARCH_LIMIT);
    const fuse = await getFuseIndex();

    const fuzzyResults = fuse.search(normalizedQuery, { limit: safeLimit }).map((result) => ({
        word: result.item,
        score: typeof result.score === "number" ? Number(result.score.toFixed(4)) : null
    }));

    if (fuzzyResults.length > 0) {
        return {
            query: normalizedQuery,
            limit: safeLimit,
            results: fuzzyResults,
            source: "fuse"
        };
    }

    const words = await getWordCorpus();
    const prefixResults = words
        .filter((word) => word.startsWith(normalizedQuery))
        .slice(0, safeLimit)
        .map((word) => ({ word, score: null }));

    return {
        query: normalizedQuery,
        limit: safeLimit,
        results: prefixResults,
        source: "prefix"
    };
}

export async function GetRandomWord(minLength?: number, maxLength?: number): Promise<Record<string, unknown>> {
    const words = await getWordCorpus();
    const safeMin = typeof minLength === "number" ? clamp(Math.trunc(minLength), 1, 64) : 1;
    const safeMaxCandidate = typeof maxLength === "number" ? clamp(Math.trunc(maxLength), 1, 64) : 64;
    const safeMax = Math.max(safeMin, safeMaxCandidate);

    const candidates = words.filter((word) => word.length >= safeMin && word.length <= safeMax);

    if (candidates.length === 0) {
        throw new Error("No words available for the requested length range.");
    }

    const randomWord = candidates[Math.floor(Math.random() * candidates.length)];

    return {
        word: randomWord,
        minLength: safeMin,
        maxLength: safeMax,
        source: "word-list"
    };
}

export async function GetWordOfTheDay( dateInput?: string): Promise<Record<string, unknown>> {
    //const provider = "wordThink";
    const date = normalizeWordOfDayDate(dateInput);
    const words = await getWordCorpus();
    let seedOfDay = date ? date : new Date().toISOString().slice(0, 10);
    seedOfDay = seedOfDay.replace(/-/g, "/");
    const index = createHash("sha256").update(seedOfDay).digest().readUInt32BE(0);
    const wordOfTheDay = words[index % words.length];
    return {
        word: wordOfTheDay,
    };

}

export async function AddFavoriteWord(userId: string, word: string): Promise<Record<string, unknown>> {
    const uid = normalizeUserId(userId);
    if (!uid) {
        throw new Error("A valid userId is required to add favorites.");
    }

    const exactWord = await ensureExactWordMatch(word);

    ensureFirebaseApp();
    const db = getFirestore();
    const favoriteDocRef = db.collection(USERS_COLLECTION).doc(uid).collection(FAVORITES_COLLECTION).doc(exactWord);

    const existingDoc = await favoriteDocRef.get();
    const payload: Record<string, unknown> = {
        word: exactWord,
        updatedAt: FieldValue.serverTimestamp()
    };

    if (!existingDoc.exists) {
        payload.createdAt = FieldValue.serverTimestamp();
    }

    await favoriteDocRef.set(payload, { merge: true });

    return {
        userId: uid,
        word: exactWord,
        created: !existingDoc.exists
    };
}

export async function GetFavoriteWords(userId: string, limit = 50): Promise<Record<string, unknown>> {
    const uid = normalizeUserId(userId);
    if (!uid) {
        throw new Error("A valid userId is required to list favorites.");
    }

    const safeLimit = clamp(Math.trunc(limit), 1, MAX_FAVORITES_LIMIT);

    ensureFirebaseApp();
    const db = getFirestore();
    const snapshot = await db
        .collection(USERS_COLLECTION)
        .doc(uid)
        .collection(FAVORITES_COLLECTION)
        .orderBy("updatedAt", "desc")
        .limit(safeLimit)
        .get();

    const favorites = snapshot.docs.map((doc) => {
        const data = doc.data() as FavoriteWordDocument;
        const fallbackWord = doc.id;
        const storedWord = typeof data.word === "string" ? data.word : fallbackWord;

        return {
            word: storedWord,
            createdAt: toIsoTimestamp(data.createdAt),
            updatedAt: toIsoTimestamp(data.updatedAt)
        };
    });

    return {
        userId: uid,
        count: favorites.length,
        favorites
    };
}

async function getWordCorpus(): Promise<string[]> {
    if (cachedWords) {
        return cachedWords;
    }

    const wordListPath = await getWordListPath();
    const rawWords = fs.readFileSync(wordListPath, "utf8").split(/\r?\n/g);

    const uniqueWords = Array.from(new Set(rawWords.map(normalizeWord).filter((word) => word.length > 0)));

    cachedWords = uniqueWords;
    cachedWordSet = new Set(uniqueWords);
    return uniqueWords;
}

async function getWordSet(): Promise<Set<string>> {
    if (cachedWordSet) {
        return cachedWordSet;
    }

    await getWordCorpus();
    return cachedWordSet ?? new Set();
}

async function ensureExactWordMatch(rawWord: string): Promise<string> {
    const normalized = normalizeWord(rawWord);
    if (!normalized) {
        throw new Error("Word must be a non-empty string.");
    }

    const wordSet = await getWordSet();
    if (!wordSet.has(normalized)) {
        throw new Error(`Word '${normalized}' does not have an exact match in the word list.`);
    }

    return normalized;
}

async function getWordListPath(): Promise<string> {
    const wordListModule = await dynamicImport("word-list");
    const pathCandidate = typeof wordListModule.default === "string"
        ? wordListModule.default
        : undefined;

    if (!pathCandidate) {
        throw new Error("Could not load word-list path.");
    }

    return pathCandidate;
}

async function getFuseIndex(): Promise<FuseIndex> {
    if (cachedFuse) {
        return cachedFuse;
    }

    const words = await getWordCorpus();
    const fuseModule = await dynamicImport("fuse.js");
    const Fuse = fuseModule.default as FuseConstructor | undefined;

    if (typeof Fuse !== "function") {
        throw new Error("Could not load fuse.js constructor.");
    }

    cachedFuse = new Fuse(words, {
        includeScore: true,
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2
    });

    return cachedFuse;
}

async function getDictionaryApiClient(): Promise<DictionaryApiClient> {
    const dictionaryModule = await dynamicImport("dictionary-api-client");
    const getDefinitionFor = dictionaryModule.getDefinitionFor;

    if (typeof getDefinitionFor !== "function") {
        throw new Error("Could not load dictionary-api-client getDefinitionFor function.");
    }

    return {
        getDefinitionFor: getDefinitionFor as DictionaryApiClient["getDefinitionFor"]
    };
}




function normalizeWordOfDayDate(dateInput?: string): string | null {
    if (!dateInput) {
        return null;
    }

    const trimmed = dateInput.trim();
    if (!WORD_OF_DAY_DATE_REGEX.test(trimmed)) {
        throw new Error("date must follow yyyy/mm/dd format.");
    }

    return trimmed;
}

function normalizeWord(word: string): string {
    return word.trim().toLowerCase();
}

function normalizeUserId(userId: string): string {
    return userId.trim();
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }

    return Math.min(Math.max(value, min), max);
}

function toIsoTimestamp(value: unknown): string | null {
    if (value instanceof Timestamp) {
        return value.toDate().toISOString();
    }

    return null;
}

function ensureFirebaseApp(): void {
    if (getApps().length === 0) {
        initializeApp();
    }
}
