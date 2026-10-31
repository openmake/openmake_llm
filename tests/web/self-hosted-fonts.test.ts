/**
 * 웹 글꼴은 npm 패키지(fontsource)로 자체 호스팅한다 — 빌드가 Google Fonts 응답에 의존하면
 * 코드와 무관하게 CI 웹 빌드가 깨진다(2026-10-30·31 dev push `next/font/google queries have exactly one entry`).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd(); // run-tests.mjs 가 저장소 루트를 cwd 로 준다
const WEB = join(ROOT, 'apps/web');
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');
const familyOf = (pkgCss: string) => {
  const m = readFileSync(join(ROOT, 'node_modules', pkgCss), 'utf8').match(/font-family:\s*'([^']+)'/);
  assert.ok(m, `${pkgCss} 에 font-family 없음`);
  return m[1];
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|css)$/.test(name) ? [path] : [];
  });
}

test('apps/web 소스는 Google Fonts 를 쓰지 않는다(빌드·화면의 외부 다운로드 금지)', () => {
  const banned = ['next/font/google', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  const offenders = sourceFiles(WEB).filter((f) => {
    const src = readFileSync(f, 'utf8');
    return banned.some((b) => src.includes(b));
  });
  assert.deepEqual(offenders, []);
});

test('layout 은 세 글꼴 패키지의 CSS 를 불러온다', () => {
  const layout = read('app/layout.tsx');
  for (const pkg of ['@fontsource-variable/noto-sans-kr', '@fontsource-variable/space-grotesk', '@fontsource/ibm-plex-mono/400.css', '@fontsource/ibm-plex-mono/500.css', '@fontsource/ibm-plex-mono/600.css']) {
    assert.ok(layout.includes(`import "${pkg}`), `${pkg} import 없음`);
  }
});

test('globals.css 의 글꼴 변수 3개는 설치된 패키지 CSS 의 font-family 와 같다', () => {
  const css = read('app/globals.css');
  const expected: Record<string, string> = {
    '--font-noto-kr': familyOf('@fontsource-variable/noto-sans-kr/index.css'),
    '--font-space-grotesk': familyOf('@fontsource-variable/space-grotesk/index.css'),
    '--font-ibm-plex-mono': familyOf('@fontsource/ibm-plex-mono/400.css'),
  };
  for (const [name, family] of Object.entries(expected)) {
    assert.ok(css.includes(`${name}: "${family}";`), `${name} 가 "${family}" 가 아님`);
  }
});

test('세 글꼴 패키지는 apps/web 운영 의존성이다', () => {
  const deps = JSON.parse(read('package.json')).dependencies ?? {};
  for (const pkg of ['@fontsource-variable/noto-sans-kr', '@fontsource-variable/space-grotesk', '@fontsource/ibm-plex-mono']) {
    assert.ok(deps[pkg], `${pkg} 의존성 없음`);
  }
});
