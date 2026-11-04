/**
 * 브라우저 제어 흐름(if·repeat) — @openmake/config 의 검사·평탄화와 LocalBrowser 해석기(browser/browser-flow.ts).
 * 서버 샌드박스 러너(infra/task-runtime/browser-flow.mjs)와 같은 사례 파일을 읽어 같은 결과를 내는지 확인한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    BrowserFlowError, flattenBrowserActions, planBrowserActions, validateBrowserFlow, type BrowserFlowCond,
} from '@openmake/config';
import { condExpression, runBrowserFlow } from '../browser/browser-flow';
import type { Action, BrowserActionResult } from '../browser/local-browser-defs';

interface StructureCase { name: string; actions: unknown[]; flat?: string[]; error?: boolean }
interface RunCase { name: string; actions: unknown[]; conds: Record<string, Array<boolean | 'throw'>>; maxSimple?: number; results: unknown[] }
const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../infra/task-runtime/__fixtures__/browser-flow-cases.json'), 'utf8')) as {
    structure: StructureCase[]; run: RunCase[];
};

function fakeCond(conds: RunCase['conds']): (c: BrowserFlowCond) => Promise<boolean> {
    const used = new Map<string, number>();
    return async (c) => {
        const key = JSON.stringify(c);
        const list = conds[key];
        if (!list) throw new Error(`사례에 없는 조건: ${key}`);
        const n = used.get(key) ?? 0;
        used.set(key, n + 1);
        const v = list[Math.min(n, list.length - 1)];
        if (v === 'throw') throw new Error('조건 평가 실패');
        return v;
    };
}
const fakeRun = async (a: Action, i: number): Promise<BrowserActionResult> =>
    (a.fail ? { i, type: a.type, ok: false, error: '실패' } : { i, type: a.type, ok: true });
const errorAsFlag = (rs: BrowserActionResult[]) => rs.map((r) => (r.error !== undefined ? { ...r, error: true } : r));

describe('공용 사례 — 검사·평탄화(@openmake/config)', () => {
    it.each(cases.structure.map((c) => [c.name, c] as const))('%s', (_n, c) => {
        if (c.error) {
            expect(typeof validateBrowserFlow(c.actions)).toBe('string');
            expect(() => flattenBrowserActions(c.actions)).toThrow(BrowserFlowError);
        } else {
            expect(validateBrowserFlow(c.actions)).toBeNull();
            expect(flattenBrowserActions(c.actions).map((a) => (a as { type: string }).type)).toEqual(c.flat);
        }
    });
});

describe('공용 사례 — 실행 순서(LocalBrowser 해석기)', () => {
    it.each(cases.run.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
        expect(validateBrowserFlow(c.actions)).toBeNull();
        const results = await runBrowserFlow(c.actions, { runSimple: fakeRun, evalCond: fakeCond(c.conds) }, c.maxSimple ?? 40);
        expect(errorAsFlag(results)).toEqual(c.results);
    });
});

describe('사이트 정책 계획은 분기·반복 안의 쓰기도 실행 전에 찾는다', () => {
    const policy = { allow: ['groupware.example.co.kr'], deny: [] };
    it('else 분기 안의 목록 밖 입력은 승인 대상', () => {
        const plan = planBrowserActions([
            { type: 'goto', url: 'https://example.com' },
            { type: 'if', cond: { exists: '#ok' }, then: [{ type: 'extractText' }], else: [{ type: 'fill', selector: '#q', text: '업무 자료' }] },
        ], null, policy);
        expect(plan.offListWrites).toEqual([{ index: 2, type: 'fill', host: 'example.com', detail: '#q ← 업무 자료' }]);
    });
    it('repeat 본문의 비허용 주소는 막는다', () => {
        const plan = planBrowserActions([{ type: 'repeat', times: 2, actions: [{ type: 'goto', url: 'file:///etc/passwd' }] }], null, policy);
        expect(plan.blocked).toEqual([{ index: 0, url: 'file:///etc/passwd' }]);
    });
    it('형태가 어긋난 흐름은 던진다(호출부가 먼저 거른다)', () => {
        expect(() => planBrowserActions([{ type: 'repeat', times: 99, actions: [{ type: 'click', selector: 'a' }] }], null, policy)).toThrow(BrowserFlowError);
    });
});

describe('조건 식', () => {
    it('사용자 입력은 문자열 값으로만 들어간다', () => {
        const evil = '"); alert(1); ("';
        expect(condExpression({ not: { textIncludes: evil, selector: '#a' } })).toContain(JSON.stringify(evil));
        expect(condExpression({ exists: 'h1' })).toBe('!!document.querySelector("h1")');
        expect(condExpression({ urlIncludes: 'page=2' })).toBe('location.href.includes("page=2")');
    });
});
