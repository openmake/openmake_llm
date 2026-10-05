/**
 * field-value 테스트 — 실제 Chromium 으로 입력 칸의 값을 읽는다. `node --test infra/` 로 돈다.
 * playwright 나 브라우저가 없는 환경(CI)에서는 건너뛴다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filledValue, readTextOrValue, FILL_ECHO_MAX_CHARS } from './field-value.mjs';

const PAGE = `<input id="name"><input id="pw" type="password"><textarea id="memo"></textarea>
<div id="rich" contenteditable="true"></div><p id="para">보이는 글</p>
<select id="sel"><option value="a">A</option><option value="b" selected>B</option></select>`;

async function launch() {
    if (process.env.CI === 'true') return null;
    try {
        const { chromium } = await import('playwright');
        return await chromium.launch({ headless: true });
    } catch {
        return null;
    }
}

test('입력 뒤 실제 값을 돌려주고, 입력 칸의 글 추출은 현재 값을 준다', async (t) => {
    const browser = await launch();
    if (!browser) { t.skip('playwright chromium 을 띄울 수 없는 환경'); return; }
    try {
        const page = await browser.newPage();
        await page.setContent(PAGE);

        await page.fill('#name', '홍길동');
        assert.deepEqual(await filledValue(page.locator('#name').first()), { value: '홍길동' });

        await page.fill('#memo', '가'.repeat(FILL_ECHO_MAX_CHARS + 50));
        assert.equal((await filledValue(page.locator('#memo').first())).value.length, FILL_ECHO_MAX_CHARS);

        await page.fill('#rich', '편집 영역');
        assert.deepEqual(await filledValue(page.locator('#rich').first()), { value: '편집 영역' });

        // 비밀번호는 싣지 않는다 — 입력 결과에도, 글 추출에도
        await page.fill('#pw', 'secret-1234');
        assert.deepEqual(await filledValue(page.locator('#pw').first()), {});
        assert.equal(await page.locator('#pw').first().evaluate(readTextOrValue), '');

        // 입력 칸의 글 추출은 현재 값(종전엔 innerText 라 빈 문자열), 일반 요소는 보이는 글
        assert.equal(await page.locator('#name').first().evaluate(readTextOrValue), '홍길동');
        assert.equal(await page.locator('#sel').first().evaluate(readTextOrValue), 'b');
        assert.equal(await page.locator('#para').first().evaluate(readTextOrValue), '보이는 글');

        // 요소가 없으면 입력 결과에 값을 싣지 않고 조용히 넘어간다(입력은 이미 성공한 뒤다)
        assert.deepEqual(await filledValue(page.locator('#none').first()), {});
    } finally {
        await browser.close();
    }
});
