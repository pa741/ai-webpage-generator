import { z } from "zod/v4";
import type { DomainToolkit } from "../types";
import {
    AddFavoriteWord,
    GetFavoriteWords,
    GetRandomWord,
    GetWord,
    GetWordOfTheDay,
    SearchWords
} from "./word-manager";

export const dictionaryToolkit: DomainToolkit = {
    id: "dictionary",
    description: [
        "This site is a dictionary / word-exploration website.",
        "Audience: language learners, writers, and word enthusiasts who want to discover, define, and collect words.",
        "Design hints: typography-forward, generous whitespace, calm reading-oriented palette, beige and brown is preferred; foreground definitions, etymology, and example usage; treat words themselves as visual focal points.",
        "Sample routes the user might visit: /word/<word>, /today, /random, /search, /favorites."
    ].join(" "),
    tools: [
        {
            name: "GetWord",
            description: "Returns metadata for one exact dictionary word match.",
            inputSchema: { word: z.string() },
            readOnly: true,
            handler: async ({ word }: { word: string }) => GetWord(word)
        },
        {
            name: "SearchWords",
            description: "Searches words using fuzzy matching against the word-list corpus.",
            inputSchema: {
                query: z.string().min(1),
                limit: z.number().int().min(1).max(50).optional()
            },
            readOnly: true,
            handler: async ({ query, limit }: { query: string; limit?: number }) => SearchWords(query, limit)
        },
        {
            name: "GetRandomWord",
            description: "Returns a random word from the word-list corpus.",
            inputSchema: {
                minLength: z.number().int().min(1).max(64).optional(),
                maxLength: z.number().int().min(1).max(64).optional()
            },
            readOnly: true,
            handler: async ({ minLength, maxLength }: { minLength?: number; maxLength?: number }) => {
                if (typeof minLength === "number" && typeof maxLength === "number" && minLength > maxLength) {
                    throw new Error("minLength cannot be larger than maxLength.");
                }
                return GetRandomWord(minLength, maxLength);
            }
        },
        {
            name: "WordOfTheDay",
            description: "Returns the word of the day.",
            inputSchema: {
                date: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/).optional()
            },
            readOnly: true,
            handler: async ({ date }: { date?: string }) => GetWordOfTheDay(date)
        },
        {
            name: "AddFavoriteWord",
            description: "Adds a word to the authenticated user's favorites.",
            inputSchema: { word: z.string().min(1) },
            readOnly: false,
            requiresAuth: true,
            handler: async ({ word }: { word: string }, ctx) => {
                if (!ctx.userId) throw new Error("Unauthorized.");
                return AddFavoriteWord(ctx.userId, word);
            }
        },
        {
            name: "GetFavoriteWords",
            description: "Lists the authenticated user's favorited words.",
            inputSchema: { limit: z.number().int().min(1).max(100).optional() },
            readOnly: true,
            requiresAuth: true,
            handler: async ({ limit }: { limit?: number }, ctx) => {
                if (!ctx.userId) throw new Error("Unauthorized.");
                return GetFavoriteWords(ctx.userId, limit);
            }
        }
    ]
};
