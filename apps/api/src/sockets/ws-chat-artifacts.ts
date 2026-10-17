/**
 * WebSocket 채팅 artifact 스트리밍 발행 — ws-chat-handler.ts 에서 분리 (max-lines 가드).
 * - createArtifactStreamEmitter: token chunk 의 `<artifact>` 태그를 incremental 검출해 WS 이벤트로 발행
 * - replayFallbackArtifacts: 스트리밍 parser 가 못 잡은 후처리 추출 artifact 를 같은 시퀀스로 발행
 * @module sockets/ws-chat-artifacts
 */
import { WS_LIMITS } from '../config/timeouts';
import { ArtifactStreamParser, type ArtifactInfo } from '../llm/artifact-parser';
import type { ChatResult } from '../chat/request-handler-types';

/** 클라이언트 이벤트 발행 함수 (ws-chat-handler 의 out) */
export type WsChatOut = (payload: Record<string, unknown>) => void;

// Phase 3 보완 B.3 (2026-05-26): artifact_chunk WS 메시지 폭주 방지 — 토큰 단위 1회/메시지를
// ID 별 throttle 윈도우(WS_LIMITS.ARTIFACT_CHUNK_FLUSH_MS)로 buffer 후 합쳐서 1회 dispatch.
export function createArtifactStreamEmitter(out: WsChatOut, messageId: string): { artifactStreamParser: ArtifactStreamParser; streamedArtifactIds: Set<string> } {
    const ARTIFACT_CHUNK_FLUSH_MS = WS_LIMITS.ARTIFACT_CHUNK_FLUSH_MS;
    const chunkBuffers = new Map<string, { delta: string; timer: ReturnType<typeof setTimeout> | null }>();
    const streamedArtifactIds = new Set<string>();
    const flushArtifactChunk = (id: string) => {
        const buf = chunkBuffers.get(id);
        if (!buf || !buf.delta) return;
        out({ type: 'artifact_chunk', id, delta: buf.delta, messageId });
        buf.delta = '';
        if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
    };
    const artifactStreamParser = new ArtifactStreamParser({
        onContent: (delta) => {
            out({ type: 'token', token: delta, messageId });
        },
        onArtifactStart: (info: ArtifactInfo) => {
            streamedArtifactIds.add(info.id);
            out({ type: 'artifact_start', artifact: info, messageId });
        },
        onArtifactChunk: (id, delta) => {
            // throttle: 50ms 윈도우에 도착하는 delta 를 합쳐서 한 번에 dispatch
            let buf = chunkBuffers.get(id);
            if (!buf) { buf = { delta: '', timer: null }; chunkBuffers.set(id, buf); }
            buf.delta += delta;
            if (!buf.timer) {
                buf.timer = setTimeout(() => flushArtifactChunk(id), ARTIFACT_CHUNK_FLUSH_MS);
            }
        },
        onArtifactEnd: (id) => {
            // end 전 미flush 잔여 강제 dispatch
            flushArtifactChunk(id);
            chunkBuffers.delete(id);
            out({ type: 'artifact_end', id, messageId });
        },
    });
    return { artifactStreamParser, streamedArtifactIds };
}

export function replayFallbackArtifacts(out: WsChatOut, messageId: string, artifacts: NonNullable<ChatResult['artifacts']>, streamedArtifactIds: Set<string>): void {
    for (const a of artifacts.filter((artifact) => !streamedArtifactIds.has(artifact.id))) {
        out({
            type: 'artifact_start',
            artifact: { id: a.id, kind: a.kind, title: a.title, lang: a.lang },
            messageId,
        });
        out({ type: 'artifact_chunk', id: a.id, delta: a.content, messageId });
        out({ type: 'artifact_end', id: a.id, messageId });
    }
}
