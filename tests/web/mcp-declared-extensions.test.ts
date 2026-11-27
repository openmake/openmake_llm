/**
 * MCP-5 웹 — 백엔드 declaredExtensions 파싱과 배지 종류·제목(순수 함수).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredExtensionKinds, declaredExtensionTitle, parseDeclaredExtensions } from '../../apps/web/addons/mcp-runtime/declared-extensions';
import { mapTemplate } from '../../apps/web/addons/mcp-runtime/pages/mcp-catalog-fields';

test('parseDeclaredExtensions — 필드가 없으면 빈 배열(플래그 OFF 백엔드·미선언 서버)', () => {
  assert.deepEqual(parseDeclaredExtensions(undefined), []);
  assert.deepEqual(parseDeclaredExtensions('x'), []);
  assert.deepEqual(mapTemplate({ id: 'a', display_name: 'A', transport_type: 'stdio' }).declaredExtensions, []);
});

test('parseDeclaredExtensions — 모르는 종류는 unknown, id 없는 항목은 버린다', () => {
  assert.deepEqual(parseDeclaredExtensions([{ id: 'io.modelcontextprotocol/ui', kind: 'apps', version: '1' }, { kind: 'apps' }, { id: 'x/y', kind: 'future' }]), [
    { id: 'io.modelcontextprotocol/ui', version: '1', kind: 'apps' },
    { id: 'x/y', version: null, kind: 'unknown' },
  ]);
});

test('declaredExtensionKinds — 종류별 배지 하나, 스킬 제공이 맨 앞', () => {
  const list = parseDeclaredExtensions([
    { id: 'io.modelcontextprotocol/ui', kind: 'apps' },
    { id: 'io.modelcontextprotocol/skills', kind: 'skills' },
    { id: 'com.example/a', kind: 'unknown' },
    { id: 'com.example/b', kind: 'unknown' },
  ]);
  assert.deepEqual(declaredExtensionKinds(list), ['skills', 'apps', 'unknown']);
  assert.equal(declaredExtensionTitle(list, 'unknown', 'hint'), 'hint (com.example/a, com.example/b)');
});

test('mapTemplate — 카탈로그 응답의 declaredExtensions 를 받는다', () => {
  const e = mapTemplate({ id: 'a', display_name: 'A', transport_type: 'stdio', declaredExtensions: [{ id: 'io.modelcontextprotocol/skills', kind: 'skills' }] });
  assert.equal(e.declaredExtensions[0]?.kind, 'skills');
});
