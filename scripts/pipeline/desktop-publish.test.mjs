import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, compareVersions, decide, parseReleaseManifest, publish } from './desktop-publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/pipeline/desktop-publish.mjs');

test('compareVersions: 점으로 나눈 수 비교, 모자란 자리는 0', () => {
    assert.equal(compareVersions('0.3.8', '0.3.8'), 0);
    assert.equal(compareVersions('0.3.9', '0.3.8'), 1);
    assert.equal(compareVersions('0.3.7', '0.3.8'), -1);
    assert.equal(compareVersions('0.4', '0.4.0'), 0);
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('1', '0.99.99'), 1);
});

test('decide: 같음 → unchanged, 게시본이 높음 → ahead, 저장소가 높거나 게시본 없음 → publish', () => {
    assert.equal(decide({ repoVersion: '0.3.8', publishedVersion: '0.3.8' }), 'unchanged');
    assert.equal(decide({ repoVersion: '0.4', publishedVersion: '0.4.0' }), 'unchanged');
    assert.equal(decide({ repoVersion: '0.3.7', publishedVersion: '0.3.8' }), 'ahead');
    assert.equal(decide({ repoVersion: '0.3.8', publishedVersion: '0.3.7' }), 'publish');
    assert.equal(decide({ repoVersion: '0.3.8', publishedVersion: undefined }), 'publish');
});

const GOOD = { schemaVersion: 1, version: '0.3.8', file: 'OpenMake-Companion-0.3.8-arm64.dmg', sha256: 'a'.repeat(64), gitSha: 'b'.repeat(40) };
const text = (patch) => JSON.stringify({ ...GOOD, ...patch });

test('parseReleaseManifest: 정상 자산 매니페스트를 그대로 돌려준다', () => {
    assert.deepEqual(parseReleaseManifest(text({}), '0.3.8'), GOOD);
});

test('parseReleaseManifest: 형식·버전이 어긋나면 throw', () => {
    const bad = [
        ['schemaVersion', { schemaVersion: 2 }],
        ['version 불일치', { version: '0.3.9', file: 'OpenMake-Companion-0.3.9-arm64.dmg' }],
        ['version 형식', { version: '0.3.8-rc1' }],
        ['file 에 /', { file: 'x/OpenMake-Companion-0.3.8-arm64.dmg' }],
        ['file 에 ..', { file: '../OpenMake-Companion-0.3.8-arm64.dmg' }],
        ['file 의 버전 불일치', { file: 'OpenMake-Companion-0.3.9-arm64.dmg' }],
        ['file 확장자', { file: 'OpenMake-Companion-0.3.8-arm64.zip' }],
        ['sha256 길이', { sha256: 'a'.repeat(63) }],
        ['sha256 문자', { sha256: 'g'.repeat(64) }],
        ['sha256 대문자', { sha256: 'A'.repeat(64) }],
        ['gitSha 길이', { gitSha: 'b'.repeat(39) }],
        ['gitSha 문자', { gitSha: 'z'.repeat(40) }],
    ];
    for (const [name, patch] of bad) assert.throws(() => parseReleaseManifest(text(patch), '0.3.8'), undefined, name);
    assert.throws(() => parseReleaseManifest('not json', '0.3.8'));
    assert.throws(() => parseReleaseManifest('null', '0.3.8'));
});

