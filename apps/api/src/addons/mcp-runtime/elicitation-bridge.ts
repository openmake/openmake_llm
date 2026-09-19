/**
 * 외부 MCP elicitation → 에이전트 작업 HITL 브리지 (F13.10, 2026-09-17).
 *
 * 서버가 도구 실행 도중 `elicitation/create` 로 사용자 입력을 요청하면, 그 도구를 부른 에이전트 작업의
 * 승인함에 `mcp_elicit` 질문을 올리고(ask_human 과 같은 채널 — paused·푸시·answer) 답을 MCP 결과로 돌려준다.
 *
 * 작업 문맥 결정:
 * - turn-executor 가 도구 실행을 `runWithElicitationContext` 로 감싼다.
 * - 핸들러는 transport 읽기 문맥에서 돌기 때문에 AsyncLocalStorage 를 **직접 읽지 않는다** — 연결을 띄운
 *   문맥(다른 작업일 수 있다)이 잡힌다. 대신 `call()` 이 호출 시점 문맥을 in-flight 로 들고 있다가 쓴다.
 * - in-flight 작업이 0개(채팅 경로)거나 2개 이상(누구의 질문인지 모름)이면 decline.
 *
 * 마감: 외부 도구 호출은 라우터 경합 타이머와 SDK 요청 타임아웃에 묶여 있어, 사용자 답을 기다리는 동안
 * 끊기지 않도록 `inputAwareTimer` 가 입력 대기 중엔 마감을 다시 건다(절대 상한은 SDK `timeout`).
 *
 * @module mcp/elicitation-bridge
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Client } from '@modelcontextprotocol/client';
import { createLogger } from '../../utils/logger';
import { MCP_ELICITATION_BOOLEAN_WORDS, MCP_ELICITATION_LIMITS } from '../../config/runtime-limits';

const logger = createLogger('McpElicitation');

/** 승인함에 올라가는 질문의 도구 이름 — config/tool-policy 의 등급표·HITL_ALWAYS_WAIT_TOOLS 와 짝. */
export const MCP_ELICIT_TOOL_NAME = 'mcp_elicit';

export interface ElicitationAskResult {
    decision: 'approved' | 'rejected';
    /** rejected 사유 — 'user' 만 명시 거절(decline), 나머지(timeout·abort)는 cancel */
    reason?: string;
    text?: string;
}

/** 작업 문맥 — 승인 레지스트리·일시정지·알림 배선은 turn-executor 가 `ask` 에 묶어 준다(여기는 매핑만). */
export interface ElicitationContext {
    taskId: string;
    ask(args: Record<string, unknown>): Promise<ElicitationAskResult>;
}

type ElicitValue = string | number | boolean | string[];

interface ElicitPropertySchema {
    type?: string;
    enum?: unknown[];
    oneOf?: Array<{ const?: unknown }>;
    items?: { enum?: unknown[]; anyOf?: Array<{ const?: unknown }> };
}

interface ElicitSchema {
    properties?: Record<string, ElicitPropertySchema>;
    required?: string[];
}

export interface ElicitParams {
    mode?: string;
    message?: string;
    requestedSchema?: ElicitSchema;
}

export type ElicitOutcome =
    | { action: 'accept'; content: Record<string, ElicitValue> }
    | { action: 'decline' }
    | { action: 'cancel' };

const als = new AsyncLocalStorage<ElicitationContext>();

/** 도구 실행 구간에 작업 문맥을 건다(turn-executor). */
export function runWithElicitationContext<T>(ctx: ElicitationContext, fn: () => Promise<T>): Promise<T> {
    return als.run(ctx, fn);
}

/** 입력 대기 중이면 마감을 다시 거는 타이머 — 대기가 끝난 뒤엔 새 창으로 판정한다. */
export function inputAwareTimer(ms: number, isAwaitingInput: () => boolean, onTimeout: () => void): { cancel(): void } {
    let timer: NodeJS.Timeout;
    const arm = (): void => {
        timer = setTimeout(() => (isAwaitingInput() ? arm() : onTimeout()), ms);
    };
    arm();
    return { cancel: () => clearTimeout(timer) };
}

function allowedValues(list?: Array<{ const?: unknown }> | unknown[]): unknown[] | undefined {
    if (!list) return undefined;
    return list.map((v) => (v && typeof v === 'object' && 'const' in v ? (v as { const?: unknown }).const : v));
}

function toNumber(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
    return Number.isFinite(n) ? n : undefined;
}

/** 스키마 타입별 해석 — 해석할 수 없으면 undefined(→ decline). 표 밖 타입은 문자열로 받는다. */
const COERCERS: Record<string, (v: unknown, p: ElicitPropertySchema) => ElicitValue | undefined> = {
    string: (v, p) => {
        const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
        const allowed = allowedValues(p.enum ?? p.oneOf);
        return s !== undefined && (!allowed || allowed.includes(s)) ? s : undefined;
    },
    number: (v) => toNumber(v),
    integer: (v) => {
        const n = toNumber(v);
        return n !== undefined && Number.isInteger(n) ? n : undefined;
    },
    boolean: (v) => (typeof v === 'boolean' ? v : typeof v === 'string' ? MCP_ELICITATION_BOOLEAN_WORDS[v.trim().toLowerCase()] : undefined),
    array: (v, p) => {
        const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
        if (!raw) return undefined;
        const items = raw.map((x) => String(x).trim()).filter(Boolean);
        const allowed = allowedValues(p.items?.enum ?? p.items?.anyOf);
        return !allowed || items.every((i) => allowed.includes(i)) ? items : undefined;
    },
};

