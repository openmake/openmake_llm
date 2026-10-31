/**
 * 웹 글꼴은 npm 패키지(fontsource)로 자체 호스팅한다 — 빌드가 Google Fonts 응답에 의존하면
 * 코드와 무관하게 CI 웹 빌드가 깨진다(2026-10-30·31 dev push `next/font/google queries have exactly one entry`).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const WEB = join(process.cwd(), 'apps/web');
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|css)$/.test(name) ? [path] : [];
  });
}

test('apps/web 소스는 next/font/google 을 쓰지 않는다(빌드 시 외부 다운로드 금지)', () => {
  const offenders = sourceFiles(WEB).filter((f) => readFileSync(f, 'utf8').includes('next/font/google'));
  assert.deepEqual(offenders, []);
});

test('layout 은 세 글꼴 패키지의 CSS 를 불러온다', () => {
  const layout = read('app/layout.tsx');
  for (const pkg of ['@fontsource-variable/noto-sans-kr', '@fontsource-variable/space-grotesk', '@fontsource/ibm-plex-mono/400.css', '@fontsource/ibm-plex-mono/500.css', '@fontsource/ibm-plex-mono/600.css']) {
    assert.ok(layout.includes(`import "${pkg}`), `${pkg} import 없음`);
  }
});

test('globals.css 가 글꼴 변수 3개를 패키지 글꼴 이름으로 정의한다', () => {
  const css = read('app/globals.css');
  assert.match(css, /--font-noto-kr:\s*"Noto Sans KR Variable"/);
  assert.match(css, /--font-space-grotesk:\s*"Space Grotesk Variable"/);
  assert.match(css, /--font-ibm-plex-mono:\s*"IBM Plex Mono"/);
});

test('세 글꼴 패키지는 apps/web 운영 의존성이다', () => {
  const deps = JSON.parse(read('package.json')).dependencies ?? {};
  for (const pkg of ['@fontsource-variable/noto-sans-kr', '@fontsource-variable/space-grotesk', '@fontsource/ibm-plex-mono']) {
    assert.ok(deps[pkg], `${pkg} 의존성 없음`);
  }
});
