// 계약 export 스크립트(scripts/export-openapi.ts)와 커밋된 WS 계약 산출물의 대응 — WS_CONTRACT_TYPES 에 올린
// shared-types 루트 타입마다 정의가 ws-chat.v1.schema.json 에 실려 있어야 한다(빠지면 iOS codegen·Gate 0 가 그 타입을 모른다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const script = readFileSync(`${repoRoot}scripts/export-openapi.ts`, 'utf8');
const schema = JSON.parse(readFileSync(`${repoRoot}packages/api-contracts/events/ws-chat.v1.schema.json`, 'utf8'));

function contractTypes() {
  const m = script.match(/const WS_CONTRACT_TYPES = \[([^\]]*)\]/);
  assert.ok(m, 'WS_CONTRACT_TYPES 선언을 찾지 못함');
  return [...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]);
}

test('every WS_CONTRACT_TYPES root type is defined in the committed WS schema', () => {
  const types = contractTypes();
  assert.ok(types.length >= 5, `too few contract types: ${types.join(', ')}`);
  for (const t of types) assert.ok(schema.definitions[t], `missing definition: ${t}`);
});

test('the WS schema carries the app-level ping request and pong server event', () => {
  assert.ok(contractTypes().includes('WsPingRequest'));
  assert.equal(schema.definitions.WsPingRequest.properties.type.const, 'ping');
  const events = schema.definitions.WsServerEvent.anyOf.map((e) => e.properties?.type?.const);
  assert.ok(events.includes('pong'), 'WsServerEvent has no pong');
});
