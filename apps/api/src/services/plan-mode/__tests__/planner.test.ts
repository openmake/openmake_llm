import { parsePlan, normalizePlan } from '../planner';

const limits = { maxSteps: 12, maxCriticalFiles: 10, maxListItems: 8 };

describe('parsePlan', () => {
    it('순수 JSON', () => {
        expect(parsePlan('{"summary":"s","steps":[]}').summary).toBe('s');
    });
    it('코드펜스/머리말 허용', () => {
        expect(parsePlan('계획:\n```json\n{"summary":"x"}\n```').summary).toBe('x');
    });
    it('깨진 JSON → 빈 객체', () => {
        expect(parsePlan('nope')).toEqual({});
        expect(parsePlan('')).toEqual({});
    });
});

describe('normalizePlan', () => {
    it('정상 계획 정규화', () => {
        const p = normalizePlan({
            summary: 'approach',
            steps: [{ title: 'T1', action: 'do x', verify: 'check x' }],
            criticalFiles: ['a.ts', 'b.ts'],
            risks: ['r1'],
            openQuestions: ['q1'],
        }, limits);
        expect(p.summary).toBe('approach');
        expect(p.steps).toHaveLength(1);
        expect(p.steps[0].verify).toBe('check x');
        expect(p.criticalFiles).toEqual(['a.ts', 'b.ts']);
    });

    it('action 없는 단계 제외', () => {
        const p = normalizePlan({ steps: [{ title: 'T', verify: 'v' }, { action: 'real' }] }, limits);
        expect(p.steps).toHaveLength(1);
        expect(p.steps[0].action).toBe('real');
    });

    it('verify 비면 기본 문구 보강', () => {
        const p = normalizePlan({ steps: [{ action: 'do' }] }, limits);
        expect(p.steps[0].verify).toContain('미명시');
        expect(p.steps[0].title).toBe('단계 1');
    });

    it('steps 상한 적용', () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ action: `a${i}` }));
        const p = normalizePlan({ steps: many }, { maxSteps: 5, maxCriticalFiles: 10, maxListItems: 8 });
        expect(p.steps).toHaveLength(5);
    });

    it('criticalFiles 중복제거 + 상한', () => {
        const p = normalizePlan({ criticalFiles: ['a', 'a', 'b', 'c'] }, { maxSteps: 12, maxCriticalFiles: 2, maxListItems: 8 });
        expect(p.criticalFiles).toEqual(['a', 'b']);
    });

    it('비배열/비문자 필드 → 빈 배열', () => {
        const p = normalizePlan({ steps: 'x', criticalFiles: 42, risks: [1, '', 'ok'] }, limits);
        expect(p.steps).toEqual([]);
        expect(p.criticalFiles).toEqual([]);
        expect(p.risks).toEqual(['ok']);
    });

    it('빈 입력 → 빈 계획', () => {
        const p = normalizePlan({}, limits);
        expect(p.steps).toEqual([]);
        expect(p.summary).toBe('');
    });
});
