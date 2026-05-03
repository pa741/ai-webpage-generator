import type { ZodTypeAny } from "zod/v4";

export interface ToolkitContext {
    userId: string | null;
}

export interface ToolkitTool {
    name: string;
    description: string;
    inputSchema: Record<string, ZodTypeAny>;
    readOnly: boolean;
    requiresAuth?: boolean;
    handler: (args: any, ctx: ToolkitContext) => Promise<unknown>;
}

export interface DomainToolkit {
    id: string;
    description: string;
    /** Optional async override — if present, mcpHandler calls this instead of .description */
    getDescription?: () => Promise<string>;
    tools: ToolkitTool[];
}
