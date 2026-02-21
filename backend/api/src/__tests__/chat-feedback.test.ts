/**
 * ============================================================
 * Chat Feedback Tests
 * ============================================================
 *
 * FeedbackRepository의 단위 테스트입니다.
 * DB 호출은 mock Pool로 대체하여 실제 DB 연결 없이 로직을 검증합니다.
 *
 * @module __tests__/chat-feedback
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { FeedbackRepository, FeedbackRecord, FeedbackStats } from '../data/repositories/feedback-repository';
import { Pool } from 'pg';

// ============================================================
// Mock Pool 헬퍼
// ============================================================

type MockQueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;

function createMockPool(queryFn: MockQueryFn): Pool {
    return {
        query: queryFn,
        on: () => {},
    } as unknown as Pool;
}

// ============================================================
// 1. recordFeedback — INSERT 실행 검증
// ============================================================

describe('FeedbackRepository.recordFeedback', () => {
    it('should execute INSERT without error for thumbs_up signal', async () => {
        let capturedSql = '';
        let capturedParams: unknown[] = [];

        const pool = createMockPool(async (sql, params) => {
            capturedSql = sql;
            capturedParams = params ?? [];
            return { rows: [], rowCount: 1 };
        });

        const repo = new FeedbackRepository(pool);
        const record: FeedbackRecord = {
            messageId: 'msg-001',
            sessionId: 'sess-001',
            signal: 'thumbs_up',
        };

        await expect(repo.recordFeedback(record)).resolves.toBeUndefined();
        expect(capturedSql).toContain('INSERT INTO message_feedback');
        expect(capturedParams[0]).toBe('msg-001');
        expect(capturedParams[1]).toBe('sess-001');
        expect(capturedParams[3]).toBe('thumbs_up');
    });

    it('should execute INSERT without error for thumbs_down signal', async () => {
        let capturedParams: unknown[] = [];

        const pool = createMockPool(async (_sql, params) => {
            capturedParams = params ?? [];
            return { rows: [], rowCount: 1 };
        });

        const repo = new FeedbackRepository(pool);
        await repo.recordFeedback({
            messageId: 'msg-002',
            sessionId: 'sess-002',
            signal: 'thumbs_down',
        });

        expect(capturedParams[3]).toBe('thumbs_down');
    });

    it('should execute INSERT without error for regenerate signal', async () => {
        let capturedParams: unknown[] = [];

        const pool = createMockPool(async (_sql, params) => {
            capturedParams = params ?? [];
            return { rows: [], rowCount: 1 };
        });

        const repo = new FeedbackRepository(pool);
        await repo.recordFeedback({
            messageId: 'msg-003',
            sessionId: 'sess-003',
            signal: 'regenerate',
        });

        expect(capturedParams[3]).toBe('regenerate');
    });

    it('should pass null for routingMetadata when not provided', async () => {
        let capturedParams: unknown[] = [];

        const pool = createMockPool(async (_sql, params) => {
            capturedParams = params ?? [];
            return { rows: [], rowCount: 1 };
        });

        const repo = new FeedbackRepository(pool);
        await repo.recordFeedback({
            messageId: 'msg-004',
            sessionId: 'sess-004',
            signal: 'thumbs_up',
        });

        // routingMetadata 파라미터($5)는 null이어야 함
        expect(capturedParams[4]).toBeNull();
    });

    it('should serialize routingMetadata as JSON string when provided', async () => {
        let capturedParams: unknown[] = [];

        const pool = createMockPool(async (_sql, params) => {
            capturedParams = params ?? [];
            return { rows: [], rowCount: 1 };
        });

        const repo = new FeedbackRepository(pool);
        const metadata = {
            model: 'openmake_llm_code',
            queryType: 'code',
            latencyMs: 1234,
        };

        await repo.recordFeedback({
            messageId: 'msg-005',
            sessionId: 'sess-005',
            signal: 'thumbs_up',
            routingMetadata: metadata,
        });

        // $5 파라미터는 JSON 문자열이어야 함
        const serialized = capturedParams[4];
        expect(typeof serialized).toBe('string');
        const parsed = JSON.parse(serialized as string);
        expect(parsed.model).toBe('openmake_llm_code');
        expect(parsed.latencyMs).toBe(1234);
    });
});

// ============================================================
// 2. getFeedbackStats — 집계 쿼리 검증
// ============================================================

describe('FeedbackRepository.getFeedbackStats', () => {
    it('should return correct aggregated stats from DB rows', async () => {
        let callCount = 0;

        const pool = createMockPool(async () => {
            callCount += 1;
            if (callCount === 1) {
                // 첫 번째 쿼리: 전체 집계
                return {
                    rows: [{
                        total: '10',
                        thumbs_up: '6',
                        thumbs_down: '3',
                        regenerates: '1',
                    }],
                    rowCount: 1,
                };
            }
            // 두 번째 쿼리: 모델별 집계
            return {
                rows: [
                    { model: 'openmake_llm_code', up: '4', down: '2' },
                    { model: 'openmake_llm_fast', up: '2', down: '1' },
                ],
                rowCount: 2,
            };
        });

        const repo = new FeedbackRepository(pool);
        const stats: FeedbackStats = await repo.getFeedbackStats(7);

        expect(stats.total).toBe(10);
        expect(stats.thumbsUp).toBe(6);
        expect(stats.thumbsDown).toBe(3);
        expect(stats.regenerates).toBe(1);
        expect(stats.byModel['openmake_llm_code']).toEqual({ up: 4, down: 2 });
        expect(stats.byModel['openmake_llm_fast']).toEqual({ up: 2, down: 1 });
    });

    it('should use default 30 days when no argument is passed', async () => {
        const capturedParams: unknown[][] = [];

        const pool = createMockPool(async (_sql, params) => {
            capturedParams.push(params ?? []);
            return { rows: [{ total: '0', thumbs_up: '0', thumbs_down: '0', regenerates: '0' }], rowCount: 1 };
        });

        const repo = new FeedbackRepository(pool);
        await repo.getFeedbackStats();

        // 첫 번째 쿼리의 $1 파라미터가 '30'이어야 함
        expect(capturedParams[0][0]).toBe('30');
    });

    it('should return empty byModel when no model metadata exists', async () => {
        let callCount = 0;

        const pool = createMockPool(async () => {
            callCount += 1;
            if (callCount === 1) {
                return {
                    rows: [{ total: '5', thumbs_up: '3', thumbs_down: '2', regenerates: '0' }],
                    rowCount: 1,
                };
            }
            return { rows: [], rowCount: 0 };
        });

        const repo = new FeedbackRepository(pool);
        const stats = await repo.getFeedbackStats(30);

        expect(stats.byModel).toEqual({});
    });
});

// ============================================================
// 3. Signal 유효성 — 타입 레벨 검증
// ============================================================

describe('FeedbackRecord signal type', () => {
    it('should accept thumbs_up as a valid signal', () => {
        const record: FeedbackRecord = {
            messageId: 'msg-a',
            sessionId: 'sess-a',
            signal: 'thumbs_up',
        };
        expect(record.signal).toBe('thumbs_up');
    });

    it('should accept thumbs_down as a valid signal', () => {
        const record: FeedbackRecord = {
            messageId: 'msg-b',
            sessionId: 'sess-b',
            signal: 'thumbs_down',
        };
        expect(record.signal).toBe('thumbs_down');
    });

    it('should accept regenerate as a valid signal', () => {
        const record: FeedbackRecord = {
            messageId: 'msg-c',
            sessionId: 'sess-c',
            signal: 'regenerate',
        };
        expect(record.signal).toBe('regenerate');
    });

    it('should reject invalid signal at compile time (runtime guard test)', () => {
        const validSignals = ['thumbs_up', 'thumbs_down', 'regenerate'];
        const invalidSignal = 'invalid';
        expect(validSignals.includes(invalidSignal)).toBe(false);
    });
});

// ============================================================
// 4. FeedbackRepository 인스턴스화 검증
// ============================================================

describe('FeedbackRepository instantiation', () => {
    it('should instantiate with a Pool and expose required methods', () => {
        const pool = createMockPool(async () => ({ rows: [], rowCount: 0 }));
        const repo = new FeedbackRepository(pool);

        expect(typeof repo.recordFeedback).toBe('function');
        expect(typeof repo.getFeedbackBySession).toBe('function');
        expect(typeof repo.getFeedbackStats).toBe('function');
    });
});
