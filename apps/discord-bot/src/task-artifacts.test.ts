/**
 * 작업 산출물 → 디스코드 첨부 — 파일 이름·확장자·개수·크기 상한을 고정한다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactFileName, MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES, toArtifactFiles } from './task-artifacts';
import type { TaskArtifact } from './task-client';

const art = (over: Partial<TaskArtifact>): TaskArtifact => ({ id: 'a', kind: 'markdown', title: '보고서', lang: null, content: '# 제목', ...over });

test('확장자: markdown→md, code→lang 또는 txt, 그 외 kind 그대로', () => {
    assert.equal(artifactFileName(art({ kind: 'markdown' })), '보고서.md');
    assert.equal(artifactFileName(art({ kind: 'code', lang: 'py' })), '보고서.py');
    assert.equal(artifactFileName(art({ kind: 'code', lang: null })), '보고서.txt');
    assert.equal(artifactFileName(art({ kind: 'html' })), '보고서.html');
    assert.equal(artifactFileName(art({ kind: 'csv' })), '보고서.csv');
});

test('파일 이름: 경로 구분자·제어문자를 지우고 80자에서 자르며, 비면 artifact', () => {
    assert.equal(artifactFileName(art({ title: '../a/b\\c:d\n\x07e', kind: 'svg' })), '.._a_b_c_d_e.svg');
    assert.equal(artifactFileName(art({ title: '가'.repeat(200) })), `${'가'.repeat(80)}.md`);
    assert.equal(artifactFileName(art({ title: '  ' })), 'artifact.md');
});

test('이름이 겹치면 -2, -3 을 붙인다', () => {
    const { files } = toArtifactFiles([art({}), art({}), art({}), art({ kind: 'html' })]);
    assert.deepEqual(files.map((f) => f.name), ['보고서.md', '보고서-2.md', '보고서-3.md', '보고서.html']);
    assert.equal(files[0].data.toString('utf8'), '# 제목');
});

test('첨부는 최대 5개, 8MB 를 넘는 것은 건너뛴다 — 못 올린 수를 센다', () => {
    const many = Array.from({ length: 7 }, (_, i) => art({ title: `f${i}` }));
    const r = toArtifactFiles(many);
    assert.equal(MAX_ARTIFACT_FILES, 5);
    assert.equal(r.files.length, 5);
    assert.equal(r.leftOver, 2);

    const big = toArtifactFiles([art({ title: 'big', content: 'x'.repeat(MAX_ARTIFACT_BYTES + 1) }), art({ title: 'ok' })]);
    assert.deepEqual(big.files.map((f) => f.name), ['ok.md']);
    assert.equal(big.leftOver, 1);
    assert.deepEqual(toArtifactFiles([]), { files: [], leftOver: 0 });
});