test('buildManifest: 파일명에서 버전, 내용에서 sha256 을 만든다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'desktop-manifest-'));
    try {
        const dmg = path.join(dir, 'OpenMake-Companion-0.3.8-arm64.dmg');
        writeFileSync(dmg, 'dmg bytes');
        const sha = 'c'.repeat(40);
        assert.deepEqual(await buildManifest({ dmgPath: dmg, sha }), {
            schemaVersion: 1, version: '0.3.8', file: 'OpenMake-Companion-0.3.8-arm64.dmg',
            sha256: createHash('sha256').update('dmg bytes').digest('hex'), gitSha: sha,
        });
        for (const name of ['OpenMake-Companion-0.3.8.dmg', 'Other-0.3.8-arm64.dmg', 'OpenMake-Companion-v0.3.8-arm64.dmg']) {
            writeFileSync(path.join(dir, name), 'x');
            await assert.rejects(buildManifest({ dmgPath: path.join(dir, name), sha }), undefined, name);
        }
        await assert.rejects(buildManifest({ dmgPath: dmg, sha: 'short' }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── publish 통합: 임시 git 저장소(실제 scripts/publish-desktop.sh 사본) + 릴리스 자산을 흉내 내는 HTTP 서버 ──
const FILE = 'OpenMake-Companion-0.3.8-arm64.dmg';
const DMG = Buffer.from('fake dmg 0.3.8');
const DMG_SHA = createHash('sha256').update(DMG).digest('hex');
const PREVIOUS = JSON.stringify({ native: { version: '0.3.7', file: 'OpenMake-Companion-0.3.7-arm64.dmg', sha256: 'e'.repeat(64) }, windows: { version: '0.1.0', file: 'OpenMake-Companion-Setup-0.1.0.exe', sha256: 'f'.repeat(64) } }) + '\n';

async function fixture(t) {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-publish-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const llm = path.join(root, 'llm');
    const git = (...args) => execFileSync('git', ['-C', llm, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).trim();
    mkdirSync(path.join(llm, 'apps/desktop-native'), { recursive: true });
    mkdirSync(path.join(llm, 'scripts'));
    copyFileSync(path.join(ROOT, 'scripts/publish-desktop.sh'), path.join(llm, 'scripts/publish-desktop.sh'));
    writeFileSync(path.join(llm, 'apps/desktop-native/VERSION'), '0.3.8\n');
    git('init', '-q', '-b', 'main');
    git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'build'); const built = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'installed'); const installed = git('rev-parse', 'HEAD');
    git('switch', '-q', '-c', 'side', base); git('commit', '-q', '--allow-empty', '-m', 'side'); const side = git('rev-parse', 'HEAD');
    git('switch', '-q', 'main');

    const routes = new Map(), requests = [];
    const asset = (name) => `/acme/app/releases/download/desktop-native-v0.3.8/${name}`;
    const server = createServer((req, res) => {
        requests.push(req.url);
        const route = routes.get(req.url);
        if (!route) { res.writeHead(404).end('Not Found'); return; }
        res.writeHead(route.status ?? 200, route.headers ?? {}).end(route.body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const web = `http://127.0.0.1:${server.address().port}`;
    // 실제 GitHub 처럼 자산 주소는 다른 곳으로 리다이렉트된다.
    const serve = (manifest = {}) => {
        routes.set(asset('desktop-native.json'), { status: 302, headers: { location: '/objects/manifest' } });
        routes.set('/objects/manifest', { body: JSON.stringify({ schemaVersion: 1, version: '0.3.8', file: FILE, sha256: DMG_SHA, gitSha: built, ...manifest }) });
        routes.set(asset(FILE), { status: 302, headers: { location: '/objects/dmg' } });
        routes.set('/objects/dmg', { body: DMG });
    };
    const dir = path.join(llm, 'data/desktop-updates'), latest = path.join(dir, 'latest.json');
    const receiptPath = path.join(root, 'env/.pipeline/desktop-publish.json');
    const setPublished = (text) => { mkdirSync(dir, { recursive: true }); writeFileSync(latest, text); };
    const run = (deps, extra = {}) => publish({ cwd: llm, sha: installed, dir: 'data/desktop-updates', repo: 'acme/app', output: receiptPath, web, ...extra }, deps);
    const receipt = () => JSON.parse(readFileSync(receiptPath, 'utf8'));
    return { root, llm, built, installed, side, routes, requests, serve, dir, latest, receiptPath, setPublished, run, receipt, web };
}

const manifestOf = (latest) => readFileSync(latest, 'utf8');

test('publish: 게시본과 같거나 더 높으면 네트워크를 부르지 않고 0', async (t) => {
    const f = await fixture(t);
    f.serve();
    f.setPublished(JSON.stringify({ native: { version: '0.3.8', file: FILE, sha256: DMG_SHA } }));
    assert.equal(await f.run(), 0);
    assert.equal(f.receipt().status, 'unchanged');
    // 사후 대조용 — 게시된 바이트가 릴리스 자산과 같은지 영수증만으로 볼 수 있다.
    assert.deepEqual(f.receipt().published, { file: FILE, sha256: DMG_SHA });
    f.setPublished(JSON.stringify({ native: { version: '0.3.9', file: 'OpenMake-Companion-0.3.9-arm64.dmg', sha256: 'e'.repeat(64) } }));
    assert.equal(await f.run(), 0);
    assert.equal(f.receipt().status, 'ahead');
    assert.deepEqual(f.receipt().published, { file: 'OpenMake-Companion-0.3.9-arm64.dmg', sha256: 'e'.repeat(64) });
    // 규칙 밖 값은 영수증에 옮기지 않는다.
    f.setPublished(JSON.stringify({ native: { version: '0.3.8', file: 'https://x/y.dmg', sha256: 'nope' } }));
    assert.equal(await f.run(), 0);
    assert.deepEqual(f.receipt().published, {});
    assert.equal(f.requests.length, 0);
});

test('publish: 릴리스 자산이 아직 없으면(404) 75, latest.json 그대로, 영수증 pending', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    assert.equal(await f.run(), 75);
    assert.equal(manifestOf(f.latest), PREVIOUS);
    const r = f.receipt();
    assert.equal(r.status, 'pending');
    assert.equal(r.sha, f.installed);
    assert.equal(r.version, '0.3.8');
});

test('publish: 자산 매니페스트를 받다가 404 외 HTTP 오류면 실패', async (t) => {
    const f = await fixture(t);
    f.routes.set('/acme/app/releases/download/desktop-native-v0.3.8/desktop-native.json', { status: 500, body: 'oops' });
    f.setPublished(PREVIOUS);
    assert.equal(await f.run(), 1);
    assert.equal(f.receipt().status, 'failed');
    assert.equal(manifestOf(f.latest), PREVIOUS);
});

test('publish: 빌드 커밋이 설치된 계보에 없으면(다른 가지·모르는 커밋) 실패, latest.json 그대로', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    for (const gitSha of [f.side, 'd'.repeat(40)]) {
        f.serve({ gitSha });
        assert.equal(await f.run(), 1, gitSha);
        assert.equal(f.receipt().status, 'failed');
        assert.equal(f.receipt().gitSha, gitSha);
        assert.equal(manifestOf(f.latest), PREVIOUS);
    }
    assert.ok(!f.requests.some((u) => u.endsWith('.dmg') || u === '/objects/dmg'), 'dmg is not downloaded');
});

test('publish: sha256 이 다르면 실패, 받은 파일을 지우고 latest.json 그대로', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    f.serve({ sha256: '0'.repeat(64) });
    assert.equal(await f.run(), 1);
    assert.equal(f.receipt().status, 'failed');
    const incoming = path.join(f.dir, '.incoming');
    assert.ok(!existsSync(incoming) || readdirSync(incoming).length === 0);
    assert.equal(manifestOf(f.latest), PREVIOUS);
    assert.ok(!existsSync(path.join(f.dir, FILE)));
});

test('publish: 성공하면 native 를 새 버전으로, 직전 매니페스트는 .prev, windows 블록 보존 — 다시 돌리면 unchanged', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    f.serve();
    assert.equal(await f.run(), 0);
    const now = JSON.parse(manifestOf(f.latest));
    assert.deepEqual(now.native, { version: '0.3.8', file: FILE, sha256: DMG_SHA });
    assert.deepEqual(now.windows, JSON.parse(PREVIOUS).windows);
    assert.equal(readFileSync(`${f.latest}.prev`, 'utf8'), PREVIOUS);
    assert.deepEqual(readFileSync(path.join(f.dir, FILE)), DMG);
    assert.ok(!existsSync(path.join(f.dir, '.incoming')));
    const r = f.receipt();
    assert.deepEqual({ ...r, at: undefined }, { schemaVersion: 1, stage: 'desktop-publish', sha: f.installed, version: '0.3.8', file: FILE, sha256: DMG_SHA, gitSha: f.built, status: 'published', at: undefined });
    assert.ok(!Number.isNaN(Date.parse(r.at)));
    assert.equal(statSync(f.receiptPath).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(f.receiptPath, 'utf8'), /https?:|127\.0\.0\.1/, 'receipt carries no address');

    const before = f.requests.length;
    assert.equal(await f.run(), 0);
    assert.equal(f.receipt().status, 'unchanged');
    assert.equal(f.requests.length, before);
});

test('publish: 게시본이 없던 서버도 첫 게시를 한다', async (t) => {
    const f = await fixture(t);
    f.serve();
    assert.equal(await f.run(), 0);
    assert.deepEqual(JSON.parse(manifestOf(f.latest)).native, { version: '0.3.8', file: FILE, sha256: DMG_SHA });
    assert.ok(!existsSync(`${f.latest}.prev`));
});

test('publish: 게시 스크립트가 실패하면 latest.json 을 직전 내용으로 되돌린다', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    f.serve();
    const runPublishScript = ({ dir }) => { writeFileSync(path.join(dir, 'latest.json'), '{"broken":'); return 1; };
    assert.equal(await f.run({ runPublishScript }), 1);
    assert.equal(manifestOf(f.latest), PREVIOUS);
    assert.equal(f.receipt().status, 'failed');
    assert.ok(!existsSync(path.join(f.dir, '.incoming')));
});

test('publish: 첫 게시에서 게시 스크립트가 실패하면 새로 생긴 latest.json 을 지운다', async (t) => {
    const f = await fixture(t);
    f.serve();
    const runPublishScript = ({ dir }) => { writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ native: { version: '0.3.8', file: FILE, sha256: DMG_SHA } })); return 1; };
    assert.equal(await f.run({ runPublishScript }), 1);
    assert.ok(!existsSync(f.latest), 'no manifest left behind');
    assert.ok(!existsSync(`${f.latest}.prev`));
    assert.equal(f.receipt().status, 'failed');
});

