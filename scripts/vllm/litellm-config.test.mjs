// LiteLLM 게이트웨이 설정(scripts/vllm/litellm.config.yaml)은 omk 가 서버로 그대로 복사하는 배포 파일이다 —
// 파싱 실패·중복 모델명·평문 키·임의 http 주소가 저장소에서 걸리도록 실제 파일을 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// 루트에는 직접 선언된 YAML 파서가 없다 — apps/api 가 선언한 js-yaml 을 쓴다(dev-checks.mjs 의 pg 와 같은 방식).
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const yaml = require('js-yaml');
const CONFIG = new URL('./litellm.config.yaml', import.meta.url);
const ENV_REF = /^os\.environ\/[A-Z][A-Z0-9_]*$/;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/;

const load = () => yaml.load(readFileSync(CONFIG, 'utf8'));
const models = () => load().model_list;

test('litellm.config.yaml 이 파싱되고 model_list 는 비어 있지 않은 배열이다', () => {
  const config = load();
  assert.equal(typeof config, 'object');
  assert.ok(Array.isArray(config.model_list), 'model_list 가 배열이 아니다');
  assert.ok(config.model_list.length > 0, 'model_list 가 비어 있다');
});

test('각 항목에 model_name(중복 없음)·litellm_params.model 문자열이 있다', () => {
  const seen = new Set();
  for (const [index, entry] of models().entries()) {
    assert.equal(typeof entry?.model_name, 'string', `model_list[${index}].model_name`);
    assert.ok(entry.model_name.length > 0, `model_list[${index}].model_name 이 비어 있다`);
    assert.ok(!seen.has(entry.model_name), `model_name 중복: ${entry.model_name}`);
    seen.add(entry.model_name);
    assert.equal(typeof entry.litellm_params?.model, 'string', `${entry.model_name}: litellm_params.model`);
    assert.ok(entry.litellm_params.model.length > 0, `${entry.model_name}: litellm_params.model 이 비어 있다`);
  }
});

test('api_base 는 https://·os.environ/·루프백 http 만 허용한다', () => {
  for (const { model_name: name, litellm_params: params } of models()) {
    if (params.api_base === undefined) continue;
    const base = params.api_base;
    assert.equal(typeof base, 'string', `${name}: api_base`);
    assert.ok(base.startsWith('https://') || ENV_REF.test(base) || LOOPBACK.test(base), `${name}: 허용되지 않은 api_base ${base}`);
  }
});

test('api_key 는 os.environ/ 참조만 허용한다(평문 키 금지)', () => {
  for (const { model_name: name, litellm_params: params } of models()) {
    if (params.api_key === undefined) continue;
    assert.match(String(params.api_key), ENV_REF, `${name}: api_key 는 os.environ/<NAME> 이어야 한다`);
  }
});

test('검사 규칙은 위반을 실제로 잡는다', () => {
  assert.ok(ENV_REF.test('os.environ/VLLM_API_KEY'));
  assert.ok(!ENV_REF.test('sk-live-123'));
  assert.ok(!ENV_REF.test('os.environ/'));
  assert.ok(LOOPBACK.test('http://127.0.0.1:13401/v1'));
  assert.ok(LOOPBACK.test('http://localhost'));
  assert.ok(!LOOPBACK.test('http://localhost.evil.example/v1'));
  assert.ok(!LOOPBACK.test('http://10.0.0.5:8002/v1'));
});
