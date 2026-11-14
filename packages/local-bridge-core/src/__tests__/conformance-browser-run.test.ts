/**
 * 브라우저 적합성 fixture `browser-run` TS 러너 — 액션 → CDP 명령 순서·인자 → 결과 JSON 글자를 가짜 CDP 대본으로 고정한다.
 * 같은 fixture 를 Rust 러너(apps/openmake-code/crates/omk-bridge-core/tests/conformance_browser/run.rs)도 통과해야 한다.
 * 목록·모양 검사는 conformance-browser.test.ts 가 한다. Chrome 없이 돈다(CI 에서 전부 실행). 형식은 conformance/BROWSER.md.
 */
import { load, shape } from './conformance-browser-support';
import type { FsSetup } from './conformance-browser-support';
import { OPTS_KEYS, RULE_KEYS, runBrowserCase, type Rule, type RunInput, type Sent } from './conformance-browser-run-support';

type Expect = { stdout: string; sent: Sent[]; saved: Array<{ name: string; hex: string }> };
type Case = { id: string; setup: FsSetup[]; input: RunInput; expect: Expect };
const doc = load<{ defaults: Rule[]; cases: Case[] }>('browser-run');

describe('browser-run', () => {
    it('규칙·옵션·기대값 모양', () => {
        doc.defaults.forEach((r, n) => shape(r, ['on'], RULE_KEYS.filter((k) => k !== 'on'), `browser-run/defaults/${n}`));
        for (const c of doc.cases) {
            const at = `browser-run/cases/${c.id}`;
            c.input.cdp.forEach((r, n) => shape(r, ['on'], RULE_KEYS.filter((k) => k !== 'on'), `${at}/cdp/${n}`));
            shape(c.input.opts, [], OPTS_KEYS, `${at}/opts`);
            shape(c.expect, ['stdout', 'sent', 'saved'], [], `${at}/expect`);
        }
    });

    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', async (_id, c) => {
        const got = await runBrowserCase(doc.defaults, c.setup, c.input);
        expect({ unmatched: got.unmatched }).toEqual({ unmatched: [] });
        expect(got.stdout).toBe(c.expect.stdout);
        expect(got.sent).toEqual(c.expect.sent);
        expect(got.saved).toEqual(c.expect.saved);
    });
});