test('publish: dmg 가 크기 상한을 넘으면(content-length·스트림 모두) 실패, latest.json 그대로 — 상한과 같으면 통과', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    f.serve();
    const limit = { maxDmgBytes: DMG.length - 1 };
    assert.equal(await f.run(undefined, limit), 1);
    assert.match(f.receipt().reason, /size limit/);
    // content-length 없이 흘려보내도 받는 도중 멈춘다.
    f.routes.set('/objects/dmg', { headers: { 'transfer-encoding': 'chunked' }, body: DMG });
    assert.equal(await f.run(undefined, limit), 1);
    assert.match(f.receipt().reason, /size limit/);
    assert.equal(manifestOf(f.latest), PREVIOUS);
    assert.ok(!existsSync(path.join(f.dir, '.incoming')));
    assert.equal(await f.run(undefined, { maxDmgBytes: DMG.length }), 0);
    assert.equal(f.receipt().status, 'published');
});

test('publish: 게시 뒤 매니페스트가 기대값이 아니면 되돌리고 실패', async (t) => {
    const f = await fixture(t);
    f.setPublished(PREVIOUS);
    f.serve();
    const runPublishScript = ({ dir }) => { writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ native: { version: '0.3.8', file: FILE, sha256: '1'.repeat(64) } })); return 0; };
    assert.equal(await f.run({ runPublishScript }), 1);
    assert.equal(manifestOf(f.latest), PREVIOUS);
});

