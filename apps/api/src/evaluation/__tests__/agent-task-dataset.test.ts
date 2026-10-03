/**
 * 에이전트 작업 과제 묶음 정의 검사 — 실제 실행 없이 정의와 스키마만 본다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseAgentTaskDataset, judgeExpectedAnswer } from '../agent-task-dataset';

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../golden-agent-tasks.json'), 'utf8')) as Record<string, unknown>;

describe('golden-agent-tasks.json', () => {
    it('모든 과제가 스키마와 궤적 기대 형식을 지킨다', () => {
        expect(() => parseAgentTaskDataset(raw)).not.toThrow();
    });

    it('브라우저를 쓰는 과제가 있고, 정답 문자열과 브라우저 호출 기대를 갖는다', () => {
        const dataset = parseAgentTaskDataset(raw);
        const browser = dataset.browserCases ?? [];
        expect(browser.length).toBeGreaterThanOrEqual(1);
        for (const c of browser) {
            expect(c.expectedAnswer.includes.length).toBeGreaterThan(0);
            expect((c.spec as { requiredTools?: string[]; maxCalls?: Record<string, number> }).requiredTools).toContain('browser');
            expect((c.spec as { maxCalls?: Record<string, number> }).maxCalls?.browser).toBeGreaterThan(0);
        }
    });

    it('야간 실행 묶음(cases)에는 브라우저 과제를 넣지 않는다 — 네트워크 없는 샌드박스에서 끝나야 한다', () => {
        const dataset = parseAgentTaskDataset(raw);
        for (const c of dataset.cases) expect((c.spec as { requiredTools?: string[] }).requiredTools ?? []).not.toContain('browser');
    });
});

describe('parseAgentTaskDataset — 잘못된 정의는 거절한다', () => {
    const base = { version: '1', cases: [{ id: 'a', goal: 'g', maxTurns: 3, spec: { id: 'a' } }] };
    const browserCase = (over: Record<string, unknown> = {}) => ({
        id: 'b', goal: 'g', maxTurns: 5, spec: { id: 'b', requiredTools: ['browser'] }, expectedAnswer: { includes: ['x'] }, ...over,
    });

    it('정상 정의는 통과한다', () => {
        expect(() => parseAgentTaskDataset({ ...base, browserCases: [browserCase()] })).not.toThrow();
    });
    it('정답 문자열이 없는 브라우저 과제', () => {
        expect(() => parseAgentTaskDataset({ ...base, browserCases: [browserCase({ expectedAnswer: { includes: [] } })] })).toThrow();
    });
    it('browser 를 요구하지 않거나 금지하는 브라우저 과제', () => {
        expect(() => parseAgentTaskDataset({ ...base, browserCases: [browserCase({ spec: { id: 'b' } })] })).toThrow(/requiredTools/);
        expect(() => parseAgentTaskDataset({ ...base, browserCases: [browserCase({ spec: { id: 'b', requiredTools: ['browser'], forbiddenTools: ['browser'] } })] })).toThrow(/금지/);
    });
    it('id 중복과 spec.id 불일치', () => {
        expect(() => parseAgentTaskDataset({ ...base, browserCases: [browserCase({ id: 'a', spec: { id: 'a', requiredTools: ['browser'] } })] })).toThrow(/중복/);
        expect(() => parseAgentTaskDataset({ version: '1', cases: [{ id: 'a', goal: 'g', maxTurns: 3, spec: { id: 'z' } }] })).toThrow(/spec.id/);
    });
});

describe('judgeExpectedAnswer', () => {
    it('기대 문자열이 모두 들어 있으면 성공(대소문자 무시)', () => {
        expect(judgeExpectedAnswer({ includes: ['Example Domain'] }, '페이지 제목은 "example domain" 입니다.')).toBe(true);
        expect(judgeExpectedAnswer({ includes: ['A', 'B'] }, 'a 만 있다')).toBe(false);
        expect(judgeExpectedAnswer({ includes: ['A'] }, null)).toBe(false);
    });
});
