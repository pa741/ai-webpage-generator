import { logger as fnLogger } from "firebase-functions/v2";
import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

interface RequestContext {
    requestId: string;
    fields: LogFields;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined)
    && LEVEL_RANK[process.env.LOG_LEVEL as LogLevel] !== undefined
    ? (process.env.LOG_LEVEL as LogLevel)
    : "info";

function emit(level: LogLevel, scope: string, msg: string, fields: LogFields | undefined, baseFields: LogFields): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) {
        return;
    }
    const ctx = requestStorage.getStore();
    const payload: LogFields = {
        scope,
        ...(ctx?.fields ?? {}),
        ...baseFields,
        ...(fields ?? {})
    };
    if (ctx?.requestId) payload.requestId = ctx.requestId;

    if (payload.error instanceof Error) {
        const err = payload.error;
        payload.error = { name: err.name, message: err.message, stack: err.stack };
    }

    if (level === "error") fnLogger.error(msg, payload);
    else if (level === "warn") fnLogger.warn(msg, payload);
    else if (level === "debug") fnLogger.debug(msg, payload);
    else fnLogger.info(msg, payload);
}

export class Logger {
    constructor(private readonly scope: string, private readonly baseFields: LogFields = {}) {}

    child(subScope: string, fields: LogFields = {}): Logger {
        return new Logger(`${this.scope}.${subScope}`, { ...this.baseFields, ...fields });
    }

    bind(fields: LogFields): Logger {
        return new Logger(this.scope, { ...this.baseFields, ...fields });
    }

    debug(msg: string, fields?: LogFields): void { emit("debug", this.scope, msg, fields, this.baseFields); }
    info(msg: string, fields?: LogFields): void { emit("info", this.scope, msg, fields, this.baseFields); }
    warn(msg: string, fields?: LogFields): void { emit("warn", this.scope, msg, fields, this.baseFields); }
    error(msg: string, fields?: LogFields): void { emit("error", this.scope, msg, fields, this.baseFields); }

    /**
     * Returns a function that logs `${label}.done` with `duration_ms` and any extra fields when called.
     */
    time(label: string, startFields: LogFields = {}): (extra?: LogFields) => number {
        const t0 = process.hrtime.bigint();
        this.debug(`${label}.start`, startFields);
        return (extra?: LogFields) => {
            const ns = process.hrtime.bigint() - t0;
            const duration_ms = Math.round(Number(ns) / 1e6);
            this.info(`${label}.done`, { ...startFields, ...extra, duration_ms });
            return duration_ms;
        };
    }
}

export const logger = new Logger("fn");

export function withRequestContext<T>(requestId: string, baseFields: LogFields, fn: () => Promise<T> | T): Promise<T> | T {
    return requestStorage.run({ requestId, fields: baseFields }, fn);
}

export function generateRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
