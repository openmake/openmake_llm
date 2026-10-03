/**
 * 에이전트 작업 궤적의 과정 검사 — 최종 결과가 맞아도 과정이 틀린 실행을 잡는다.
 * 채점기 자체의 검증을 겸한다: 알려진 정상 궤적은 통과하고, 알려진 불량 궤적은 차원별로 걸려야 한다.
 */
import { evaluateTrajectory, stepsToTrajectory, parseTrajectorySpec, type TrajectorySpec, type TrajectoryCall } from '../trajectory-evaluator';

const SPEC: TrajectorySpec = {
    id: 'report-from-csv',
    requiredTools: ['file_ops', 'python_execute'],
    allowedTools: ['file_ops', 'python_execute', 'str_replace_editor', 'terminate'],
    forbiddenTools: ['browser'],
    expectedArgs: [{ tool: 'file_ops', args: { op: 'read', path: { regex: '\\.csv$' } } }],
    order: [{ before: 'file_ops', after: 'python_execute' }],
    maxCalls: { python_execute: 2 },
};

const GOOD: TrajectoryCall[] = [
    { name: 'file_ops', args: { op: 'read', path: 'uploads/sales.csv' } },
    { name: 'python_execute', args: { code: 'print(1)' } },
    { name: 'terminate', args: { summary: '완료' } },
];

const failed = (r: ReturnType<typeof evaluateTrajectory>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.id);

describe('evaluateTrajectory', () => {
    it('정상 궤적은 모든 검사를 통과한다', () => {
        const r = evaluateTrajectory(SPEC, GOOD);
        expect(r.passed).toBe(true);
        expect(failed(r)).toEqual([]);
        expect(r.checks.map((c) => c.dimension)).toEqual(expect.arrayContaining(['selection', 'argument', 'order', 'scope']));
    });

    it('필수 도구를 안 쓰면 선택 검사가 실패한다', () => {
        const r = evaluateTrajectory(SPEC, GOOD.filter((c) => c.name !== 'python_execute'));
        expect(r.passed).toBe(false);
        expect(failed(r)).toEqual(['required:python_execute']);
    });

    it('필수 도구가 빠지면 그 도구의 인자·순서·횟수 검사는 실패가 아니라 건너뜀이고, 원인 하나로 묶인다', () => {
        const r = evaluateTrajectory(SPEC, GOOD.filter((c) => c.name !== 'file_ops'));
        expect(failed(r)).toEqual(['required:file_ops']);
        const skipped = r.checks.filter((c) => c.status === 'skipped');
        expect(skipped.map((c) => c.dimension).sort()).toEqual(['argument', 'order']);
        expect(skipped.every((c) => c.dependsOn === 'required:file_ops')).toBe(true);
        expect(r.rootFailures).toEqual(['required:file_ops']);
    });

    it('허용 목록 밖 도구를 쓰면 어떤 도구인지 밝혀 실패한다', () => {
        const r = evaluateTrajectory(SPEC, [...GOOD.slice(0, 2), { name: 'web_search', args: {} }, GOOD[2]]);
        expect(failed(r)).toEqual(['allowed']);
        expect(r.checks.find((c) => c.id === 'allowed')?.detail).toContain('web_search');
    });

    it('금지 도구를 쓰면 실패한다', () => {
        const r = evaluateTrajectory({ ...SPEC, allowedTools: undefined }, [...GOOD, { name: 'browser', args: {} }]);
        expect(failed(r)).toEqual(['forbidden:browser']);
    });

    it('인자가 기대와 다르면 인자 검사가 실패한다(정확 일치·정규식 모두)', () => {
        const wrongOp = evaluateTrajectory(SPEC, [{ name: 'file_ops', args: { op: 'delete', path: 'uploads/sales.csv' } }, ...GOOD.slice(1)]);
        expect(failed(wrongOp)).toEqual(['args:file_ops#0']);
        const wrongPath = evaluateTrajectory(SPEC, [{ name: 'file_ops', args: { op: 'read', path: 'notes.txt' } }, ...GOOD.slice(1)]);
        expect(failed(wrongPath)).toEqual(['args:file_ops#0']);
    });

    it('인자 검사는 그 도구의 호출 중 하나라도 맞으면 통과한다', () => {
        const r = evaluateTrajectory(SPEC, [{ name: 'file_ops', args: { op: 'list', path: '.' } }, ...GOOD]);
        expect(r.passed).toBe(true);
    });

    it('순서가 뒤집히면 순서 검사가 실패한다', () => {
        const r = evaluateTrajectory(SPEC, [GOOD[1], GOOD[0], GOOD[2]]);
        expect(failed(r)).toEqual(['order:file_ops>python_execute']);
    });

    it('호출 횟수 상한을 넘으면 범위 검사가 실패한다', () => {
        const r = evaluateTrajectory(SPEC, [GOOD[0], GOOD[1], GOOD[1], GOOD[1], GOOD[2]]);
        expect(failed(r)).toEqual(['max:python_execute']);
        expect(r.checks.find((c) => c.id === 'max:python_execute')?.detail).toContain('3');
    });

    it('명세가 비어 있으면 검사가 없고 통과다', () => {
        expect(evaluateTrajectory({ id: 'empty' }, GOOD)).toMatchObject({ passed: true, checks: [] });
    });
});

describe('stepsToTrajectory', () => {
    it('tool_result 스텝만 스텝 번호 순으로 호출 목록으로 바꾼다', () => {
        const steps = [
            { step_number: 3, step_type: 'tool_result', tool_name: 'python_execute', tool_args: { code: 'x' } },
            { step_number: 1, step_type: 'tool_result', tool_name: 'file_ops', tool_args: '{"op":"read"}' },
            { step_number: 2, step_type: 'judge', tool_name: null, tool_args: null },
            { step_number: 4, step_type: 'tool_result', tool_name: 'terminate', tool_args: null },
        ];
        expect(stepsToTrajectory(steps)).toEqual([
            { name: 'file_ops', args: { op: 'read' } },
            { name: 'python_execute', args: { code: 'x' } },
            { name: 'terminate', args: {} },
        ]);
    });
});

describe('parseTrajectorySpec', () => {
    it('모르는 필드와 잘못된 정규식은 거절한다 — 오타 난 명세가 조용히 통과하지 않게', () => {
        expect(() => parseTrajectorySpec({ id: 'x', requiredTool: ['a'] })).toThrow();
        expect(() => parseTrajectorySpec({ id: 'x', expectedArgs: [{ tool: 'a', args: { p: { regex: '(' } } }] })).toThrow();
    });
    it('올바른 명세는 그대로 돌려준다', () => {
        expect(parseTrajectorySpec(SPEC)).toEqual(SPEC);
    });
});
