// Node 버전의 유일한 기준은 저장소 루트 .node-version 이다 — 설치·배포·빌드·컨테이너·CI 가 모두 그 값과 정확히 같아야 한다
// (메이저만 맞추면 장비마다 24.x 의 다른 판·26.x·22.x 가 섞인다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const PINNED = read('.node-version').trim().replace(/^v/, '');
const LIB = join(ROOT, 'scripts', 'lib', 'node-version.sh');

test('.node-version 은 x.y.z 형식이다', () => {
    assert.match(PINNED, /^\d+\.\d+\.\d+$/);
});

test('mise.toml 의 node 는 .node-version 과 같다', () => {
    const m = read('mise.toml').match(/^\s*node\s*=\s*"([^"]+)"/m);
    assert.ok(m, 'mise.toml 에 node = "..." 가 없다');
    assert.equal(m[1], PINNED);
});

test('install_linux.sh 에는 버전 리터럴이 없고 .node-version 에서 읽는다', () => {
    const src = read('install_linux.sh');
    assert.ok(!src.includes(PINNED), `install_linux.sh 에 ${PINNED} 리터럴이 있다`);
    assert.doesNotMatch(src, /NODE_PINNED_VERSION="\d+\.\d+\.\d+"/);
    assert.match(src, /\.node-version/);
});

test('저장소의 모든 Dockerfile 의 FROM node: 는 node:<.node-version>-bookworm-slim 이다', () => {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => /(^|\/)Dockerfile[^/]*$/.test(f) && !f.includes('node_modules/') && !f.includes('/.build/'));
    assert.ok(files.includes('infra/mcp-runtime/Dockerfile') && files.includes('infra/egress-proxy/Dockerfile'));
    const want = `node:${PINNED}-bookworm-slim`;
    let seen = 0;
    for (const f of files) {
        for (const line of read(f).split('\n')) {
            const m = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(node:\S+)/i);
            if (!m) continue;
            seen++;
            assert.equal(m[1], want, `${f}: ${line.trim()}`);
        }
    }
    assert.ok(seen >= 2, 'FROM node: 줄을 찾지 못했다');
});

