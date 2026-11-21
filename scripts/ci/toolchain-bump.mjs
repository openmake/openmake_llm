#!/usr/bin/env node
// 도구 고정 판 올리기 — Dependabot 이 읽지 못하는 고정값(.node-version·.pm2-version·omk.sh 의 상수)을 최신으로 올린다.
//
// 설치 시점의 최신을 받지 않고 저장소에 고정해 두는 이유: CI → staging 검증 → 승인 → 운영이 같은 조합을 돌려야 한다.
// 최신 유지는 이 스크립트가 PR 로 한다(.github/workflows/toolchain-bump.yml, 매주). 서버는 omk env update 가 고정값에 맞춘다.
//
//   node scripts/ci/toolchain-bump.mjs                # 무엇이 올라갈지 JSON 으로만 출력
//   node scripts/ci/toolchain-bump.mjs --write node   # 그 구성요소의 파일을 고친다 (이름 여러 개 가능, 없으면 전부)
//
// Node 는 지금 메이저 안에서만 올린다 — 메이저 변경(engines·호환성 점검)은 사람이 판단하는 PR 로 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;

/** 구성요소: 지금 판을 읽는 곳(current), 최신을 구하는 법(latest), 같이 고칠 파일(edits). */
export const COMPONENTS = {
    node: {
        current: { file: '.node-version', re: /^v?(\d+\.\d+\.\d+)\s*$/ },
        latest: async (cur, get) => {
            const major = cur.split('.')[0];
            const list = await get('https://nodejs.org/dist/index.json');
            const hit = list.map(v => v.version.replace(/^v/, '')).filter(v => SEMVER.test(v) && v.split('.')[0] === major).sort(cmp).pop();
            return hit;
        },
        edits: [
            { file: '.node-version', re: /^v?\d+\.\d+\.\d+(\s*)$/, to: v => `${v}$1` },
            { file: 'mise.toml', re: /^(node = ")\d+\.\d+\.\d+(")$/m, to: v => `$1${v}$2` },
            { file: 'infra/egress-proxy/Dockerfile', re: /^(FROM node:)\d+\.\d+\.\d+(-)/m, to: v => `$1${v}$2` },
            { file: 'infra/mcp-runtime/Dockerfile', re: /^(FROM node:)\d+\.\d+\.\d+(-)/m, to: v => `$1${v}$2` },
        ],
    },
    pm2: {
        current: { file: '.pm2-version', re: /^(\d+\.\d+\.\d+)\s*$/ },
        latest: async (_cur, get) => (await get('https://registry.npmjs.org/pm2/latest')).version,
        edits: [{ file: '.pm2-version', re: /^\d+\.\d+\.\d+(\s*)$/, to: v => `${v}$1` }],
    },
    litellm: {
        current: { file: 'scripts/env/omk.sh', re: /OMK_LITELLM_VERSION="\$\{OMK_LITELLM_VERSION:-(\d+\.\d+\.\d+)\}"/ },
        latest: async (_cur, get) => (await get('https://pypi.org/pypi/litellm/json')).info.version,
        edits: [
            { file: 'scripts/env/omk.sh', re: /(OMK_LITELLM_VERSION="\$\{OMK_LITELLM_VERSION:-)\d+\.\d+\.\d+(\}")/, to: v => `$1${v}$2` },
            { file: '.github/workflows/install-smoke.yml', re: /(check "LiteLLM 버전 고정 )\d+\.\d+\.\d+(".*?==\\")\d+\.\d+\.\d+(\\")/, to: v => `$1${v}$2${v}$3` },
            { file: 'scripts/env/README.md', re: /(`OMK_LITELLM_VERSION=X\.Y\.Z`\(기본 )\d+\.\d+\.\d+(\))/, to: v => `$1${v}$2` },
            { file: 'scripts/env/README.md', re: /(`OMK_LITELLM_VERSION`\(기본 )\d+\.\d+\.\d+(\))/, to: v => `$1${v}$2` },
            { file: 'scripts/env/README.md', re: /(\| `OMK_LITELLM_VERSION` \| `)\d+\.\d+\.\d+(` \|)/, to: v => `$1${v}$2` },
        ],
    },
    caddy: {
        current: { file: 'scripts/env/omk.sh', re: /^CADDY_PINNED_VERSION="(\d+\.\d+\.\d+)"/m },
        latest: async (_cur, get) => (await get('https://api.github.com/repos/caddyserver/caddy/releases/latest')).tag_name.replace(/^v/, ''),
        edits: [
            { file: 'scripts/env/omk.sh', re: /^(CADDY_PINNED_VERSION=")\d+\.\d+\.\d+(")/m, to: v => `$1${v}$2` },
            { file: 'scripts/env/README.md', re: /(\| `OMK_CADDY_VERSION` \| `)\d+\.\d+\.\d+(` \|)/, to: v => `$1${v}$2` },
        ],
    },
};

export function cmp(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
}

export function readCurrent(root, comp) {
    const m = fs.readFileSync(path.join(root, comp.current.file), 'utf8').match(comp.current.re);
    if (!m) throw new Error(`${comp.current.file}: 지금 판을 읽지 못했습니다`);
    return m[1];
}

/** 파일 내용을 바꿔 돌려준다 — 패턴이 하나도 안 맞으면 throw(조용히 일부만 올리지 않는다). */
export function applyEdits(read, comp, version) {
    const out = new Map();
    for (const e of comp.edits) {
        const before = out.get(e.file) ?? read(e.file);
        if (!e.re.test(before)) throw new Error(`${e.file}: 고칠 자리(${e.re})를 찾지 못했습니다`);
        out.set(e.file, before.replace(e.re, e.to(version)));
    }
    return out;
}

export async function plan(root, names, get) {
    const result = [];
    for (const name of names) {
        const comp = COMPONENTS[name];
        if (!comp) throw new Error(`모르는 구성요소: ${name}`);
        const current = readCurrent(root, comp);
        const latest = await comp.latest(current, get);
        if (!latest || !SEMVER.test(latest)) throw new Error(`${name}: 최신 판을 알 수 없습니다 (${latest})`);
        result.push({ name, current, latest, bump: cmp(latest, current) > 0 });
    }
    return result;
}

async function httpGetJson(url) {
    const headers = { 'user-agent': 'toolchain-bump' };
    if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
}

async function main(argv) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const write = argv.includes('--write');
    const names = argv.filter(a => !a.startsWith('--'));
    const list = await plan(root, names.length ? names : Object.keys(COMPONENTS), httpGetJson);
    if (write) {
        for (const p of list.filter(p => p.bump)) {
            const files = applyEdits(f => fs.readFileSync(path.join(root, f), 'utf8'), COMPONENTS[p.name], p.latest);
            for (const [f, text] of files) fs.writeFileSync(path.join(root, f), text);
        }
    }
    process.stdout.write(`${JSON.stringify(list)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch(e => { console.error(`toolchain-bump: ${e.message}`); process.exit(1); });
}
