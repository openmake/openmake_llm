/**
 * 도구 서킷 브레이커 — 상태 전이·제외 규칙·메모리 관리 검증.
 *
 * 이 기능의 최악 실패 모드는 **오탐 차단**(정상 도구가 사라져 기능이 없어진 것처럼 보임)이라,
 * "열려야 할 때 열리는가" 만큼 "열리면 안 될 때 안 열리는가" 를 같은 비중으로 고정한다.
 */
import { TOOL_CIRCUIT } from '../../config/tool-health';

// 게이트는 운영 기본 OFF — 테스트에서는 켠 상태의 동작을 검증한다.
const mutable = TOOL_CIRCUIT as unknown as Record<string, unknown>;
const original = { ...TOOL_CIRCUIT };

import { isToolCircuitOpen, recordToolResult, getCircuitSnapshot, resetToolCircuit, __resetCircuitsForTest } from '../tool-health';

const TOOL = 'srv::flaky';

function failN(n: number, category = 'provider'): void {
    for (let i = 0; i < n; i++) recordToolResult(TOOL, false, category);
}

describe('도구 서킷 브레이커', () => {
    beforeEach(() => {
        __resetCircuitsForTest();
        Object.assign(mutable, original, { ENABLED: true, FAILURE_THRESHOLD: 3, MIN_CALLS: 3, OPEN_MS: 1000 });
    });
    afterEach(() => Object.assign(mutable, original));

    it('게이트 OFF 면 아무 것도 하지 않는다', () => {
        Object.assign(mutable, { ENABLED: false });
        failN(10);
        expect(isToolCircuitOpen(TOOL)).toBe(false);
        expect(getCircuitSnapshot()).toHaveLength(0);
    });

    it('임계 도달 시 OPEN — 노출·실행 판정이 true 로 바뀐다', () => {
        failN(2);
        expect(isToolCircuitOpen(TOOL)).toBe(false); // 임계 미만
        failN(1);
        expect(isToolCircuitOpen(TOOL)).toBe(true);
    });

    it('invalid_args 는 세지 않는다 — 모델이 인자를 틀린 것이지 도구 고장이 아니다', () => {
        failN(10, 'invalid_args');
        expect(isToolCircuitOpen(TOOL)).toBe(false);
    });

    it('not_found·output_truncated 도 제외 대상', () => {
        failN(5, 'not_found');
        failN(5, 'output_truncated');
        expect(isToolCircuitOpen(TOOL)).toBe(false);
    });

    it('내장 도구는 기본 범위(external) 밖 — 핵심 경로가 사라지지 않는다', () => {
        failN(20);
        for (let i = 0; i < 20; i++) recordToolResult('web_search', false, 'provider');
        expect(isToolCircuitOpen('web_search')).toBe(false);
        expect(isToolCircuitOpen(TOOL)).toBe(true);
    });

    it('SCOPE=all 이면 내장 도구도 대상', () => {
        Object.assign(mutable, { SCOPE: 'all' });
        for (let i = 0; i < 3; i++) recordToolResult('web_search', false, 'provider');
        expect(isToolCircuitOpen('web_search')).toBe(true);
    });

    it('성공은 실패 카운터를 리셋한다', () => {
        failN(2);
        recordToolResult(TOOL, true);
        failN(2);
        expect(isToolCircuitOpen(TOOL)).toBe(false);
    });

    it('cooldown 경과 후 half-open 으로 통과시키고, 성공하면 closed 로 복구', async () => {
        failN(3);
        expect(isToolCircuitOpen(TOOL)).toBe(true);
        await new Promise((r) => setTimeout(r, 1100)); // OPEN_MS=1000
        expect(isToolCircuitOpen(TOOL)).toBe(false);   // half-open 전이
        expect(getCircuitSnapshot()[0].state).toBe('half_open');
        recordToolResult(TOOL, true);
        expect(getCircuitSnapshot()[0].state).toBe('closed');
    });

    it('half-open 에서 실패하면 재차단 + cooldown 이 배수로 늘어난다', async () => {
        failN(3);
        await new Promise((r) => setTimeout(r, 1100));
        isToolCircuitOpen(TOOL); // half-open 전이
        recordToolResult(TOOL, false, 'provider');
        const snap = getCircuitSnapshot()[0];
        expect(snap.state).toBe('open');
        expect(snap.openMs).toBe(2000); // 1000 × BACKOFF_FACTOR(2)
        expect(isToolCircuitOpen(TOOL)).toBe(true);
    });

    it('cooldown 은 상한을 넘지 않는다', async () => {
        Object.assign(mutable, { OPEN_MS: 1000, OPEN_MS_MAX: 1500 });
        failN(3);
        await new Promise((r) => setTimeout(r, 1100));
        isToolCircuitOpen(TOOL);
        recordToolResult(TOOL, false, 'provider');
        expect(getCircuitSnapshot()[0].openMs).toBe(1500);
    });

    it('정상 도구는 엔트리를 만들지 않는다 (메모리 무한 증가 방지)', () => {
        for (let i = 0; i < 50; i++) recordToolResult(`srv::ok${i}`, true);
        expect(getCircuitSnapshot()).toHaveLength(0);
    });

    it('추적 도구 수 상한 초과 시 가장 오래된 항목을 버린다', () => {
        Object.assign(mutable, { MAX_TRACKED_TOOLS: 3 });
        for (let i = 0; i < 6; i++) recordToolResult(`srv::t${i}`, false, 'provider');
        expect(getCircuitSnapshot().length).toBeLessThanOrEqual(3);
    });

    it('수동 리셋으로 즉시 해제된다 (오탐 되돌리기 수단)', () => {
        failN(3);
        expect(isToolCircuitOpen(TOOL)).toBe(true);
        expect(resetToolCircuit(TOOL)).toBe(true);
        expect(isToolCircuitOpen(TOOL)).toBe(false);
        expect(resetToolCircuit('srv::none')).toBe(false);
    });
});
