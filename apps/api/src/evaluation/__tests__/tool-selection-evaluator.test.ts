import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    loadToolSelectionDataset, matchExpectedArgs, judgeExposure, judgeObservedCalls, runToolSelectionEvaluation,
    type ToolSelectionCase,
} from '../tool-selection-evaluator';

describe('tool-selection-evaluator', () => {
    it('기본 골든셋이 로드되고 40건 · id 유일', () => {
        const ds = loadToolSelectionDataset();
        expect(ds.cases).toHaveLength(40);
        expect(new Set(ds.cases.map((c) => c.id)).size).toBe(40);
    });

    it('의미 검증 — 기대/금지 없는 케이스·expectedTool 없는 expectedArgs 거부', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-ds-'));
        const f = path.join(dir, 'ds.json');
        fs.writeFileSync(f, JSON.stringify({ version: '1', description: '', cases: [{ id: 'a', query: 'q' }, { id: 'b', query: 'q', forbiddenTools: ['x'], expectedArgs: { q: 'y' } }] }));
        expect(() => loadToolSelectionDataset(f)).toThrow(/a: expectedTool[\s\S]*b: expectedArgs/);
    });

    it('matchExpectedArgs — 문자열은 대소문자 무시 포함, regex, 없는 키는 실패', () => {
        expect(matchExpectedArgs({ query: 'Seoul weather' }, { query: 'seoul' })).toBeNull();
        expect(matchExpectedArgs({ query: '서울 날씨' }, { query: { regex: '서울|seoul' } })).toBeNull();
        expect(matchExpectedArgs({}, { url: 'example.com' })).toMatch(/url 불일치/);
    });

    const c: ToolSelectionCase = { id: 'x', query: 'q', expectedTool: 'web_search', expectedArgs: { query: 'kospi' }, forbiddenTools: ['ops_metrics'] };

    it('judgeExposure — 기대 미노출·금지 노출', () => {
        expect(judgeExposure(c, ['web_search'])).toBeNull();
        expect(judgeExposure(c, ['extract_webpage'])).toMatch(/기대 도구 미노출/);
        expect(judgeExposure(c, ['web_search', 'ops_metrics'])).toMatch(/금지 도구 노출: ops_metrics/);
        expect(judgeExposure({ id: 'y', query: 'q', expectedToolsAny: ['a', 'b'] }, ['b'])).toBeNull();
    });

    it('judgeObservedCalls — 호출 이름·인자·금지 호출', () => {
        expect(judgeObservedCalls(c, [{ name: 'web_search', args: { query: 'KOSPI close' } }])).toBeNull();
        expect(judgeObservedCalls(c, [{ name: 'web_search', args: { query: 'nasdaq' } }])).toMatch(/인자 query/);
        expect(judgeObservedCalls(c, [])).toMatch(/미호출.*없음/);
        expect(judgeObservedCalls({ id: 'n', query: 'q', forbiddenTools: ['web_search'] }, [{ name: 'web_search', args: {} }])).toMatch(/금지 도구 호출/);
    });

    it('real 모드 러너 — 관찰기 결과로 판정, 예외는 실패 케이스로 기록', async () => {
        const ds = { version: '1', description: '', cases: [c, { ...c, id: 'boom' }] };
        const summary = await runToolSelectionEvaluation(ds, {
            mode: 'real',
            observe: async (k) => { if (k.id === 'boom') throw new Error('timeout'); return [{ name: 'web_search', args: { query: 'kospi' } }]; },
        });
        expect(summary).toMatchObject({ totalCases: 2, passedCases: 1 });
        expect(summary.results[1].failureReason).toMatch(/실행 오류: timeout/);
    });
});
