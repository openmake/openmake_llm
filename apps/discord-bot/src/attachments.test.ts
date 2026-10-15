/**
 * attachments — 채팅 응답의 아티팩트 첨부 이름이 디스코드가 보존하는 글자만 쓰고, 본문 안내와 같은지.
 * 이미지(/generated/*)가 없는 입력만 써서 네트워크를 타지 않는다.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReply, type ResponseArtifact } from './attachments';

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
