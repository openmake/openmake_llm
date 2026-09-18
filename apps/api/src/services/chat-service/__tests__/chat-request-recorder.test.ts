/**
 * 채팅 요청 기록(F24.2) — 결과 분류, 지문 원문은 프로세스당 처음 본 것만 upsert, 타이밍 계산, 기록 실패 무시.
 */
const insert = jest.fn(async () => undefined);
const upsertFingerprint = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../../data/repositories/chat-request-repository', () => ({ ChatRequestRepository: jest.fn().mockImplementation(() => ({ insert, upsertFingerprint })) }));
jest.mock('../../../config/build-id', () => ({ getBuildInfo: () => ({ version: '9.9.9', gitHash: 'abc123' }) }));
jest.mock('../../../observability/otel', () => ({ getCurrentTraceId: () => 'trace-1' }));

import { buildChatProvenance, classifyChatOutcome, recordChatRequestFireAndForget } from '../chat-request-recorder';

const flush = () => new Promise((r) => setImmediate(r));
const resolved = { providerId: 'local-llm', fullId: 'qwen3.8-27b' } as never;

beforeEach(() => jest.clearAllMocks());

describe('classifyChatOutcome', () => {
    it('AbortError·aborted 메시지는 중단, 그 외는 오류', () => {
        expect(classifyChatOutcome(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('aborted');
        expect(classifyChatOutcome(new Error('Request was aborted.'))).toBe('aborted');
        expect(classifyChatOutcome(new Error('500 upstream'))).toBe('error');
    });
});

describe('recordChatRequestFireAndForget', () => {
    it('타이밍·지문·결과를 1행으로 넣고, 같은 지문 원문은 한 번만 upsert 한다', async () => {
        const req = { message: 'hi', userId: '3', sessionId: 's1', webSearchContext: 'ctx' } as never;
        const ctx = { artifactGuideBlock: 'ART', timings: { enteredAt: 1000, firstLlmCallAt: 1200, firstChunkAt: 3000, toolMs: 50, turns: 2 } } as never;
        const provenance = buildChatProvenance({ req, ctx, promptParts: { staticParts: ['ART-UNIQUE-1'], dynamicParts: ['D'] }, tools: [{ function: { name: 'web_search', parameters: {} } }], flags: { integrations: [], orchestration: false, spawn: false } });
        recordChatRequestFireAndForget({ provenance, req, resolved, ctx, status: 'ok', inputTokens: 10, outputTokens: 20 });
        await flush();
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
            userId: '3', sessionId: 's1', status: 'ok', model: 'qwen3.8-27b', appVersion: '9.9.9', gitHash: 'abc123', traceId: 'trace-1',
            ttftMs: 2000, prepMs: 200, toolMs: 50, toolTurns: 2, promptBlocks: ['artifact', 'webSearch'], toolNames: ['web_search'],
            promptStaticHash: provenance.promptStaticHash,
        }));
        expect(upsertFingerprint).toHaveBeenCalledTimes(2); // prompt_static + tool_manifest
        recordChatRequestFireAndForget({ provenance, req, resolved, ctx, status: 'error', errorCode: 'UPSTREAM_ERROR', inputTokens: 0, outputTokens: 0 });
        await flush();
        expect(upsertFingerprint).toHaveBeenCalledTimes(2); // 재기록 없음
        expect(insert).toHaveBeenCalledTimes(2);
    });

    it('첫 청크가 없으면 TTFT 는 null, 기록 실패는 삼킨다', async () => {
        insert.mockRejectedValueOnce(new Error('db down'));
        const ctx = { timings: { enteredAt: Date.now(), firstLlmCallAt: 0, firstChunkAt: 0, toolMs: 0, turns: 0 } } as never;
        const provenance = buildChatProvenance({ req: { message: 'x' } as never, ctx, tools: [], flags: { integrations: [], orchestration: false, spawn: false } });
        expect(() => recordChatRequestFireAndForget({ provenance, req: { message: 'x' } as never, resolved, ctx, status: 'aborted', inputTokens: 0, outputTokens: 0 })).not.toThrow();
        await flush();
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ ttftMs: null, prepMs: null, status: 'aborted', promptStaticHash: undefined }));
    });
});
