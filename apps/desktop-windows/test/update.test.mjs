import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, pickWindowsUpdate, sha256Of } from '../src/update.mjs';

const SHA = 'a'.repeat(64);
const block = (over = {}) => ({ windows: { version: '0.2.0', file: 'OpenMake-Companion-Setup-0.2.0.exe', sha256: SHA, ...over } });

test('버전 비교', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.ok(compareVersions('0.1.0', '0.1.1') < 0);
});

test('새 버전의 Windows 블록만 고른다', () => {
  assert.deepEqual(pickWindowsUpdate(block(), '0.1.0'), { version: '0.2.0', file: 'OpenMake-Companion-Setup-0.2.0.exe', sha256: SHA, path: '/api/desktop/download/OpenMake-Companion-Setup-0.2.0.exe' });
  assert.equal(pickWindowsUpdate(block(), '0.2.0'), null);
  assert.equal(pickWindowsUpdate(block(), '0.3.0'), null);
});

test('macOS 블록만 있는 응답·빈 응답은 업데이트 없음', () => {
  assert.equal(pickWindowsUpdate({ version: '9.9.9', file: 'OpenMake-Companion-9.9.9-arm64.dmg', native: {} }, '0.1.0'), null);
  assert.equal(pickWindowsUpdate(null, '0.1.0'), null);
});

test('파일명이 어긋나거나 해시가 없는 블록은 받지 않는다', () => {
  assert.equal(pickWindowsUpdate(block({ file: '..\\evil.exe' }), '0.1.0'), null);
  assert.equal(pickWindowsUpdate(block({ file: 'evil.exe' }), '0.1.0'), null);
  assert.equal(pickWindowsUpdate(block({ sha256: undefined }), '0.1.0'), null);
  assert.equal(pickWindowsUpdate(block({ sha256: 'zz' }), '0.1.0'), null);
});

test('sha256', () => {
  assert.equal(sha256Of(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
