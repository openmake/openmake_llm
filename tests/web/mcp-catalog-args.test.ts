import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInstallPayload,
  hasMissingRequired,
  mapTemplate,
  type ApiCatalogTemplate,
} from '../../apps/web/addons/mcp-runtime/pages/mcp-catalog-fields';

// connectors-pack/mcp-catalog.json 의 mcp-filesystem 과 같은 모양(argsSchema required root_path)
const filesystem: ApiCatalogTemplate = {
  id: 'mcp-filesystem',
  display_name: 'Filesystem (sandbox)',
  transport_type: 'stdio',
  args_schema: {
    type: 'object',
    required: ['root_path'],
    properties: { root_path: { type: 'string', title: '루트 디렉토리', description: '사용자 sandbox 안의 상대경로' } },
  },
  env_schema: {},
};

test('args_schema 의 required 항목이 필수 argField 로 만들어진다', () => {
  const e = mapTemplate(filesystem);
  assert.equal(e.argFields.length, 1);
  assert.deepEqual(e.argFields[0], {
    key: 'root_path',
    title: '루트 디렉토리',
    description: '사용자 sandbox 안의 상대경로',
    secret: false,
    required: true,
    kind: 'arg',
    type: 'string',
  });
  assert.equal(e.envFields.length, 0);
});

test('argFields 는 필수 먼저, 선택이 뒤', () => {
  const e = mapTemplate({
    ...filesystem,
    args_schema: { required: ['b'], properties: { a: { type: 'number' }, b: { type: 'string' } } },
  });
  assert.deepEqual(e.argFields.map((f) => [f.key, f.required]), [['b', true], ['a', false]]);
});

test('env_schema 필드는 kind env 로 기존처럼 만들어진다', () => {
  const e = mapTemplate({
    ...filesystem,
    args_schema: {},
    env_schema: { required: ['TOKEN'], properties: { TOKEN: { title: '토큰', secret: true }, BASE: {} } },
  });
  assert.deepEqual(e.argFields, []);
  assert.deepEqual(e.envFields.map((f) => [f.key, f.required, f.secret, f.kind]), [
    ['TOKEN', true, true, 'env'],
    ['BASE', false, false, 'env'],
  ]);
});

test('payload 에 채운 arg 가 args 로 실린다', () => {
  const e = mapTemplate(filesystem);
  assert.deepEqual(buildInstallPayload(e, { root_path: 'x' }, {}, 'fs'), {
    template_id: 'mcp-filesystem',
    name: 'fs',
    args: { root_path: 'x' },
  });
});

test('빈 칸 arg·env 는 보내지 않는다', () => {
  const e = mapTemplate({
    ...filesystem,
    args_schema: { properties: { root_path: { type: 'string' }, depth: { type: 'number' } } },
    env_schema: { properties: { BASE: {} } },
  });
  assert.deepEqual(buildInstallPayload(e, { root_path: '  ', depth: '' }, { BASE: ' ' }, 'fs'), {
    template_id: 'mcp-filesystem',
    name: 'fs',
  });
});

test('number·boolean arg 는 타입을 바꿔 보낸다', () => {
  const e = mapTemplate({
    ...filesystem,
    args_schema: { properties: { depth: { type: 'number' }, count: { type: 'integer' }, ro: { type: 'boolean' }, off: { type: 'boolean' } } },
  });
  const p = buildInstallPayload(e, { depth: '3', count: '10', ro: 'true', off: 'false' }, {}, 'fs');
  assert.deepEqual(p.args, { depth: 3, count: 10, ro: true, off: false });
});

test('필수 arg 가 비면 설치가 잠긴다', () => {
  const e = mapTemplate(filesystem);
  assert.equal(hasMissingRequired(e.argFields, {}), true);
  assert.equal(hasMissingRequired(e.argFields, { root_path: ' ' }), true);
  assert.equal(hasMissingRequired(e.argFields, { root_path: 'docs' }), false);
});
