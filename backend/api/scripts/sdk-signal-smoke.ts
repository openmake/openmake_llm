/**
 * OpenAI SDK signal abort 동작 smoke test.
 *
 * 검증: AbortController 로 mid-stream 호출 abort 시
 *   (a) iterator 가 silent 하게 종료 vs (b) Error throw
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import OpenAI from 'openai';

async function main(): Promise<void> {
    const baseURL = process.env.LLM_BASE_URL!;
    const apiKey = process.env.LLM_API_KEY!;
    const openai = new OpenAI({ baseURL: baseURL + '/v1', apiKey });

    const controller = new AbortController();

    console.log('--- Test A: abort mid-stream ---');
    setTimeout(() => {
        console.log('[t=200ms] controller.abort()');
        controller.abort();
    }, 200);

    try {
        const stream = await openai.chat.completions.create({
            model: 'qwen3.6-35b-a3b',
            messages: [{ role: 'user', content: 'Write a 200 word essay slowly' }],
            stream: true,
            max_tokens: 300,
        }, { signal: controller.signal });

        let chunks = 0;
        for await (const _chunk of stream) {
            chunks++;
        }
        console.log(`[silent-end] iterator 완료, chunks=${chunks} (THROW 안 함)`);
    } catch (err) {
        const e = err as Error & { name?: string; code?: string };
        console.log(`[THROW] name=${e.name} code=${e.code} message=${e.message?.slice(0, 80)}`);
    }

    console.log('\n--- Test B: pre-aborted signal ---');
    const preAborted = new AbortController();
    preAborted.abort();
    try {
        const stream = await openai.chat.completions.create({
            model: 'qwen3.6-35b-a3b',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
            max_tokens: 5,
        }, { signal: preAborted.signal });
        for await (const _chunk of stream) { /* drain */ }
        console.log('[silent-end] pre-aborted 도 silent 종료');
    } catch (err) {
        const e = err as Error & { name?: string };
        console.log(`[THROW] name=${e.name} message=${e.message?.slice(0, 80)}`);
    }

    process.exit(0);
}

main().catch(e => { console.error('main error:', e); process.exit(1); });