function parseObject(text: string): Record<string, unknown> | undefined {
    if (!text.startsWith('{')) return undefined;
    try {
        const v: unknown = JSON.parse(text);
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * PURE: 승인함 자유텍스트 답변 → elicitation content. 필드가 하나면 원문을 그 필드 값으로, 여럿이면 JSON 객체로 받는다.
 * 해석 실패·필수 필드 누락이면 null(→ decline). 스키마에 없는 키는 버린다.
 */
export function parseElicitationAnswer(text: string | undefined, schema: ElicitSchema = {}): Record<string, ElicitValue> | null {
    const props = Object.entries(schema.properties ?? {});
    const raw = (text ?? '').trim();
    let values: Record<string, unknown> = {};
    if (raw) {
        const obj = parseObject(raw);
        if (props.length === 1 && !(obj && props[0][0] in obj)) values = { [props[0][0]]: raw };
        else if (obj) values = obj;
        else if (props.length > 1) return null;
    }
    const out: Record<string, ElicitValue> = {};
    for (const [key, prop] of props) {
        if (values[key] === undefined || values[key] === '') continue;
        const coerce = COERCERS[prop.type ?? 'string'] ?? COERCERS.string;
        const v = coerce(values[key], prop);
        if (v === undefined) return null;
        out[key] = v;
    }
    return (schema.required ?? []).every((k) => out[k] !== undefined) ? out : null;
}

/** 작업 문맥이 있으면 승인함에 묻고 결과를 매핑한다. 문맥 없음·url 모드·질문 실패는 사람에게 묻지 않고 끝낸다. */
export async function resolveElicitation(ctx: ElicitationContext | undefined, serverName: string, params: ElicitParams): Promise<ElicitOutcome> {
    if (!ctx || (params.mode !== undefined && params.mode !== 'form')) return { action: 'decline' };
    const schema = params.requestedSchema ?? {};
    let r: ElicitationAskResult;
    try {
        r = await ctx.ask({
            server: serverName,
            question: String(params.message ?? '').slice(0, MCP_ELICITATION_LIMITS.MESSAGE_MAX_CHARS),
            requestedSchema: schema,
        });
    } catch (e) {
        logger.warn(`[${ctx.taskId}] "${serverName}" 입력 요청 대기 실패 → cancel: ${e instanceof Error ? e.message : e}`);
        return { action: 'cancel' };
    }
    if (r.decision !== 'approved') return r.reason === 'user' ? { action: 'decline' } : { action: 'cancel' };
    const content = parseElicitationAnswer(r.text, schema);
    if (!content) {
        logger.info(`[${ctx.taskId}] "${serverName}" 입력 요청 답변을 스키마로 해석하지 못함 → decline`);
        return { action: 'decline' };
    }
    return { action: 'accept', content };
}

/**
 * 클라이언트(사용자 풀 서버 1개)당 1개 — in-flight 호출의 작업 문맥과 입력 대기 수를 추적한다.
 */
export class ElicitationCallTracker {
    private readonly inflight = new Map<number, ElicitationContext>();
    private seq = 0;
    private awaiting = 0;

    constructor(private readonly serverName: string) {}

    isAwaitingInput(): boolean {
        return this.awaiting > 0;
    }

    /** `capabilities.elicitation.form` 을 광고한 SDK 클라이언트에 요청 핸들러를 건다(connect 전). */
    attach(client: Client): void {
        client.setRequestHandler('elicitation/create', (request) => this.handle(request.params as ElicitParams));
    }

    /** 호출 시점 문맥을 기록하고, 입력 대기 중엔 연장되는 마감으로 호출한다. */
    async call<T>(run: (opts: { signal: AbortSignal; timeout: number }) => Promise<T>): Promise<T> {
        const ctx = als.getStore();
        const id = this.seq++;
        if (ctx) this.inflight.set(id, ctx);
        const ac = new AbortController();
        const ms = MCP_ELICITATION_LIMITS.CALL_TIMEOUT_MS;
        const timer = inputAwareTimer(ms, () => this.isAwaitingInput(), () => ac.abort(new Error(`MCP request timed out (${ms}ms)`)));
        try {
            return await run({ signal: ac.signal, timeout: MCP_ELICITATION_LIMITS.CALL_MAX_MS });
        } finally {
            timer.cancel();
            this.inflight.delete(id);
        }
    }

    async handle(params: ElicitParams): Promise<ElicitOutcome> {
        const tasks = new Map([...this.inflight.values()].map((c) => [c.taskId, c]));
        if (tasks.size > 1) logger.warn(`"${this.serverName}" 입력 요청 — 진행 중 작업이 ${tasks.size}개라 대상을 정할 수 없음 → decline`);
        const ctx = tasks.size === 1 ? [...tasks.values()][0] : undefined;
        this.awaiting++;
        try {
            return await resolveElicitation(ctx, this.serverName, params);
        } finally {
            this.awaiting--;
        }
    }
}
