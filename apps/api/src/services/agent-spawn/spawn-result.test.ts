import { composeSpawnResult } from './spawn-result';
import { partialSubagentResult } from '../../prompts/subagent-system';

const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({ prompt: `조사 ${i + 1}` }));

describe('composeSpawnResult — 태스크별 예산 분배', () => {
    it('결과 합이 예산을 넘으면 태스크마다 고르게 줄이고, 끝의 종합 지시는 남긴다', () => {
        const results = [`A-HEAD ${'a'.repeat(6000)} A-TAIL`, `B-HEAD ${'b'.repeat(6000)} B-TAIL`, `C-HEAD ${'c'.repeat(6000)} C-TAIL`];
        const out = composeSpawnResult({ tasks: tasks(3), results, noToolsNotice: '', droppedCount: 0, maxTasks: 4, budgetChars: 8000, headRatio: 0.5 });
        expect(out.length).toBeLessThanOrEqual(8000);
        for (const k of ['A', 'B', 'C']) {
            expect(out).toContain(`${k}-HEAD`);
            expect(out).toContain(`${k}-TAIL`);
        }
        expect(out).toMatch(/가운데 \d+자 생략/);
        expect(out.trimEnd().endsWith('추가 도구를 호출하지 마세요.')).toBe(true);
    });

    it('예산 안이면 결과를 줄이지 않는다', () => {
        const out = composeSpawnResult({ tasks: tasks(2), results: ['첫 결과', '둘째 결과'], noToolsNotice: '', droppedCount: 0, maxTasks: 4, budgetChars: 8000, headRatio: 0.5 });
        expect(out).toContain('### 태스크 1/2: 조사 1\n첫 결과');
        expect(out).toContain('### 태스크 2/2: 조사 2\n둘째 결과');
        expect(out).not.toContain('생략');
    });

    it('결과가 없는 태스크와 상한 초과분을 알린다', () => {
        const out = composeSpawnResult({ tasks: tasks(2), results: ['ok', null], noToolsNotice: '', droppedCount: 3, maxTasks: 4, budgetChars: 8000, headRatio: 0.5 });
        expect(out).toContain('Error: 서브에이전트가 결과를 반환하지 못했습니다.');
        expect(out).toContain('초과분 3개');
    });
});

describe('composeSpawnResult — 태스크별 상태 줄', () => {
    it('상태 줄이 있으면 머리말 바로 아래에 싣고, 없는 태스크는 종전 형식 그대로다', () => {
        const out = composeSpawnResult({
            tasks: tasks(2), results: ['첫 결과', '둘째 결과'], statusLines: ['[종료 사유: 시간 초과]', undefined],
            noToolsNotice: '', droppedCount: 0, maxTasks: 4, budgetChars: 8000, headRatio: 0.5,
        });
        expect(out).toContain('### 태스크 1/2: 조사 1\n[종료 사유: 시간 초과]\n첫 결과');
        expect(out).toContain('### 태스크 2/2: 조사 2\n둘째 결과');
    });

    it('예산을 넘겨 본문을 줄여도 상태 줄은 남는다', () => {
        const out = composeSpawnResult({
            tasks: tasks(2), results: ['a'.repeat(9000), 'b'.repeat(9000)], statusLines: ['[종료 사유: 정상 완료]', '[종료 사유: 오류]'],
            noToolsNotice: '', droppedCount: 0, maxTasks: 4, budgetChars: 8000, headRatio: 0.5,
        });
        expect(out.length).toBeLessThanOrEqual(8000);
        expect(out).toContain('[종료 사유: 정상 완료]');
        expect(out).toContain('[종료 사유: 오류]');
    });
});

describe('partialSubagentResult — 상한에 걸린 부분 결과 표시', () => {
    it('부모가 완주와 구분할 수 있게 머리말을 붙인다', () => {
        expect(partialSubagentResult('turns', '중간 정리')).toMatch(/^\[서브에이전트 상태: 턴 상한 도달 — 부분 결과\]\n중간 정리$/);
        expect(partialSubagentResult('tokens', '')).toContain('토큰 상한 도달');
    });
});
