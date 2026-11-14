import { request } from 'http';
import { startLlmFixture } from './llm-fixture-server';

describe('llm-fixture-server — 받은 요청 본문 기록', () => {
    it('글자 한가운데에서 갈려 온 본문도 원문 그대로 기록한다', async () => {
        const fx = await startLlmFixture(() => ({ kind: 'json', body: { ok: true } }));
        try {
            const sent = { messages: [{ role: 'system', content: '그라데이션 '.repeat(2000) }] };
            const body = Buffer.from(JSON.stringify(sent));
            const at = body.indexOf(Buffer.from('라')) + 1; // '라' 의 첫 바이트 뒤에서 가른다
            await new Promise<void>((ok, fail) => {
                const req = request(`${fx.baseURL}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
                    res.resume();
                    res.on('end', ok);
                });
                req.on('error', fail);
                req.write(body.subarray(0, at));
                setTimeout(() => req.end(body.subarray(at)), 50);
            });
            expect(fx.requests).toEqual([sent]);
        } finally {
            await fx.close();
        }
    });
});
