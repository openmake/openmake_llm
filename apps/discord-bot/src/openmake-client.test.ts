/**
 * requestChatCompletion 요청 body 조립 검증 — 전역 fetch 를 바꿔 끼워 보낸 body 를 확인한다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requestChatCompletion } from './openmake-client';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** 모델 목록·채팅 응답을 흉내 내고, 채팅 요청 body 를 기록한다 */
function stubFetch(): { bodies: Array<Record<string, unknown>> } {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/models')) {
            return Response.json({ data: [{ id: 'test-model' }] });
        }
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ choices: [{ message: { content: '답변' } }] });
    }) as typeof fetch;
    return { bodies };
}

const history = [{ role: 'user' as const, content: '이전 질문' }, { role: 'assistant' as const, content: '이전 답' }];

test('첨부 없으면 user content 는 문자열, files 필드 없음', async () => {
    const { bodies } = stubFetch();
    const answer = await requestChatCompletion(history, '안녕');
    assert.equal(answer.content, '답변');
    const body = bodies[0];
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    assert.deepEqual(messages.slice(0, 2), history);
    assert.deepEqual(messages[2], { role: 'user', content: '안녕' });
    assert.equal('files' in body, false);
    assert.equal(body.publish_artifacts, true);
});

test('이미지가 있으면 마지막 user content 는 text + image_url 배열', async () => {
    const { bodies } = stubFetch();
    const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,YWJj' } };
    await requestChatCompletion(history, '이 그림 설명', { imageParts: [image], files: [] });
    const messages = bodies[0].messages as Array<{ role: string; content: unknown }>;
    assert.deepEqual(messages.slice(0, 2), history, '히스토리는 텍스트 그대로');
    assert.deepEqual(messages[2], { role: 'user', content: [{ type: 'text', text: '이 그림 설명' }, image] });
    assert.equal('files' in bodies[0], false);
});

test('문서가 있으면 body.files 로 보내고 content 는 문자열 유지', async () => {
    const { bodies } = stubFetch();
    const file = { name: 'r.pdf', type: 'application/pdf', size: 3, data: 'YWJj' };
    await requestChatCompletion(history, '요약해', { imageParts: [], files: [file] });
    const messages = bodies[0].messages as Array<{ role: string; content: unknown }>;
    assert.deepEqual(messages[2], { role: 'user', content: '요약해' });
    assert.deepEqual(bodies[0].files, [file]);
});
