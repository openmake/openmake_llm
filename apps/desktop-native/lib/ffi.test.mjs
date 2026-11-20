// lib/ffi.sh fixture (PR-3.2 T-B1): sources the library in bash (with build.sh's `set -euo pipefail`) and calls
// ffi_generate with fake cargo/xcodebuild first on PATH — no Rust build, no Xcode. Checks the call order, the
// native-static-libs ↔ Package.swift linkerSettings check, and that Generated/ is replaced only when every step succeeds.
// Portable (Linux CI and macOS bash 3.2): the only real tools used are bash, sed, grep, mktemp, cp and mv.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIB = fileURLToPath(new URL('./ffi.sh', import.meta.url));

// cargo: logs its subcommand, fails the step named in FAKE_FAIL, writes the static lib and prints native-static-libs
// for `rustc`, and writes the generated files into the last argument for `run` (bindgen).
const FAKE_CARGO = `#!/bin/sh
sub="$1"
case "$sub" in
  run) for a in "$@"; do case "$a" in --swift-sources) step=swift ;; --headers) step=headers ;; esac; done ;;
  *) step="$sub" ;;
esac
printf '%s\\n' "$step" >> "$STEP_LOG"
[ "$FAKE_FAIL" = "$step" ] && { echo "fake $step failed" >&2; exit 1; }
case "$step" in
  rustc)
    mkdir -p "$CARGO_TARGET_DIR/release"
    echo lib > "$CARGO_TARGET_DIR/release/libomk_ffi.a"
    printf '%s\\n' "$MACOSX_DEPLOYMENT_TARGET" > "$DEPLOY_LOG"
    echo "   Compiling omk-ffi" >&2
    echo "note: native-static-libs: $FAKE_NSL" >&2 ;;
  swift) for out; do :; done; mkdir -p "$out"; echo "// swift" > "$out/omk_ffi.swift" ;;
  headers) for out; do :; done; mkdir -p "$out"; echo "// h" > "$out/omk_ffiFFI.h"; echo "module omk_ffiFFI {}" > "$out/module.modulemap" ;;
esac
exit 0
`;
const FAKE_XCODEBUILD = `#!/bin/sh
printf 'xcodebuild\\n' >> "$STEP_LOG"
[ "$FAKE_FAIL" = xcodebuild ] && exit 1
while [ $# -gt 0 ]; do [ "$1" = -output ] && out="$2"; shift; done
mkdir -p "$out" && echo new > "$out/Info.plist"
`;

const PACKAGE = `.target(name: "OmkFfi", dependencies: ["OmkFfiCore"], path: "Generated/OmkFfi",
        linkerSettings: [.linkedFramework("Security"), .linkedFramework("CoreFoundation"), .linkedLibrary("iconv")]),`;
const NSL = '-framework Security -framework CoreFoundation -liconv -lSystem -lc -lm';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'omk-ffi-sh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const [name, body] of [['cargo', FAKE_CARGO], ['xcodebuild', FAKE_XCODEBUILD]]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const rust = join(root, 'rust');
  mkdirSync(rust);
  const pkg = join(root, 'Package.swift');
  writeFileSync(pkg, PACKAGE);
  // The previous Generated/ — must survive any failure.
  const out = join(root, 'Generated');
  mkdirSync(join(out, 'OmkFfi'), { recursive: true });
  writeFileSync(join(out, 'OmkFfi/omk_ffi.swift'), '// old');
  const stepLog = join(root, 'steps.log');
  const deployLog = join(root, 'deploy.log');
  const env = { PATH: `${bin}:${process.env.PATH}`, STEP_LOG: stepLog, DEPLOY_LOG: deployLog, CARGO_TARGET_DIR: join(root, 'target'), FAKE_NSL: NSL };
  const call = (extraEnv = {}) => {
    writeFileSync(stepLog, '');
    return spawnSync('bash', ['-c', 'set -euo pipefail; . "$1"; shift; ffi_generate "$@"', 'bash', LIB, rust, out, pkg], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
  };
  const steps = () => readFileSync(stepLog, 'utf8').split('\n').filter(Boolean);
  const generated = () => readFileSync(join(out, 'OmkFfi/omk_ffi.swift'), 'utf8').trim();
  return { root, out, pkg, call, steps, generated, deployLog };
}

test('ffi_generate: clean → rustc → bindgen swift → bindgen headers → xcodebuild, then Generated/ is replaced', t => {
  const f = fixture(t);
  const r = f.call();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.steps(), ['clean', 'rustc', 'swift', 'headers', 'xcodebuild']);
  assert.equal(f.generated(), '// swift');
  assert.ok(existsSync(join(f.out, 'OmkFfiCore.xcframework/Info.plist')));
  assert.equal(readFileSync(f.deployLog, 'utf8').trim(), '14.0');
  assert.deepEqual(spawnSync('ls', [f.root], { encoding: 'utf8' }).stdout.split('\n').filter(n => n.startsWith('Generated')), ['Generated']);
});

for (const step of ['clean', 'rustc', 'swift', 'headers', 'xcodebuild']) {
  test(`ffi_generate: a failing ${step} step fails and leaves Generated/ as it was`, t => {
    const f = fixture(t);
    const r = f.call({ FAKE_FAIL: step });
    assert.notEqual(r.status, 0);
    assert.equal(f.generated(), '// old');
    assert.ok(!existsSync(join(f.out, 'OmkFfiCore.xcframework')));
    assert.deepEqual(spawnSync('ls', [f.root], { encoding: 'utf8' }).stdout.split('\n').filter(n => n.startsWith('Generated')), ['Generated']);
  });
}

test('ffi_generate: a framework or library missing from linkerSettings fails before bindgen', t => {
  for (const [nsl, missing] of [
    [`${NSL} -framework SystemConfiguration`, '.linkedFramework("SystemConfiguration")'],
    [`${NSL} -lresolv`, '.linkedLibrary("resolv")'],
  ]) {
    const f = fixture(t);
    const r = f.call({ FAKE_NSL: nsl });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(missing.replace(/[.()]/g, '\\$&')));
    assert.deepEqual(f.steps(), ['clean', 'rustc']);
    assert.equal(f.generated(), '// old');
  }
});

test('ffi_generate: the default System/c/m libraries need no linkerSettings', t => {
  const f = fixture(t);
  writeFileSync(f.pkg, '.linkedFramework("Security") .linkedFramework("CoreFoundation") .linkedLibrary("iconv")');
  const r = f.call({ FAKE_NSL: '-framework Security -framework CoreFoundation -liconv -lSystem -lc -lm' });
  assert.equal(r.status, 0, r.stderr);
});

test('ffi_generate: no native-static-libs line fails', t => {
  const f = fixture(t);
  const r = f.call({ FAKE_NSL: '' });
  assert.notEqual(r.status, 0);
  assert.equal(f.generated(), '// old');
});