test('.github/workflows 의 setup-node 는 모두 node-version-file: .node-version 을 쓰고 node-version 리터럴이 없다', () => {
    const dir = join(ROOT, '.github', 'workflows');
    let uses = 0;
    for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
        const lines = readFileSync(join(dir, name), 'utf8').split('\n');
        assert.ok(!lines.some((l) => /^\s*node-version\s*:/.test(l)), `${name}: node-version 리터럴`);
        lines.forEach((l, i) => {
            if (!/uses:\s*actions\/setup-node@/.test(l)) return;
            uses++;
            // 같은 step 의 with: 블록(다음 step 의 "- " 전까지)에서 node-version-file 을 찾는다.
            const rest = [];
            for (let j = i + 1; j < lines.length && !/^\s*-\s/.test(lines[j]); j++) rest.push(lines[j]);
            const m = rest.join('\n').match(/node-version-file:\s*['"]?([^'"\s]+)/);
            assert.ok(m, `${name}:${i + 1} setup-node 에 node-version-file 이 없다`);
            assert.equal(m[1], '.node-version', `${name}:${i + 1}`);
        });
    }
    assert.ok(uses > 0, 'setup-node 를 찾지 못했다');
});

test('package.json engines 의 메이저는 .node-version 메이저와 같다', () => {
    const engines = JSON.parse(read('package.json')).engines?.node ?? '';
    const majors = [...engines.matchAll(/(\d+)/g)].map((m) => m[1]);
    const major = PINNED.split('.')[0];
    assert.match(engines, new RegExp(`>=\\s*${major}(\\D|$)`), `engines.node=${engines}`);
    assert.equal(majors[0], major, `engines.node=${engines}`);
});

// ── scripts/lib/node-version.sh — 가짜 node·pm2 를 PATH 앞에 두고 검사 ──
const REPORT = [
    '--- PM2 report ----------------------------------------------------------------',
    'Date                 : Fri Oct 17 2026',
    '--- Daemon --------------------------------------------------------------------',
    'pm2 version          : 7.0.3',
    'node version         : 26.9.0',
    '--- CLI -----------------------------------------------------------------------',
    'node version         : 24.21.0',
    '--- Daemon logs ---------------------------------------------------------------',
    'node version         : 99.0.0',
].join('\n');

function sandbox({ node, pm2Report, pm2Pid = true }) {
    const dir = mkdtempSync(join(tmpdir(), 'node-version-'));
    const bin = join(dir, 'bin');
    const repo = join(dir, 'repo');
    const pm2Home = join(dir, 'pm2');
    mkdirSync(bin); mkdirSync(repo); mkdirSync(pm2Home);
    writeFileSync(join(repo, '.node-version'), 'v24.21.0\n');
    const exe = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
    if (node) exe('node', `echo ${node}`);
    if (pm2Report !== undefined) {
        writeFileSync(join(dir, 'report.txt'), `${pm2Report}\n`);
        exe('pm2', `[ "$1" = report ] && cat "${join(dir, 'report.txt')}"`);
    }
    if (pm2Pid) writeFileSync(join(pm2Home, 'pm2.pid'), `${process.pid}\n`);
    const run = (script) => spawnSync('bash', ['-c', `. "${LIB}"; ${script}`], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, PM2_HOME: pm2Home },
    });
    return { repo, run, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('node_version_pinned: 앞 v·개행을 지우고, 파일이 없으면 1', () => {
    const s = sandbox({ node: '24.21.0' });
    try {
        assert.equal(s.run(`node_version_pinned "${s.repo}"`).stdout, '24.21.0');
        assert.equal(s.run(`node_version_pinned "${s.repo}/없음"`).status, 1);
    } finally { s.done(); }
});

test('require_node_version: 정확히 같으면 0', () => {
    const s = sandbox({ node: '24.21.0' });
    try {
        const r = s.run(`require_node_version "${s.repo}"`);
        assert.equal(r.status, 0, r.stderr);
    } finally { s.done(); }
});

test('require_node_version: 같은 메이저의 다른 판도 1 이고, 메시지에 두 버전이 있다', () => {
    for (const v of ['24.16.0', '26.9.0']) {
        const s = sandbox({ node: v });
        try {
            const r = s.run(`require_node_version "${s.repo}"`);
            assert.equal(r.status, 1);
            assert.ok(r.stderr.includes(v) && r.stderr.includes('24.21.0'), r.stderr);
            assert.match(r.stderr, /brew pin node@24/);
        } finally { s.done(); }
    }
});

test('require_node_version: node 가 없으면 1', () => {
    const s = sandbox({});
    try {
        assert.equal(s.run(`require_node_version "${s.repo}"`).status, 1);
    } finally { s.done(); }
});

test('pm2_daemon_node_version: Daemon 구역 값(26.9.0)만 뽑고 CLI 값(24.21.0)은 아니다 → require 는 1', () => {
    const s = sandbox({ node: '24.21.0', pm2Report: REPORT });
    try {
        assert.equal(s.run('pm2_daemon_node_version').stdout.trim(), '26.9.0');
        const r = s.run(`require_pm2_daemon_node_version "${s.repo}"`);
        assert.equal(r.status, 1);
        assert.ok(r.stderr.includes('26.9.0') && r.stderr.includes('24.21.0'), r.stderr);
        assert.match(r.stderr, /pm2 update/);
    } finally { s.done(); }
});

test('require_pm2_daemon_node_version: 데몬이 기준과 같으면 0', () => {
    const s = sandbox({ node: '24.21.0', pm2Report: REPORT.replace('26.9.0', '24.21.0') });
    try {
        assert.equal(s.run(`require_pm2_daemon_node_version "${s.repo}"`).status, 0);
    } finally { s.done(); }
});

test('require_pm2_daemon_node_version: pm2 가 없거나 데몬이 꺼져 있으면 0', () => {
    const none = sandbox({ node: '24.21.0' });
    const off = sandbox({ node: '24.21.0', pm2Report: REPORT, pm2Pid: false });
    try {
        assert.equal(none.run('pm2_daemon_node_version').stdout, '');
        assert.equal(none.run(`require_pm2_daemon_node_version "${none.repo}"`).status, 0);
        assert.equal(off.run('pm2_daemon_node_version').stdout, '');
        assert.equal(off.run(`require_pm2_daemon_node_version "${off.repo}"`).status, 0);
    } finally { none.done(); off.done(); }
});
