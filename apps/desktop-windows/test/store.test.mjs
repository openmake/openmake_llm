import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store, DEFAULT_SERVER } from '../src/store.mjs';
import { MESSAGES, pickLocale, translate } from '../src/i18n.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'omk-desktop-store-'));
const xor = { isAvailable: () => true, encrypt: (t) => Buffer.from(t).map((b) => b ^ 0x5a), decrypt: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString() };

test('설정 — 기본값, 저장, 잘못된 서버 주소는 기본으로', () => {
  const s = new Store(tmp(), xor);
  assert.deepEqual(s.loadSettings(), { server: DEFAULT_SERVER, browserEnabled: false, folders: [] });
  s.saveSettings({ server: 'http://localhost:52416/', browserEnabled: true, folders: ['C:\\work'] });
  assert.deepEqual(s.loadSettings(), { server: 'http://localhost:52416', browserEnabled: true, folders: ['C:\\work'] });
  s.saveSettings({ server: 'javascript:alert(1)' });
  assert.equal(s.loadSettings().server, DEFAULT_SERVER);
});

test('API key — 암호화해서만 저장하고 평문이 디스크에 남지 않는다', () => {
  const dir = tmp();
  const s = new Store(dir, xor);
  assert.equal(s.saveApiKey('  omk_live_secret  '), true);
  assert.equal(s.loadApiKey(), 'omk_live_secret');
  assert.ok(!fs.readFileSync(path.join(dir, 'api-key.bin')).toString('latin1').includes('omk_live_secret'));
  assert.equal(s.saveApiKey(''), true);
  assert.equal(s.loadApiKey(), '');
});

test('API key — 암호화를 쓸 수 없으면 저장하지 않는다', () => {
  const dir = tmp();
  const s = new Store(dir, { ...xor, isAvailable: () => false });
  assert.equal(s.saveApiKey('omk_live_secret'), false);
  assert.equal(fs.existsSync(path.join(dir, 'api-key.bin')), false);
  assert.equal(s.loadApiKey(), '');
});

test('PC 식별자는 유지되고, 폴더별 기기 ID 는 폴더마다 다르되 같은 PC 식별자를 공유한다', () => {
  const dir = tmp();
  const host = new Store(dir, xor).hostId();
  const again = new Store(dir, xor);
  assert.equal(again.hostId(), host);
  const a = again.deviceIdFor('C:\\work\\a'), b = again.deviceIdFor('C:\\work\\b');
  assert.notEqual(a, b);
  assert.equal(again.deviceIdFor('C:\\work\\a'), a);
  assert.ok(a.startsWith(`${host}-r-`) && a.length <= 64);
});

test('문구 — 5개 언어의 키가 같고 빈 값이 없다', () => {
  const langs = Object.keys(MESSAGES);
  assert.deepEqual(langs.sort(), ['de', 'en', 'ja', 'ko', 'zh']);
  const keys = Object.keys(MESSAGES.ko).sort();
  for (const l of langs) {
    assert.deepEqual(Object.keys(MESSAGES[l]).sort(), keys, `${l} 키 불일치`);
    for (const k of keys) assert.ok(MESSAGES[l][k].trim().length > 0, `${l}.${k} 비어 있음`);
  }
});

test('문구 — 언어 선택과 자리 채우기', () => {
  assert.equal(pickLocale('ko-KR'), 'ko');
  assert.equal(pickLocale('zh-CN'), 'zh');
  assert.equal(pickLocale('fr-FR'), 'ko');
  assert.equal(translate('en', 'menu.status', 'Connected'), 'Status: Connected');
  assert.equal(translate('ko', 'no.such.key'), 'no.such.key');
});
