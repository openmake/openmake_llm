// compose 가 publish 하는 포트는 기본적으로 loopback(127.0.0.1)에만 바인딩한다.
// 외부 노출이 필요하면 운영자가 <NAME>_BIND=0.0.0.0 을 명시한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COMPOSE_FILES = ['infra/docker-compose.yml', 'infra/artifact-viewer/docker-compose.yml'];

function publishedPorts(text) {
  const lines = text.split('\n');
  const ports = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)ports:\s*$/);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j].match(/^(\s*)- (.+)$/);
      if (!item || item[1].length <= m[1].length) break;
      ports.push(item[2].trim());
    }
  }
  return ports;
}

test('compose ports bind to loopback by default', () => {
  for (const f of COMPOSE_FILES) {
    const ports = publishedPorts(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    assert.ok(ports.length > 0, `${f}: ports 항목이 없다`);
    for (const p of ports) {
      assert.match(p, /^"\$\{[A-Z_]+_BIND:-127\.0\.0\.1\}:/, `${f}: ${p}`);
    }
  }
});
