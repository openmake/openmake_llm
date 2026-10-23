/**
 * attachments — 채팅 응답의 아티팩트 첨부 이름이 디스코드가 보존하는 글자만 쓰고, 본문 안내와 같은지.
 * 이미지(/generated/*)가 있는 입력은 fetch 를 실패하도록 바꿔 네트워크를 타지 않는다.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { prepareReply, type ResponseArtifact } from './attachments';
import { config } from './config';

function artifact(over: Partial<ResponseArtifact>): ResponseArtifact {
    return { id: 'a1', kind: 'markdown', title: '', language: null, version: 1, content: '# hi', ...over };
}

test('한글 제목은 id 로 파일명을 짓고 본문 안내도 같은 이름이다', async () => {
    const r = await prepareReply('설명입니다', [artifact({ id: 'dog-photo-description', title: '강아지 사진 설명' })]);
    assert.equal(r.files.length, 1);
    assert.equal(r.files[0].name, 'dog-photo-description.md');
    assert.ok(r.content.includes('(파일 첨부: dog-photo-description.md)'));
    assert.ok(r.content.includes('📎 **강아지 사진 설명**'));
});

test('ASCII·한글 섞인 제목은 ASCII 부분만 남긴다', async () => {
    const r = await prepareReply('', [artifact({ id: 'x1', title: 'Todo App 설계' })]);
    assert.equal(r.files[0].name, 'Todo_App.md');
    assert.ok(r.content.includes('(파일 첨부: Todo_App.md)'));
});

test('ASCII 제목은 종전과 같다', async () => {
    const r = await prepareReply('', [artifact({ id: 'x2', title: 'dog-photo-analysis' })]);
    assert.equal(r.files[0].name, 'dog-photo-analysis.md');
});

test('제목·id 모두 비ASCII 면 artifact', async () => {
    const r = await prepareReply('', [artifact({ id: '산출물', title: '반려견 사진 분석' })]);
    assert.equal(r.files[0].name, 'artifact.md');
    assert.ok(r.content.includes('(파일 첨부: artifact.md)'));
});

test('[[artifact:id]] 자리표시자를 제목과 실제 파일명으로 바꾼다', async () => {
    const r = await prepareReply('결과: [[artifact:dog-desc:v2]] 끝', [artifact({ id: 'dog-desc', title: '강아지 사진 설명' })]);
    assert.equal(r.content, '결과: 📎 **강아지 사진 설명** · (파일 첨부: dog-desc.md) 끝');
});

test('표 변환은 마지막에 — content 는 변환본, historyContent 는 표 원문', async () => {
    const table = '| 구분 | 내용 |\n|---|---|\n| 품종 | 푸들 |';
    const r = await prepareReply(table);
    assert.equal(r.content, '*구분 · 내용*\n\n**품종**\n- 푸들');
    assert.equal(r.historyContent, table);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('표 셀 안의 생성 이미지를 지운 뒤 변환하므로 빈 목록 항목이 남지 않는다', async () => {
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    const r = await prepareReply('| 구분 | 내용 |\n|---|---|\n| 사진 | ![x](/generated/abc.png) |\n| 품종 | 푸들 |');
    assert.equal(r.files.length, 0);
    assert.ok(!/^-\s*$/m.test(r.content), r.content);
    assert.ok(r.content.includes('**사진**'));
    assert.ok(r.content.includes('⚠️ 이미지 첨부 실패/생략: `abc.png`'));
});

test('생성 산출물은 채팅과 같은 API 키로 내려받아 첨부한다 — 키가 없으면 /generated 가 401', async () => {
    let auth: string | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;
    const r = await prepareReply('완성 ![x](/generated/img-1.png) [🔊 음성](/generated/tts-1.mp3)');
    assert.equal(auth, `Bearer ${config.apiKey}`);
    assert.deepEqual(r.files.map((f) => f.name), ['img-1.png', 'tts-1.mp3']);
    assert.ok(!r.content.includes('첨부 실패'), r.content);
});
