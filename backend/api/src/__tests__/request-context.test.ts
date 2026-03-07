/**
 * request-context 테스트
 * AsyncLocalStorage 기반 requestId 전파 검증
 */
import { describe, it, expect } from 'bun:test';
import { runWithRequestContext, getRequestId } from '../utils/request-context';

describe('request-context', () => {
    it('컨텍스트 밖에서 getRequestId()는 undefined를 반환', () => {
        expect(getRequestId()).toBeUndefined();
    });

    it('runWithRequestContext 내에서 requestId를 반환', () => {
        runWithRequestContext({ requestId: 'test-123' }, () => {
            expect(getRequestId()).toBe('test-123');
        });
    });

    it('컨텍스트 종료 후 requestId가 사라짐', () => {
        runWithRequestContext({ requestId: 'test-456' }, () => {
            expect(getRequestId()).toBe('test-456');
        });
        expect(getRequestId()).toBeUndefined();
    });

    it('중첩 컨텍스트에서 내부 requestId 우선', () => {
        runWithRequestContext({ requestId: 'outer' }, () => {
            expect(getRequestId()).toBe('outer');
            runWithRequestContext({ requestId: 'inner' }, () => {
                expect(getRequestId()).toBe('inner');
            });
            expect(getRequestId()).toBe('outer');
        });
    });

    it('async 콜백에서 requestId 전파', async () => {
        await runWithRequestContext({ requestId: 'async-test' }, async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(getRequestId()).toBe('async-test');
        });
    });

    it('병렬 요청 간 requestId 격리', async () => {
        const results: string[] = [];

        await Promise.all([
            runWithRequestContext({ requestId: 'req-A' }, async () => {
                await new Promise(resolve => setTimeout(resolve, 20));
                results.push(getRequestId()!);
            }),
            runWithRequestContext({ requestId: 'req-B' }, async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                results.push(getRequestId()!);
            }),
        ]);

        expect(results).toContain('req-A');
        expect(results).toContain('req-B');
        expect(results.length).toBe(2);
    });
});
