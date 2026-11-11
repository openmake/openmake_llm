import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, decide } from './desktop-publish.mjs';

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
