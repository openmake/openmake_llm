/**
 * 채팅 요청 사실 기록 (F24.2, 142) — external-provider 에서 분리(파일 크기 가드).
 *
 * 요청당 1행: 프롬프트·도구 지문 + 상태·TTFT·토큰·비용. fire-and-forget — 기록 실패가 채팅을 막지 않는다.
 * 지문 원문(정적 prefix·도구 매니페스트)은 프로세스당 처음 본 지문만 upsert 한다(매 요청 ~10KB 재기록 방지).
 *
 * @module services/chat-service/chat-request-recorder
 */
import { randomUUID } from 'crypto';
import { getPool } from '../../data/models/unified-database';
import { ChatRequestRepository } from '../../data/repositories/chat-request-repository';
import { fingerprintPrompt, fingerprintTools, promptBlockNames } from '../../observability/prompt-fingerprint';
import { getRequestId } from '../../utils/request-context';
import { getCurrentTraceId } from '../../observability/otel';
import { getBuildInfo } from '../../config/build-id';
import { CHAT_REQUESTS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import type { ChatMessageRequest } from '../chat-service-types';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { StreamFromExternalContext } from './external-provider-types';

const logger = createLogger('ChatRequestRecorder');
const seenFingerprints = new Set<string>();

export interface ChatProvenance {
    requestId: string;
    promptStaticHash?: string;
    promptFullHash?: string;
    staticText?: string;
    promptBlocks: string[];
    toolManifestHash: string;
    toolNames: string[];
    toolManifestJson: string;
}

/** 조립이 끝난 뒤 지문을 계산한다(프롬프트 파트는 buildExternalMessages 콜백으로 받는다). */
export function buildChatProvenance(p: {
    req: ChatMessageRequest;
    ctx: StreamFromExternalContext;
    promptParts?: { staticParts: string[]; dynamicParts: string[] };
    tools: ReadonlyArray<{ function: { name: string; parameters?: unknown } }>;
    flags: { integrations: string[]; orchestration: boolean; spawn: boolean };
}): ChatProvenance {
    const fp = p.promptParts ? fingerprintPrompt(p.promptParts.staticParts, p.promptParts.dynamicParts) : undefined;
    const tf = fingerprintTools(p.tools);
    return {
        requestId: getRequestId() ?? randomUUID(),
        ...(fp ? { promptStaticHash: fp.staticHash, promptFullHash: fp.fullHash, staticText: fp.staticText } : {}),
        promptBlocks: promptBlockNames(p.ctx, { webSearch: !!p.req.webSearchContext, location: !!p.req.userLocation, ...p.flags }),
        toolManifestHash: tf.hash,
        toolNames: tf.names,
        toolManifestJson: tf.manifestJson,
    };
}

/** 중단(사용자 취소·연결 종료)을 오류와 구분 — SLI 가용성 분모에서 빼기 위해. */
export function classifyChatOutcome(err: unknown): 'error' | 'aborted' {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return name === 'AbortError' || /\baborted\b/i.test(msg) ? 'aborted' : 'error';
}

function remember(hash: string): boolean {
    if (seenFingerprints.has(hash)) return false;
    if (seenFingerprints.size >= CHAT_REQUESTS.FINGERPRINT_SEEN_MAX) seenFingerprints.clear();
    seenFingerprints.add(hash);
    return true;
}

export function recordChatRequestFireAndForget(p: {
    provenance: ChatProvenance;
    req: ChatMessageRequest;
    resolved: ResolvedProvider;
    ctx: StreamFromExternalContext;
    status: 'ok' | 'error' | 'aborted';
    errorCode?: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros?: number;
}): void {
    if (!CHAT_REQUESTS.ENABLED) return;
    const now = Date.now();
    const t = p.ctx.timings;
    const build = getBuildInfo();
    const { provenance: pv } = p;
    void (async () => {
        const repo = new ChatRequestRepository(getPool());
        if (pv.promptStaticHash && pv.staticText !== undefined && remember(pv.promptStaticHash)) {
            await repo.upsertFingerprint(pv.promptStaticHash, 'prompt_static', pv.staticText, build.version);
        }
        if (remember(pv.toolManifestHash)) await repo.upsertFingerprint(pv.toolManifestHash, 'tool_manifest', pv.toolManifestJson, build.version);
        await repo.insert({
            requestId: pv.requestId,
            traceId: getCurrentTraceId(),
            userId: p.req.userId,
            sessionId: p.req.sessionId,
            startedAt: new Date(t?.enteredAt ?? now),
            status: p.status,
            errorCode: p.errorCode,
            providerId: p.resolved.providerId,
            model: p.resolved.fullId,
            appVersion: build.version,
            gitHash: build.gitHash,
            promptStaticHash: pv.promptStaticHash,
            promptFullHash: pv.promptFullHash,
            promptBlocks: pv.promptBlocks,
            toolManifestHash: pv.toolManifestHash,
            toolNames: pv.toolNames,
            ttftMs: t?.firstChunkAt ? t.firstChunkAt - t.enteredAt : null,
            prepMs: t?.firstLlmCallAt ? t.firstLlmCallAt - t.enteredAt : null,
            totalMs: now - (t?.enteredAt ?? now),
            toolMs: t?.toolMs,
            toolTurns: t?.turns,
            inputTokens: p.inputTokens,
            outputTokens: p.outputTokens,
            costUsdMicros: p.costUsdMicros,
        });
    })().catch((e) => logger.warn(`요청 기록 실패(무시): ${e instanceof Error ? e.message : e}`));
}
