/** 핸드오프 봉투 — 증거 수집·출처 추출·봉투 조립·부모에게 가는 한 줄(PURE). */
import { HandoffEvidenceCollector, buildHandoffEnvelope, emptyEvidence, extractSourceUrls } from './handoff-envelope';
import { getHandoffLine } from '../../prompts/agent-task-delegation';
import { AGENT_DELEGATION } from '../../config/agent-task-delegation';

describe('extractSourceUrls', () => {
    it('끝 문장 부호·괄호를 걷고 중복을 뺀다(나온 순서 유지)', () => {
        expect(extractSourceUrls('참고 (https://a.example/x). 또 https://b.example/y, 다시 https://a.example/x!'))
            .toEqual(['https://a.example/x', 'https://b.example/y']);
    });

    it('URL 이 없으면 빈 목록', () => {
        expect(extractSourceUrls('출처 없음')).toEqual([]);
    });
});

describe('HandoffEvidenceCollector', () => {
    it('도구별 성공·실패·거절을 세고, 출처는 성공한 호출의 결과에서만 모은다', () => {
        const c = new HandoffEvidenceCollector();
        c.record('web_search', 'ok', 'https://a.example');
        c.record('web_search', 'error', 'https://err.example');
        c.record('extract_webpage', 'denied');
        expect(c.snapshot()).toEqual({
            calls: 3,
            tools: [{ tool: 'web_search', ok: 1, error: 1, denied: 0 }, { tool: 'extract_webpage', ok: 0, error: 0, denied: 1 }],
            sources: ['https://a.example'],
            sourceCount: 1,
        });
    });

    it('출처 목록은 상한까지만 싣고 개수는 전체를 센다', () => {
        const c = new HandoffEvidenceCollector();
        const n = AGENT_DELEGATION.HANDOFF_MAX_SOURCES + 3;
        c.record('web_search', 'ok', Array.from({ length: n }, (_, i) => `https://s${i}.example`).join(' '));
        const ev = c.snapshot();
        expect(ev.sources).toHaveLength(AGENT_DELEGATION.HANDOFF_MAX_SOURCES);
        expect(ev.sourceCount).toBe(n);
    });
});

describe('buildHandoffEnvelope', () => {
    const base = {
        executionId: 't#0', exit: 'completed' as const, reused: false, evidence: emptyEvidence(),
        result: 'abc', approvalPolicy: 'all', toolsGranted: 2,
    };

    it('결과는 sha256·글자 수만 싣는다', () => {
        const env = buildHandoffEnvelope(base);
        expect(env.result).toEqual({ sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', chars: 3 });
        expect(env).toMatchObject({ v: 1, executionId: 't#0', exit: 'completed', reused: false, policy: { approvalPolicy: 'all', toolsGranted: 2 } });
        expect(env.policy).not.toHaveProperty('noToolsReason');
    });

    it.each([[undefined, 'none'], [null, 'valid'], ['n: 숫자여야 함', 'invalid']] as const)('형식 판정 %p → %s', (schemaProblem, want) => {
        expect(buildHandoffEnvelope({ ...base, schemaProblem }).schema).toBe(want);
    });

    it('종료 사유를 모르면 null, 도구 없음 사유는 있을 때만', () => {
        const env = buildHandoffEnvelope({ ...base, exit: undefined, noToolsReason: '화이트리스트 비어 있음' });
        expect(env.exit).toBeNull();
        expect(env.policy.noToolsReason).toBe('화이트리스트 비어 있음');
    });
});

describe('getHandoffLine', () => {
    const env = (over: Partial<Parameters<typeof buildHandoffEnvelope>[0]> = {}) => buildHandoffEnvelope({
        executionId: 't#1', exit: 'completed', reused: false, evidence: emptyEvidence(),
        result: 'abc', approvalPolicy: 'all', toolsGranted: 2, ...over,
    });

    it('도구 호출 0회는 조회 없이 작성된 답이라고 분명히 적는다', () => {
        expect(getHandoffLine(env())).toBe('[핸드오프: 실행 t#1 · 도구 호출 0회 — 조회 없이 작성된 답 · 승인 정책 all·받은 도구 2개 · 결과 3자 sha256:ba7816bf8f01]');
    });

    it('재사용 결과는 이번 실행의 호출이 없다고 적는다', () => {
        expect(getHandoffLine(env({ reused: true }))).toContain('이전 실행 결과 재사용(이번 실행의 도구 호출 없음)');
    });

    it('도구는 상한까지 보이고 나머지는 "외 N개"', () => {
        const c = new HandoffEvidenceCollector();
        for (const t of ['a', 'b', 'c', 'd', 'e', 'f']) c.record(t, 'ok');
        c.record('a', 'error');
        const line = getHandoffLine(env({ evidence: c.snapshot() }));
        expect(line).toContain('도구 호출 7회: a 2(실패 1), b 1, c 1, d 1 외 2개');
        expect(line).toContain('출처 URL 0개');
    });
});
