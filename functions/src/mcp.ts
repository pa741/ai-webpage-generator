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
    //AddFavoriteWord,
    //GetFavoriteWords,
    GetRandomWord,
    GetWord,
    GetWordOfTheDay,
    SearchWords,
} from "./word-manager";
import { generateRequestId, logger, withRequestContext } from "./logger";
interface AuthContext {
    userId: string | null;
    authError: string | null;
}

const log = logger.child("mcp");

function instrument<Args extends Record<string, unknown>>(
    toolName: string,
    handler: (args: Args) => Promise<unknown>
) {
    return async (args: Args) => {
        const stop = log.time(`tool.${toolName}`, { tool: toolName, arg_keys: Object.keys(args ?? {}) });
        try {
            const result = await handler(args);
            stop({ ok: true });
            return toToolContent(result);
        } catch (error) {
            stop({ ok: false, error });
            log.warn("tool_failed", { tool: toolName, error });
            throw error;
        }
    };
}

const registerTools = (mcp: McpServer, authContext: AuthContext) => {
    mcp.registerTool("GetAllComponents", {
        description: "Returns all existing reusable components as summaries.",
        inputSchema: {}
    }, instrument("GetAllComponents", async () => GetAllComponents()));

    mcp.registerTool("GetComponents", {
        description: "Finds existing reusable components that match a specific purpose.",
        inputSchema: {
            purpose: z.string().min(1)
        }
    }, instrument("GetComponents", async ({ purpose }) => GetComponents(purpose)));

    mcp.registerTool("CreateComponent", {
        description: "Creates a new reusable JavaScript web component and stores it in Firebase.",
        inputSchema: {
            id: z.string().min(1),
            prompt: z.string().min(1)
        }
    }, instrument("CreateComponent", async ({ id, prompt }) => CreateComponent(id, prompt)));

    mcp.registerTool("UpdateComponent", {
        description: "Updates an existing reusable JavaScript web component and stores the new version.",
        inputSchema: {
            id: z.string().min(1),
            prompt: z.string().min(1)
        }
    }, instrument("UpdateComponent", async ({ id, prompt }) => UpdateComponent(id, prompt)));

    mcp.registerTool("GetWord", {
        description: "Returns metadata for one exact dictionary word match.",
        inputSchema: {
            word: z.string()
        }
    }, instrument("GetWord", async ({ word }) => GetWord(word)));

    mcp.registerTool("SearchWords", {
        description: "Searches words using fuzzy matching against the word-list corpus.",
        inputSchema: {
            query: z.string().min(1),
            limit: z.number().int().min(1).max(50).optional()
        }
    }, instrument("SearchWords", async ({ query, limit }) => SearchWords(query, limit)));

    mcp.registerTool("GetRandomWord", {
        description: "Returns a random word from the word-list corpus.",
        inputSchema: {
            minLength: z.number().int().min(1).max(64).optional(),
            maxLength: z.number().int().min(1).max(64).optional()
        }
    }, instrument("GetRandomWord", async ({ minLength, maxLength }) => {
        if (typeof minLength === "number" && typeof maxLength === "number" && minLength > maxLength) {
            throw new Error("minLength cannot be larger than maxLength.");
        }
        return GetRandomWord(minLength, maxLength);
    }));

    mcp.registerTool("WordOfTheDay", {
        description: "Returns the word of the day.",
        inputSchema: {
            
            date: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/).optional()
        }
    }, instrument("WordOfTheDay", async ({  date }) => GetWordOfTheDay( date)));

    // mcp.registerTool("AddFavoriteWord", {
    //     description: "Adds a word to the authenticated user's favorites.",
    //     inputSchema: {
    //         word: z.string().min(1)
    //     }
    // }, instrument("AddFavoriteWord", async ({ word }) => {
    //     const userId = requireUserId(authContext);
    //     return AddFavoriteWord(userId, word);
    // }));

    // mcp.registerTool("GetFavoriteWords", {
    //     description: "Lists the authenticated user's favorited words.",
    //     inputSchema: {
    //         limit: z.number().int().min(1).max(100).optional()
    //     }
    // }, instrument("GetFavoriteWords", async ({ limit }) => {
    //     const userId = requireUserId(authContext);
    //     return GetFavoriteWords(userId, limit);
    // }));
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

// function requireUserId(authContext: AuthContext): string {
//     if (authContext.userId) {
//         return authContext.userId;
//     }
//     log.warn("auth_required_but_missing", { reason: authContext.authError });
//     throw new Error(authContext.authError ?? "Unauthorized. Provide a Firebase ID token in Authorization: Bearer <token>.");
// }

async function resolveAuthContext(request: IncomingMessage): Promise<AuthContext> {
    //debug userid
    if (process.env.FUNCTIONS_EMULATOR == "true" == true) {
        return {
            userId: "emulator-user",
            authError: null
        };


    }
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
    } catch (error) {
        log.warn("auth_token_invalid", { error });
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
    const requestId = (request.headers["x-request-id"] as string | undefined) ?? generateRequestId();

    await withRequestContext(
        requestId,
        { ip: request.socket?.remoteAddress, ua: request.headers["user-agent"] },
        async () => {
            const stop = log.time("session");
            const transport = new StreamableHTTPServerTransport({
                enableJsonResponse: true
            });
            const mcp = new McpServer({
                name: "MCP management server",
                version: "1.0.0"
            });

            const authContext = await resolveAuthContext(request);
            log.info("session_start", {
                authenticated: Boolean(authContext.userId),
                userId: authContext.userId,
                authError: authContext.authError
            });

            registerTools(mcp, authContext);

            try {
                await mcp.connect(transport);
                await transport.handleRequest(request, response);
                stop({ ok: true, status: response.statusCode });
            } catch (error) {
                stop({ ok: false, error });
                log.error("session_failed", { error });
                if (!response.headersSent) {
                    response.statusCode = 500;
                    response.end("Internal MCP error");
                }
            }
        }
    );
}
