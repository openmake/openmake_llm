/**
 * @module chat/task-gate-session
 * @description 작업 게이트 세션 — 채팅 답과 **나란히** 판정을 돌리고, 답이 끝난 뒤 결과를 수거·기록한다.
 *
 * ⚠️ 판단 경계: 앞단 LLM 판단(A형)의 예외(사용자 결정 2026-10-13, 근거는 services/decision/task-gate.ts).
 * 불변식: 채팅 답은 판정을 기다리지 않는다. 판정·기록의 어떤 실패도 채팅 처리로 번지지 않는다.
 * 구조는 thinking-summarizer 의 세션과 같다 — 요청 처리부에는 시작(start)·수거(finish) 호출만 둔다.
 */
import { TASK_GATE, type TaskGateMode } from '../config/decision';
import { runTaskGate, shouldSuggestTask, type TaskGateRecord } from '../services/decision/task-gate';
import { ChatTaskGateLogRepository, type ChatTaskGateLogEntry } from '../data/repositories/chat-task-gate-log-repository';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('TaskGateSession');

export interface TaskGateSessionInput {
    /** 사용자가 실제로 친 문장(슬래시 확장문 아님) */
    message: string;
    attachmentKinds: string[];
    /** 요청 처리부가 이미 계산한 fast-path 결과 — 다시 계산해 로그를 두 번 남기지 않는다 */
    fastPathMatched: boolean;
    /** 로그인 사용자 id — 없으면 판정하지 않는다(작업은 계정이 있어야 만든다) */
    userId?: string;
    channel: 'web' | 'api';
    /** 판정하지 않는 요청 — 외부 도구 호출 경로이거나 사용자가 채팅 모드(이미지 등)를 켠 턴 */
    skip: boolean;
    /** 호출한 전달 경로가 제안을 실제로 클라이언트에 실어 보내는가 — 거짓이면 제안하지 않고 suggested=false 로 남긴다 */
    suggestable: boolean;
    signal?: AbortSignal;
}

export interface TaskGateSession {
    /** 채팅 답이 끝난 뒤 한 번 부른다. 이미 끝난 판정이 제안 조건을 넘으면 확률을 돌려준다. 기록은 판정이 끝나는 대로 남는다. */
    finish(ctx: { sessionId: string; messageId?: string | number | null }): { pTrue: number } | undefined;
}

export interface TaskGateSessionDeps {
    mode?: TaskGateMode;
    threshold?: number;
    run?: (input: { message: string; attachmentKinds: string[]; fastPathMatched: boolean; signal?: AbortSignal }, deps: { mode: TaskGateMode }) => Promise<TaskGateRecord | undefined>;
    save?: (entry: ChatTaskGateLogEntry) => Promise<void>;
}

const NOOP_SESSION: TaskGateSession = { finish: () => undefined };

/**
 * PURE: 채팅 요청에서 판정 입력을 만든다 — 요청 처리부(request-handler)는 이 함수의 결과를 그대로 세션에 넘긴다.
 * 건너뛰는 조건(설계 3.3)을 여기 한곳에 둔다: 외부 도구 호출 경로, 이미지 모드, 켜진 모드 토글.
 */
export function buildTaskGateSessionInput(req: {
    message: string;
    images?: unknown[];
    mediaFiles?: unknown[];
    fastPathMatched: boolean;
    authenticatedUserId: string | null;
    apiKeyId?: string;
    imageMode?: boolean;
    modes?: Record<string, boolean>;
    hasTools: boolean;
    suggestable: boolean;
    signal?: AbortSignal;
}): TaskGateSessionInput {
    return {
        message: req.message,
        attachmentKinds: [...(req.images?.length ? ['image'] : []), ...(req.mediaFiles?.length ? ['file'] : [])],
        fastPathMatched: req.fastPathMatched,
        userId: req.authenticatedUserId ?? undefined,
        channel: req.apiKeyId ? 'api' : 'web',
        skip: req.hasTools || req.imageMode === true || Object.values(req.modes ?? {}).some(Boolean),
        suggestable: req.suggestable,
        signal: req.signal,
    };
}

/** 저장 계층은 메시지 id 를 문자열로 돌려준다(DB 는 정수) — 정수로 읽히지 않으면 null */
function toMessageId(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

export function startTaskGateSession(input: TaskGateSessionInput, deps: TaskGateSessionDeps = {}): TaskGateSession {
    const mode = deps.mode ?? TASK_GATE.MODE;
    if (mode === 'off' || !input.userId || input.skip) return NOOP_SESSION;
    const userId = input.userId;
    const run = deps.run ?? runTaskGate;
    const save = deps.save ?? ((entry: ChatTaskGateLogEntry) => new ChatTaskGateLogRepository(getPool()).insert(entry));

    let settled: TaskGateRecord | undefined;
    // async 로 감싸 동기 예외까지 거부(rejection)로 모은 뒤 여기서 끝낸다 — 밖으로 나가는 거부는 없다.
    const pending: Promise<TaskGateRecord | undefined> = (async () => run(
        { message: input.message, attachmentKinds: input.attachmentKinds, fastPathMatched: input.fastPathMatched, signal: input.signal },
        { mode },
    ))()
        .then((record) => { settled = record; return record; })
        .catch((e: unknown) => {
            logger.warn(`작업 게이트 판정 실패 (무시): ${e instanceof Error ? e.message : String(e)}`);
            return undefined;
        });

    return {
        finish(ctx) {
            const suggested = input.suggestable && shouldSuggestTask(settled, { mode, threshold: deps.threshold });
            void pending
                .then((record) => {
                    if (!record) return undefined;
                    return save({
                        userId,
                        sessionId: ctx.sessionId,
                        messageId: toMessageId(ctx.messageId),
                        channel: input.channel,
                        mode,
                        source: record.source,
                        pTrue: record.pTrue ?? null,
                        gateError: record.error ?? null,
                        gateMs: record.ms,
                        gateModel: record.model ?? null,
                        suggested,
                        queryChars: input.message.length,
                    });
                })
                .catch((e: unknown) => logger.warn(`작업 게이트 기록 실패 (무시): ${e instanceof Error ? e.message : String(e)}`));
            return suggested && settled?.pTrue !== undefined ? { pTrue: settled.pTrue } : undefined;
        },
    };
}
