import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v4";
import { IncomingMessage, ServerResponse } from "http";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
    CreateComponent,
    GetAllComponents,
    GetComponents,
    UpdateComponent
} from "./component-manager";
import {
    AddFavoriteWord,
    GetFavoriteWords,
    GetRandomWord,
    GetWord,
    GetWordOfTheDay,
    SearchWords,
    WORD_OF_DAY_PROVIDERS
} from "./word-manager";

interface AuthContext {
    userId: string | null;
    authError: string | null;
}

const registerTools = (mcp: McpServer, authContext: AuthContext) => {
    mcp.registerTool("GetAllComponents", {
        description: "Returns all existing reusable components as summaries.",
        inputSchema: {}
    }, async () => {
        const result = await GetAllComponents();
        return toToolContent(result);
    });

    mcp.registerTool("GetComponents", {
        description: "Finds existing reusable components that match a specific purpose.",
        inputSchema: {
            purpose: z.string().min(1)
        }
    }, async ({ purpose }) => {
        const result = await GetComponents(purpose);
        return toToolContent(result);
    });

    mcp.registerTool("CreateComponent", {
        description: "Creates a new reusable JavaScript web component and stores it in Firebase.",
        inputSchema: {
            id: z.string().min(1),
            prompt: z.string().min(1)
        }
    }, async ({ id, prompt }) => {
        const result = await CreateComponent(id, prompt);
        return toToolContent(result);
    });

    mcp.registerTool("UpdateComponent", {
        description: "Updates an existing reusable JavaScript web component and stores the new version.",
        inputSchema: {
            id: z.string().min(1),
            prompt: z.string().min(1)
        }
    }, async ({ id, prompt }) => {
        const result = await UpdateComponent(id, prompt);
        return toToolContent(result);
    });

    mcp.registerTool("GetWord", {
        description: "Returns metadata for one exact dictionary word match.",
        inputSchema: {
            word: z.string().min(1)
        }
    }, async ({ word }) => {
        const result = await GetWord(word);
        return toToolContent(result);
    });

    mcp.registerTool("SearchWords", {
        description: "Searches words using fuzzy matching against the word-list corpus.",
        inputSchema: {
            query: z.string().min(1),
            limit: z.number().int().min(1).max(50).optional()
        }
    }, async ({ query, limit }) => {
        const result = await SearchWords(query, limit);
        return toToolContent(result);
    });

    mcp.registerTool("GetRandomWord", {
        description: "Returns a random word from the word-list corpus.",
        inputSchema: {
            minLength: z.number().int().min(1).max(64).optional(),
            maxLength: z.number().int().min(1).max(64).optional()
        }
    }, async ({ minLength, maxLength }) => {
        if (typeof minLength === "number" && typeof maxLength === "number" && minLength > maxLength) {
            throw new Error("minLength cannot be larger than maxLength.");
        }

        const result = await GetRandomWord(minLength, maxLength);
        return toToolContent(result);
    });

    mcp.registerTool("GetWordOfTheDay", {
        description: "Returns the word of the day from the selected provider.",
        inputSchema: {
            provider: z.enum(WORD_OF_DAY_PROVIDERS).optional(),
            date: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/).optional()
        }
    }, async ({ provider, date }) => {
        const result = await GetWordOfTheDay(provider, date);
        return toToolContent(result);
    });

    mcp.registerTool("AddFavoriteWord", {
        description: "Adds a word to the authenticated user's favorites.",
        inputSchema: {
            word: z.string().min(1)
        }
    }, async ({ word }) => {
        const userId = requireUserId(authContext);
        const result = await AddFavoriteWord(userId, word);
        return toToolContent(result);
    });

    mcp.registerTool("GetFavoriteWords", {
        description: "Lists the authenticated user's favorited words.",
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional()
        }
    }, async ({ limit }) => {
        const userId = requireUserId(authContext);
        const result = await GetFavoriteWords(userId, limit);
        return toToolContent(result);
    });
};

function toToolContent(payload: unknown) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(payload)
            }
        ]
    };
}

function requireUserId(authContext: AuthContext): string {
    if (authContext.userId) {
        return authContext.userId;
    }

    throw new Error(authContext.authError ?? "Unauthorized. Provide a Firebase ID token in Authorization: Bearer <token>.");
}

async function resolveAuthContext(request: IncomingMessage): Promise<AuthContext> {
    const bearerToken = extractBearerToken(request.headers.authorization);
    if (!bearerToken) {
        return {
            userId: null,
            authError: "Unauthorized. Missing Authorization: Bearer <Firebase ID token> header."
        };
    }

    ensureFirebaseApp();

    try {
        const decoded = await getAuth().verifyIdToken(bearerToken);
        return {
            userId: decoded.uid,
            authError: null
        };
    } catch {
        return {
            userId: null,
            authError: "Unauthorized. Invalid or expired Firebase ID token."
        };
    }
}

function extractBearerToken(authorizationHeader: string | string[] | undefined): string | null {
    const rawHeader = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
    if (!rawHeader) {
        return null;
    }

    const match = rawHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
        return null;
    }

    return match[1].trim();
}

function ensureFirebaseApp(): void {
    if (getApps().length === 0) {
        initializeApp();
    }
}



export async function mcpHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    var transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        //sessionIdGenerator
        //eventStore
    });
    var mcp = new McpServer({
        name: "MCP management server",
        version: "1.0.0",


    })
    const authContext = await resolveAuthContext(request);
    registerTools(mcp, authContext);

    await mcp.connect(transport);

    transport.handleRequest(request, response);



}


