/**
 * browser-flow 테스트 — 공용 사례 파일(__fixtures__/browser-flow-cases.json)로 검사·평탄화·실행 순서를 확인한다.
 * 같은 파일을 packages/local-bridge-core 의 browser-flow 테스트(TS 쪽)도 읽는다. `node --test infra/` 로 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { condExpression, flattenBrowserActions, runBrowserFlow, validateBrowserFlow } from './browser-flow.mjs';

const cases = JSON.parse(readFileSync(new URL('./__fixtures__/browser-flow-cases.json', import.meta.url), 'utf8'));

/** 사례의 가짜 조건 — 조건 JSON 별 값 목록을 평가 순서대로 쓰고, 다 쓰면 마지막 값을 반복한다. "throw" 는 평가 오류. */
function fakeCond(conds) {
    const used = new Map();
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
const fakeRun = async (a, i) => (a.fail ? { i, type: a.type, ok: false, error: '실패' } : { i, type: a.type, ok: true });
const errorAsFlag = (rs) => rs.map((r) => (r.error !== undefined ? { ...r, error: true } : r));

for (const c of cases.structure) {
    test(`구조: ${c.name}`, () => {
        const e = validateBrowserFlow(c.actions);
        if (c.error) {
            assert.equal(typeof e, 'string');
            assert.throws(() => flattenBrowserActions(c.actions));
        } else {
            assert.equal(e, null);
            assert.deepEqual(flattenBrowserActions(c.actions).map((a) => a.type), c.flat);
        }
    });
}

for (const c of cases.run) {
    test(`실행: ${c.name}`, async () => {
        assert.equal(validateBrowserFlow(c.actions), null);
        const results = await runBrowserFlow(c.actions, { runSimple: fakeRun, evalCond: fakeCond(c.conds) }, c.maxSimple ?? 40);
        assert.deepEqual(errorAsFlag(results), c.results);
    });
}

test('조건 식 — 사용자 입력은 문자열 값으로만 들어간다', () => {
    const evil = '"); alert(1); ("';
    const expr = condExpression({ not: { textIncludes: evil, selector: '#a' } });
    assert.ok(expr.startsWith('!('));
    assert.ok(expr.includes(JSON.stringify(evil)));
    assert.match(condExpression({ urlIncludes: 'page=2' }), /^location\.href\.includes\("page=2"\)$/);
    assert.match(condExpression({ exists: 'h1' }), /^!!document\.querySelector\("h1"\)$/);
});

test('조건 식 — 실제 Chromium 에서 읽기 전용 판정', async (t) => {
    if (process.env.CI === 'true') { t.skip('CI'); return; }
    let browser;
    try { browser = await (await import('playwright')).chromium.launch({ headless: true }); } catch { t.skip('playwright chromium 을 띄울 수 없는 환경'); return; }
    try {
        const page = await browser.newPage();
        await page.setContent('<h1>제목</h1><p id="hid" style="display:none">숨김</p><input id="pw" type="password" value="secret"><input id="q" value="검색어">');
        const ev = (c) => page.evaluate(condExpression(c));
        assert.equal(await ev({ exists: 'h1' }), true);
        assert.equal(await ev({ exists: '#none' }), false);
        assert.equal(await ev({ visible: 'h1' }), true);
        assert.equal(await ev({ visible: '#hid' }), false);
        assert.equal(await ev({ textIncludes: '제목' }), true);
        assert.equal(await ev({ textIncludes: '검색', selector: '#q' }), true);
        assert.equal(await ev({ textIncludes: 'secret', selector: '#pw' }), false); // 비밀번호 칸 값은 보지 않는다
        assert.equal(await ev({ not: { urlIncludes: 'example.com' } }), true);
        await assert.rejects(ev({ exists: '[[bad' }));
    } finally {
        await browser.close();
    }
});
