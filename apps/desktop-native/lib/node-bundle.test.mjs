// lib/node-bundle.sh fixture: sources the library in bash (with build.sh's `set -euo pipefail`) and calls its
// functions with fake otool/curl/uname first on PATH — no network, no real otool, HOME inside a temporary root.
// Portable (Linux CI and macOS bash 3.2): the only real tools used are bash, tar, shasum and mktemp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const LIB = fileURLToPath(new URL('./node-bundle.sh', import.meta.url));
const VER = '24.0.0';
const NAME = `node-v${VER}-darwin-arm64`;

const FAKE_OTOOL = `#!/bin/sh
# Like otool -L: the file path line, then each FAKE_OTOOL_LIBS line indented.
printf '%s:\\n' "$2"
printf '%s\\n' "$FAKE_OTOOL_LIBS" | while IFS= read -r line; do [ -n "$line" ] && printf '\\t%s\\n' "$line"; done
exit 0
`;
const FAKE_CURL = `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
done
printf '%s\\n' "$url" >> "$CURL_LOG"
case "$url" in
  */SHASUMS256.txt) cp "$FAKE_SHASUMS" "$out" ;;
  *.tar.gz) cp "$FAKE_TARBALL" "$out" ;;
  *) exit 22 ;;
esac
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'omk-node-bundle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const [name, body] of [['otool', FAKE_OTOOL], ['curl', FAKE_CURL], ['uname', '#!/bin/sh\necho arm64\n']]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  // A stand-in official tarball (bin/node prints the version) and its good and bad SHASUMS256.txt.
  const dist = join(root, 'dist');
  mkdirSync(join(dist, NAME, 'bin'), { recursive: true });
  writeFileSync(join(dist, NAME, 'bin/node'), `#!/bin/sh\necho v${VER}\n`);
  chmodSync(join(dist, NAME, 'bin/node'), 0o755);
  const tar = spawnSync('tar', ['-czf', `${NAME}.tar.gz`, NAME], { cwd: dist, encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const tarball = join(dist, `${NAME}.tar.gz`);
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  writeFileSync(join(dist, 'SHASUMS256.txt'), `${'f'.repeat(64)}  node-v${VER}-linux-x64.tar.gz\n${digest}  ${NAME}.tar.gz\n`);
  writeFileSync(join(dist, 'SHASUMS256.bad.txt'), `${'0'.repeat(64)}  ${NAME}.tar.gz\n`);
  const home = join(root, 'home');
  const curlLog = join(root, 'curl.log');
  writeFileSync(curlLog, '');
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, CURL_LOG: curlLog, FAKE_TARBALL: tarball, FAKE_SHASUMS: join(dist, 'SHASUMS256.txt') };
  const call = (fn, args, extraEnv = {}) => spawnSync('bash', ['-c', 'set -euo pipefail; . "$1"; shift; "$@"', 'bash', LIB, fn, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
  return { root, dist, home, curlLog, call, cache: join(home, `Library/Caches/openmake-companion-node/v${VER}-arm64`) };
}

const curlCalls = log => readFileSync(log, 'utf8').split('\n').filter(Boolean);

test('node_is_self_contained: only /usr/lib/ and /System/ libraries is self-contained', t => {
  const { call } = fixture(t);
  const libs = ['/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)',
    '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0)',
    '/usr/lib/libc++.1.dylib (compatibility version 1.0.0)'].join('\n');
  assert.equal(call('node_is_self_contained', ['/x/node'], { FAKE_OTOOL_LIBS: libs }).status, 0);
});

test('node_is_self_contained: a Homebrew (/opt/homebrew/...) dependency is not self-contained', t => {
  const { call } = fixture(t);
  for (const libs of [
    '/opt/homebrew/opt/node/lib/libnode.141.dylib (compatibility version 0.0.0)\n/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)',
    '/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n/opt/homebrew/opt/libuv/lib/libuv.1.dylib (compatibility version 2.0.0)',
  ]) assert.notEqual(call('node_is_self_contained', ['/x/node'], { FAKE_OTOOL_LIBS: libs }).status, 0, libs);
});

test('fetch_official_node: an existing cached node is used without downloading', t => {
  const { call, cache, curlLog } = fixture(t);
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'node'), '#!/bin/sh\necho cached\n');
  chmodSync(join(cache, 'node'), 0o755);
  const result = call('fetch_official_node', [VER]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(cache, 'node'));
  assert.deepEqual(curlCalls(curlLog), []);
});

test('fetch_official_node: a sha256 mismatch fails and leaves no cached node', t => {
  const { call, cache, dist } = fixture(t);
  const result = call('fetch_official_node', [VER], { FAKE_SHASUMS: join(dist, 'SHASUMS256.bad.txt') });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`sha256 검증 실패: ${NAME}\\.tar\\.gz`));
  assert.equal(existsSync(join(cache, 'node')), false);
});

test('fetch_official_node: downloads the official tarball, verifies it and caches bin/node', t => {
  const { call, cache, curlLog } = fixture(t);
  const result = call('fetch_official_node', [VER]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(cache, 'node'));
  assert.deepEqual(curlCalls(curlLog), [`https://nodejs.org/dist/v${VER}/${NAME}.tar.gz`, `https://nodejs.org/dist/v${VER}/SHASUMS256.txt`]);
  assert.ok(statSync(join(cache, 'node')).mode & 0o111, 'cached node is executable');
  assert.equal(spawnSync(join(cache, 'node'), [], { encoding: 'utf8' }).stdout.trim(), `v${VER}`);
  // A second call uses the cache.
  writeFileSync(curlLog, '');
  assert.equal(call('fetch_official_node', [VER]).stdout.trim(), join(cache, 'node'));
  assert.deepEqual(curlCalls(curlLog), []);
});
