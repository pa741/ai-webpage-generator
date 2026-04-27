import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
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
    : 'info';

function emit(level: LogLevel, scope: string, msg: string, fields: LogFields | undefined, baseFields: LogFields): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) {
        return;
    }
    const ctx = requestStorage.getStore();
    const line: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        scope,
        msg
    };
    if (ctx?.requestId) line.requestId = ctx.requestId;
    Object.assign(line, ctx?.fields, baseFields, fields);

    let serialized: string;
    try {
        serialized = JSON.stringify(line, errorAwareReplacer);
    } catch {
        serialized = JSON.stringify({ ts: line.ts, level, scope, msg, error: 'log_serialize_failed' });
    }

    const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    target(serialized);
}

function errorAwareReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
}

export class Logger {
    constructor(private readonly scope: string, private readonly baseFields: LogFields = {}) {}

    child(subScope: string, fields: LogFields = {}): Logger {
        return new Logger(`${this.scope}.${subScope}`, { ...this.baseFields, ...fields });
    }

    bind(fields: LogFields): Logger {
        return new Logger(this.scope, { ...this.baseFields, ...fields });
    }

    debug(msg: string, fields?: LogFields): void { emit('debug', this.scope, msg, fields, this.baseFields); }
    info(msg: string, fields?: LogFields): void { emit('info', this.scope, msg, fields, this.baseFields); }
    warn(msg: string, fields?: LogFields): void { emit('warn', this.scope, msg, fields, this.baseFields); }
    error(msg: string, fields?: LogFields): void { emit('error', this.scope, msg, fields, this.baseFields); }

    /**
     * Returns a function that, when called, logs `${label}.done` with `duration_ms`
     * and any extra fields you pass at completion time.
     */
    time(label: string, startFields: LogFields = {}): (extra?: LogFields) => number {
        const t0 = performance.now();
        this.debug(`${label}.start`, startFields);
        return (extra?: LogFields) => {
            const duration_ms = Math.round(performance.now() - t0);
            this.info(`${label}.done`, { ...startFields, ...extra, duration_ms });
            return duration_ms;
        };
    }
}

export const logger = new Logger('app');

/** Run `fn` with a request-scoped context that adds `requestId` and `baseFields` to every log line. */
export function withRequestContext<T>(requestId: string, baseFields: LogFields, fn: () => Promise<T> | T): Promise<T> | T {
    return requestStorage.run({ requestId, fields: baseFields }, fn);
}

export function currentRequestId(): string | undefined {
    return requestStorage.getStore()?.requestId;
}

export function generateRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
