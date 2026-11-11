import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, decide, parseReleaseManifest } from './desktop-publish.mjs';

test('compareVersions: 점으로 나눈 수 비교, 모자란 자리는 0', () => {
    assert.equal(compareVersions('0.3.8', '0.3.8'), 0);
    assert.equal(compareVersions('0.3.9', '0.3.8'), 1);
    assert.equal(compareVersions('0.3.7', '0.3.8'), -1);
    assert.equal(compareVersions('0.4', '0.4.0'), 0);
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('1', '0.99.99'), 1);
});

test('decide: 같음 → unchanged, 게시본이 높음 → ahead, 저장소가 높거나 게시본 없음 → publish', () => {
    assert.equal(decide({ repoVersion: '0.3.8', publishedVersion: '0.3.8' }), 'unchanged');
    assert.equal(decide({ repoVersion: '0.4', publishedVersion: '0.4.0' }), 'unchanged');
    assert.equal(decide({ repoVersion: '0.3.7', publishedVersion: '0.3.8' }), 'ahead');
    assert.equal(decide({ repoVersion: '0.3.8', publishedVersion: '0.3.7' }), 'publish');
    assert.equal(decide({ repoVersion: '0.3.8', publishedVersion: undefined }), 'publish');
});

const GOOD = { schemaVersion: 1, version: '0.3.8', file: 'OpenMake-Companion-0.3.8-arm64.dmg', sha256: 'a'.repeat(64), gitSha: 'b'.repeat(40) };
const text = (patch) => JSON.stringify({ ...GOOD, ...patch });

test('parseReleaseManifest: 정상 자산 매니페스트를 그대로 돌려준다', () => {
    assert.deepEqual(parseReleaseManifest(text({}), '0.3.8'), GOOD);
});

test('parseReleaseManifest: 형식·버전이 어긋나면 throw', () => {
    const bad = [
        ['schemaVersion', { schemaVersion: 2 }],
        ['version 불일치', { version: '0.3.9', file: 'OpenMake-Companion-0.3.9-arm64.dmg' }],
        ['version 형식', { version: '0.3.8-rc1' }],
        ['file 에 /', { file: 'x/OpenMake-Companion-0.3.8-arm64.dmg' }],
        ['file 에 ..', { file: '../OpenMake-Companion-0.3.8-arm64.dmg' }],
        ['file 의 버전 불일치', { file: 'OpenMake-Companion-0.3.9-arm64.dmg' }],
        ['file 확장자', { file: 'OpenMake-Companion-0.3.8-arm64.zip' }],
        ['sha256 길이', { sha256: 'a'.repeat(63) }],
        ['sha256 문자', { sha256: 'g'.repeat(64) }],
        ['sha256 대문자', { sha256: 'A'.repeat(64) }],
        ['gitSha 길이', { gitSha: 'b'.repeat(39) }],
        ['gitSha 문자', { gitSha: 'z'.repeat(40) }],
    ];
    for (const [name, patch] of bad) assert.throws(() => parseReleaseManifest(text(patch), '0.3.8'), undefined, name);
    assert.throws(() => parseReleaseManifest('not json', '0.3.8'));
    assert.throws(() => parseReleaseManifest('null', '0.3.8'));
});
