// 게시 스크립트 두 개(scripts/publish-desktop.sh·publish-desktop-windows.sh) — 자기 블록만 바꾸고 다른 블록은 남긴다.
// 임시 DESKTOP_UPDATE_DIR 에 실제 스크립트를 돈다(bash·node·shasum 만 쓴다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAC_SCRIPT = path.join(ROOT, 'scripts/publish-desktop.sh');
const WIN_SCRIPT = path.join(ROOT, 'scripts/publish-desktop-windows.sh');

const NATIVE = { version: '0.4.3', file: 'OpenMake-Companion-0.4.3-arm64.dmg', sha256: 'a'.repeat(64) };
const MACOS = { version: '0.5.0', file: 'OpenMake-Code-0.5.0-arm64.dmg', sha256: 'b'.repeat(64) };
const WINDOWS = { version: '0.1.0', file: 'OpenMake-Companion-Setup-0.1.0.exe', sha256: 'c'.repeat(64) };
const FUTURE = { anything: 'kept' };

function setup(t) {
    const root = mkdtempSync(path.join(tmpdir(), 'publish-desktop-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'updates'), latest = path.join(dir, 'latest.json');
    /** 게시할 파일을 만든다 → { path, sha256 } */
    const artifact = (name, body = `bytes of ${name}`) => {
        const file = path.join(root, name);
        writeFileSync(file, body);
        return { path: file, sha256: createHash('sha256').update(body).digest('hex') };
    };
    const run = (script, file) => spawnSync('bash', [script, file], { env: { ...process.env, DESKTOP_UPDATE_DIR: dir }, encoding: 'utf8' });
    const setManifest = (value) => {
        spawnSync('mkdir', ['-p', dir]);
        writeFileSync(latest, typeof value === 'string' ? value : JSON.stringify(value));
    };
    const manifest = () => JSON.parse(readFileSync(latest, 'utf8'));
    return { dir, latest, artifact, run, setManifest, manifest };
}

test('Companion dmg → native 만 바뀌고 macos·windows·모르는 객체 블록이 그대로다', (t) => {
    const s = setup(t);
    s.setManifest({ native: NATIVE, macos: MACOS, windows: WINDOWS, future: FUTURE });
    const dmg = s.artifact('OpenMake-Companion-0.4.4-arm64.dmg');
    const r = s.run(MAC_SCRIPT, dmg.path);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /게시됨\(native\)/);
    assert.deepEqual(s.manifest(), {
        native: { version: '0.4.4', file: 'OpenMake-Companion-0.4.4-arm64.dmg', sha256: dmg.sha256 },
        macos: MACOS, windows: WINDOWS, future: FUTURE,
    });
    assert.ok(existsSync(path.join(s.dir, 'OpenMake-Companion-0.4.4-arm64.dmg')));
});

test('OpenMake Code dmg → macos 만 바뀌고 native·windows 가 그대로다 — 버전은 파일명, sha256 은 내용', (t) => {
    const s = setup(t);
    s.setManifest({ native: NATIVE, windows: WINDOWS });
    const dmg = s.artifact('OpenMake-Code-0.5.1-arm64.dmg');
    const r = s.run(MAC_SCRIPT, dmg.path);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /게시됨\(macos\)/);
    assert.deepEqual(s.manifest(), {
        native: NATIVE, windows: WINDOWS,
        macos: { version: '0.5.1', file: 'OpenMake-Code-0.5.1-arm64.dmg', sha256: dmg.sha256 },
    });
});

test('Windows 설치 파일 → windows 만 바뀌고 native·macos·모르는 객체 블록이 그대로다', (t) => {
    const s = setup(t);
    s.setManifest({ native: NATIVE, macos: MACOS, windows: WINDOWS, future: FUTURE });
    const exe = s.artifact('OpenMake-Companion-Setup-0.1.1.exe');
    const r = s.run(WIN_SCRIPT, exe.path);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(s.manifest(), {
        native: NATIVE, macos: MACOS, future: FUTURE,
        windows: { version: '0.1.1', file: 'OpenMake-Companion-Setup-0.1.1.exe', sha256: exe.sha256 },
    });
});

