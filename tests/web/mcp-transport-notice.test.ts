/**
 * MCP-3 웹 — 백엔드 transportNotice 파싱과 안내 문장 조립(순수 함수).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTransportNotice, transportNoticeHint } from '../../apps/web/addons/mcp-runtime/transport-notice';
import { mapTemplate } from '../../apps/web/addons/mcp-runtime/pages/mcp-catalog-fields';

const t = (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(',')})` : key);

test('parseTransportNotice — 필드가 없거나 모르는 코드면 null (플래그 OFF 백엔드·다른 판)', () => {
  assert.equal(parseTransportNotice(undefined), null);
  assert.equal(parseTransportNotice({ code: 'future-code' }), null);
});

test('parseTransportNotice — 알려진 코드는 기본값을 채워 받는다', () => {
  assert.deepEqual(parseTransportNotice({ code: 'deprecated-transport' }), {
    code: 'deprecated-transport', replacementUrl: null, replacementVerified: false, sunsetDate: null, reauthRequired: false,
  });
});

test('transportNoticeHint — 종료일·대체 주소·재로그인을 순서대로 잇는다', () => {
  const n = parseTransportNotice({
    code: 'endpoint-moved', replacementUrl: 'https://mcp.atlassian.com/v2/mcp', replacementVerified: true,
    sunsetDate: '2027-03-01', reauthRequired: true,
  });
  assert.ok(n);
  assert.equal(transportNoticeHint(n, t), 'hint.endpoint-moved sunsetOn(2027-03-01) replacement(https://mcp.atlassian.com/v2/mcp) reauth');
});

test('transportNoticeHint — 확인되지 않은 후보 주소는 후보 문구로', () => {
  const n = parseTransportNotice({ code: 'deprecated-transport', replacementUrl: 'https://x.test/mcp' });
  assert.ok(n);
  assert.equal(transportNoticeHint(n, t), 'hint.deprecated-transport replacementCandidate(https://x.test/mcp)');
});

test('mapTemplate — 템플릿의 transportNotice 를 싣고, 없으면 null', () => {
  assert.equal(mapTemplate({ id: 'a', display_name: 'A', transport_type: 'streamable-http' }).transportNotice, null);
  assert.equal(mapTemplate({ id: 'b', display_name: 'B', transport_type: 'sse', transportNotice: { code: 'endpoint-sunset' } }).transportNotice?.code, 'endpoint-sunset');
});
