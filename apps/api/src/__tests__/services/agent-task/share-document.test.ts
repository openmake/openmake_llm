/**
 * buildShareDocument — allowlist 선별 검사가 핵심이다.
 *
 * "제외하기로 한 것이 한 글자도 안 나온다"를 문서 전체 직렬화로 확인한다 — 필드를 하나씩
 * 확인하면 나중에 필드가 추가될 때 검사가 새 필드를 놓친다.
 */
import { buildShareDocument, SHARE_LIMITS } from '../../../services/agent-task/share-document';

const task = {
    id: 'task-1',
    goal: '/Users/openmake_mac/repo 의 타입 오류를 고쳐라',
    result: '완료했습니다. LLM_API_KEY=sk-abcdef1234567890abcd 로 검증했습니다.',
    status: 'completed',
    current_turn: 7,
    created_at: '2026-08-26T00:00:00.000Z',
    completed_at: '2026-08-26T00:05:00.000Z',
    workspace_path: '/private/tmp/openmake-task-workspaces/abc/workspace',
};

const steps = [
    { step_number: 0, step_type: 'assistant', content: '모델의 내부 사고 SECRET_THOUGHT' },
    { step_number: 1, step_type: 'assistant_tool_call', tool_name: 'bash', content: 'CALLARGS_SHOULD_NOT_APPEAR' },
    { step_number: 2, step_type: 'tool_result', tool_name: 'file_ops', content: '기록됨: /private/tmp/openmake-task-workspaces/abc/workspace/src/a.ts' },
    { step_number: 3, step_type: 'plan', content: 'PLAN_SHOULD_NOT_APPEAR' },
    { step_number: 4, step_type: 'steering', content: 'STEERING_SHOULD_NOT_APPEAR' },
    { step_number: 5, step_type: 'judge', content: '판정: achieved — riskpw@openmake.cc 확인' },
    { step_number: 6, step_type: 'diff', content: 'diff --git a/src/a.ts b/src/a.ts\n+const n: number = 1;' },
    { step_number: 7, step_type: 'artifact', content: '{"id":"rep","kind":"html","title":"주간 리포트","content":"<h1>MARKUP_BODY_SHOULD_NOT_APPEAR</h1>","validation":{"checked":true},"sourceData":{"rows":["SOURCEDATA_SHOULD_NOT_APPEAR"]}}' },
    { step_number: 9, step_type: 'artifact', content: '{"id":"rule","kind":"markdown","title":"pre-commit 규칙","content":"# 규칙\\n커밋 전 테스트를 돌린다."}' },
    { step_number: 8, step_type: 'retry', content: 'RETRY_SHOULD_NOT_APPEAR' },
];