test('구 Electron 최상위 필드(객체가 아닌 값)는 두 스크립트 모두 게시 뒤 사라진다', (t) => {
    const s = setup(t);
    const electron = { version: '1.10.0', file: 'OpenMake-1.10.0-arm64.dmg', sha256: 'e'.repeat(64) };
    s.setManifest({ ...electron, native: NATIVE, macos: MACOS });
    assert.equal(s.run(MAC_SCRIPT, s.artifact('OpenMake-Code-0.5.1-arm64.dmg').path).status, 0);
    assert.deepEqual(Object.keys(s.manifest()).sort(), ['macos', 'native']);
    s.setManifest({ ...electron, native: NATIVE });
    assert.equal(s.run(WIN_SCRIPT, s.artifact('OpenMake-Companion-Setup-0.1.1.exe').path).status, 0);
    assert.deepEqual(Object.keys(s.manifest()).sort(), ['native', 'windows']);
});

test('접두가 다른 dmg 는 종료 코드 1, latest.json 바이트 그대로', (t) => {
    const s = setup(t);
    const before = JSON.stringify({ native: NATIVE, macos: MACOS }) + '\n';
    s.setManifest(before);
    for (const name of ['OpenMake-1.10.0-arm64.dmg', 'OpenMake-Codex-0.5.0-arm64.dmg', 'Other-0.5.0-arm64.dmg']) {
        const r = s.run(MAC_SCRIPT, s.artifact(name).path);
        assert.equal(r.status, 1, name);
        assert.equal(readFileSync(s.latest, 'utf8'), before, name);
        assert.ok(!existsSync(path.join(s.dir, name)), name);
    }
});

test('매니페스트가 없던 폴더의 첫 게시 — 세 경로 각각 자기 블록 하나만 쓴다', (t) => {
    const cases = [
        [MAC_SCRIPT, 'OpenMake-Companion-0.4.4-arm64.dmg', 'native', '0.4.4'],
        [MAC_SCRIPT, 'OpenMake-Code-0.5.0-arm64.dmg', 'macos', '0.5.0'],
        [WIN_SCRIPT, 'OpenMake-Companion-Setup-0.1.0.exe', 'windows', '0.1.0'],
    ];
    for (const [script, name, block, version] of cases) {
        const s = setup(t);
        const file = s.artifact(name);
        const r = s.run(script, file.path);
        assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
        assert.deepEqual(s.manifest(), { [block]: { version, file: name, sha256: file.sha256 } }, name);
    }
});

// plan-pr2.5 D-163: 인자 없는 기본값은 dist 의 OpenMake-Code-*.dmg 중 최신 — 옛 정체성 dmg 가 더 새것이어도 고르지 않는다.
test('인자 없이 돌면 dist 의 OpenMake-Code-*.dmg 중 최신을 macos 로 게시한다', (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'publish-desktop-default-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dist = path.join(root, 'apps/desktop-native/dist'), dir = path.join(root, 'updates');
    spawnSync('mkdir', ['-p', dist, path.join(root, 'scripts')]);
    writeFileSync(path.join(root, 'scripts/publish-desktop.sh'), readFileSync(MAC_SCRIPT));
    const put = (name, mtime) => {
        writeFileSync(path.join(dist, name), `bytes of ${name}`);
        spawnSync('touch', ['-t', mtime, path.join(dist, name)]);
    };
    put('OpenMake-Code-0.5.0-arm64.dmg', '202601010000');
    put('OpenMake-Code-0.5.1-arm64.dmg', '202601020000');
    put('OpenMake-Companion-0.4.9-arm64.dmg', '202601030000');
    const r = spawnSync('bash', [path.join(root, 'scripts/publish-desktop.sh')], { env: { ...process.env, DESKTOP_UPDATE_DIR: dir }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const manifest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest), ['macos']);
    assert.equal(manifest.macos.file, 'OpenMake-Code-0.5.1-arm64.dmg');
});
