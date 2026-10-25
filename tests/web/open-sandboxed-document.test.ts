/**
 * 작업 산출물(HTML/SVG) "새 탭 열기" — 앱 origin 을 물려받는 blob: URL 대신
 * sandbox iframe 하나만 담은 셸 문서로 연다. allow-same-origin 은 절대 주지 않는다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSandboxShellHtml } from '../../apps/web/lib/open-sandboxed-document';

test('buildSandboxShellHtml: sandbox 는 allow-scripts allow-popups 만, allow-same-origin 없음', () => {
  const html = buildSandboxShellHtml('<script>x</script>', 'text/html', 't');
  assert.ok(html.includes('sandbox="allow-scripts allow-popups"'));
  assert.ok(!html.includes('allow-same-origin'));
});

test('buildSandboxShellHtml: srcdoc 은 HTML 속성 이스케이프', () => {
  const html = buildSandboxShellHtml('<script>x</script>', 'text/html', 't');
  assert.ok(html.includes('srcdoc="&lt;script&gt;'));
  // 본문이 셸 문서에 날것으로 들어가면 안 된다
  assert.ok(!html.includes('<script>x</script>'));
});

test('buildSandboxShellHtml: 따옴표·& 이스케이프로 srcdoc 속성 탈출 불가', () => {
  const html = buildSandboxShellHtml('"><script>alert(1)</script>&amp;\'', 'text/html', 't');
  assert.ok(html.includes('srcdoc="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;amp;&#39;"'));
  assert.equal((html.match(/<iframe\b/g) ?? []).length, 1);
  assert.equal((html.match(/<script\b/g) ?? []).length, 0);
});

test('buildSandboxShellHtml: 제목도 이스케이프', () => {
  const html = buildSandboxShellHtml('<p>a</p>', 'image/svg+xml', '</title><script>x</script>');
  assert.ok(html.includes('<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>'));
  assert.equal((html.match(/<script\b/g) ?? []).length, 0);
});