describe('buildShareDocument — 선별(allowlist)', () => {
    const doc = buildShareDocument(task, steps);
    const serialized = JSON.stringify(doc);

    test.each([
        ['assistant 원문', 'SECRET_THOUGHT'],
        ['도구 호출 인자', 'CALLARGS_SHOULD_NOT_APPEAR'],
        ['plan 원문', 'PLAN_SHOULD_NOT_APPEAR'],
        ['steering(사용자 개입)', 'STEERING_SHOULD_NOT_APPEAR'],
        ['retry 원문', 'RETRY_SHOULD_NOT_APPEAR'],
        ['workspace 절대경로', '/private/tmp/openmake-task-workspaces'],
        ['홈 디렉토리', '/Users/openmake_mac'],
        ['자격증명 값', 'sk-abcdef1234567890abcd'],
        ['이메일', 'riskpw@openmake.cc'],
        ['마크업 아티팩트 본문', 'MARKUP_BODY_SHOULD_NOT_APPEAR'],
        ['리포트 sourceData', 'SOURCEDATA_SHOULD_NOT_APPEAR'],
    ])('%s 은 문서 어디에도 없다', (_label, needle) => {
        expect(serialized).not.toContain(needle);
    });

    test('workspace_path·device_id 같은 머신 정보 필드 자체가 없다', () => {
        expect(Object.keys(doc)).not.toContain('workspace_path');
        expect(serialized).not.toContain('workspace_path');
        expect(serialized).not.toContain('device_id');
    });

    test('공유하기로 한 것은 남는다', () => {
        expect(doc.goal).toContain('타입 오류를 고쳐라');
        expect(doc.result).toContain('완료했습니다');
        expect(doc.steps.some((s) => s.type === 'tool_result')).toBe(true);
        expect(doc.steps.some((s) => s.type === 'judge')).toBe(true);
        expect(doc.diffs[0]).toContain('diff --git');
    });

    test('숫자 요약은 전체 스텝 기준(선별 전)', () => {
        expect(doc.summary).toEqual({ turns: 7, toolCalls: 1, retries: 1, diffs: 1, artifacts: 2 });
    });

    test('artifact 는 steps 가 아니라 artifacts 필드로 간다', () => {
        expect(doc.steps.some((s) => s.type === 'artifact')).toBe(false);
        expect(doc.artifacts.map((a) => a.title)).toEqual(['주간 리포트', 'pre-commit 규칙']);
    });

    test('텍스트 아티팩트는 본문이 담기고, 마크업(html/svg)은 담기지 않는다', () => {
        const md = doc.artifacts.find((a) => a.kind === 'markdown');
        const html = doc.artifacts.find((a) => a.kind === 'html');
        expect(md?.body).toContain('커밋 전 테스트');
        expect(html?.body).toBeNull();
        expect(html?.omitted).toBe('markup');
    });

    test('diff 는 steps 가 아니라 diffs 필드로 간다', () => {
        expect(doc.steps.some((s) => s.type === 'diff')).toBe(false);
    });
});

describe('buildShareDocument — 토글', () => {
    test('includeDiff=false 면 diff 가 빠지고 요약 숫자는 남는다', () => {
        const doc = buildShareDocument(task, steps, { includeDiff: false });
        expect(doc.diffs).toEqual([]);
        expect(doc.summary.diffs).toBe(1); // "있었다"는 사실은 알린다
    });

    test('includeArtifacts=false 면 산출물이 빠지고 요약 숫자는 남는다', () => {
        const doc = buildShareDocument(task, steps, { includeArtifacts: false });
        expect(doc.artifacts).toEqual([]);
        expect(doc.summary.artifacts).toBe(2);
    });

    test('includeSteps=false 면 스텝이 빠진다', () => {
        const doc = buildShareDocument(task, steps, { includeSteps: false });
        expect(doc.steps).toEqual([]);
        expect(doc.result).toContain('완료했습니다'); // 결과는 남는다
    });
});

describe('buildShareDocument — 캡·경계', () => {
    test('긴 목표·결과는 잘리고 원문 길이를 알린다', () => {
        const long = { ...task, goal: 'ㄱ'.repeat(SHARE_LIMITS.GOAL + 500), result: 'ㄴ'.repeat(SHARE_LIMITS.RESULT + 500) };
        const doc = buildShareDocument(long, []);
        expect(doc.goal).toContain('자 중');
        expect(doc.result).toContain('자 중');
    });

    test('스텝 수 상한을 넘지 않는다', () => {
        const many = Array.from({ length: SHARE_LIMITS.MAX_STEPS + 50 }, (_, i) => ({
            step_number: i, step_type: 'tool_result', tool_name: 't', content: `결과 ${i}`,
        }));
        expect(buildShareDocument(task, many).steps.length).toBeLessThanOrEqual(SHARE_LIMITS.MAX_STEPS);
    });

    test('빈 작업도 안전하다', () => {
        const doc = buildShareDocument({ id: 'x' }, []);
        expect(doc.taskId).toBe('x');
        expect(doc.steps).toEqual([]);
        expect(doc.summary.turns).toBe(0);
    });

    test('내용이 빈 스텝은 버린다(빈 줄 노이즈 방지)', () => {
        const doc = buildShareDocument(task, [{ step_number: 0, step_type: 'tool_result', content: '   ' }]);
        expect(doc.steps).toEqual([]);
    });
});
