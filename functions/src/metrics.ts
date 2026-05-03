import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface LlmRecord {
    id: string;
    contextId: string;
    contextType: string;
    phase: string;
    model: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    finishReason: string;
    toolCallsTotal: number;
    startedAt: string;
}

interface ToolRecord {
    id: string;
    contextId: string;
    contextType: string;
    toolName: string;
    durationMs: number;
    ok: boolean;
    startedAt: string;
}

interface ComponentMetricsContext {
    componentId: string;
    mode: string;
    llmCalls: LlmRecord[];
    toolCalls: ToolRecord[];
}

const store = new AsyncLocalStorage<ComponentMetricsContext>();

// Default: two levels up from functions/src or functions/lib → project root/metrics
function metricsDir(): string {
    return process.env.METRICS_DIR ? resolve(process.env.METRICS_DIR) : resolve(__dirname, '../../metrics');
}

const HEADERS = {
    llm_calls: 'id,contextId,contextType,phase,model,durationMs,inputTokens,outputTokens,totalTokens,finishReason,toolCallsTotal,startedAt\n',
    tool_calls: 'id,contextId,contextType,toolName,durationMs,ok,startedAt\n',
} as const;

function csvCell(v: string | number | boolean): string {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
}

function appendRow(file: keyof typeof HEADERS, fields: (string | number | boolean)[]): void {
    try {
        const dir = metricsDir();
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const path = join(dir, `${file}.csv`);
        if (!existsSync(path)) writeFileSync(path, HEADERS[file]);
        appendFileSync(path, fields.map(csvCell).join(',') + '\n');
    } catch {
        // metrics writes must never crash the app
    }
}

function newId(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `id_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function withComponentMetrics<T>(componentId: string, mode: string, fn: () => Promise<T>): Promise<T> {
    const ctx: ComponentMetricsContext = { componentId, mode, llmCalls: [], toolCalls: [] };
    return store.run(ctx, async () => {
        try {
            return await fn();
        } finally {
            for (const c of ctx.llmCalls) {
                appendRow('llm_calls', [c.id, c.contextId, c.contextType, c.phase, c.model, c.durationMs, c.inputTokens, c.outputTokens, c.totalTokens, c.finishReason, c.toolCallsTotal, c.startedAt]);
            }
            for (const c of ctx.toolCalls) {
                appendRow('tool_calls', [c.id, c.contextId, c.contextType, c.toolName, c.durationMs, c.ok, c.startedAt]);
            }
        }
    });
}

export function recordLlmCall(data: {
    phase: string;
    model: string;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    finishReason?: string;
    toolCallsTotal?: number;
    startedAt: Date;
}): void {
    const ctx = store.getStore();
    if (!ctx) return;
    ctx.llmCalls.push({
        id: newId(),
        contextId: ctx.componentId,
        contextType: `component.${ctx.mode}`,
        phase: data.phase,
        model: data.model,
        durationMs: data.durationMs,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        totalTokens: data.totalTokens ?? 0,
        finishReason: data.finishReason ?? '',
        toolCallsTotal: data.toolCallsTotal ?? 0,
        startedAt: data.startedAt.toISOString(),
    });
}

export function recordToolCall(data: {
    toolName: string;
    durationMs: number;
    ok: boolean;
    startedAt: Date;
}): void {
    const ctx = store.getStore();
    if (!ctx) return;
    ctx.toolCalls.push({
        id: newId(),
        contextId: ctx.componentId,
        contextType: `component.${ctx.mode}`,
        toolName: data.toolName,
        durationMs: data.durationMs,
        ok: data.ok,
        startedAt: data.startedAt.toISOString(),
    });
}