test('CLI: publish 는 OMK_GITHUB_WEB 에서 받고 종료 코드(75)를 그대로 낸다, 인자가 모자라면 1', async (t) => {
    const f = await fixture(t);
    const args = ['publish', '--cwd', f.llm, '--sha', f.installed, '--dir', f.dir, '--repo', 'acme/app', '--output', f.receiptPath];
    const cli = (argv) => new Promise((resolve) => {
        const child = spawn(process.execPath, [SCRIPT, ...argv], { env: { ...process.env, OMK_GITHUB_WEB: f.web }, stdio: 'ignore' });
        child.on('exit', resolve);
    });
    assert.equal(await cli(args), 75);
    assert.ok(f.requests.length > 0, 'used OMK_GITHUB_WEB');
    assert.equal(await cli(args.slice(0, -2)), 1);
    assert.equal(await cli([...args, '--extra', 'x']), 1);
    assert.equal(await cli(['nope']), 1);
});

test('CLI: manifest 는 --output 에 매니페스트를 쓰고, 규칙 밖 파일명이면 1', (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'desktop-manifest-cli-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const dmg = path.join(dir, FILE), out = path.join(dir, 'out/desktop-native.json'), sha = 'a'.repeat(40);
    writeFileSync(dmg, DMG);
    assert.equal(spawnSync(process.execPath, [SCRIPT, 'manifest', '--dmg', dmg, '--sha', sha, '--output', out]).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { schemaVersion: 1, version: '0.3.8', file: FILE, sha256: DMG_SHA, gitSha: sha });
    writeFileSync(path.join(dir, 'bad.dmg'), DMG);
    assert.equal(spawnSync(process.execPath, [SCRIPT, 'manifest', '--dmg', path.join(dir, 'bad.dmg'), '--sha', sha, '--output', out]).status, 1);
});
