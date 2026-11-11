#!/usr/bin/env node
// 데스크톱 앱(dmg) 게시 — 앱 버전마다 한 번 만든 GitHub 릴리스 자산을 서버가 계보·sha256 확인 뒤 게시한다.
//   manifest (CI):   --dmg PATH --sha FULL_SHA --output PATH
//   publish (서버):  --cwd LLM_DIR --sha INSTALLED_SHA --dir UPDATE_DIR --repo OWNER/REPO --output RECEIPT_PATH
// 인자 모양은 고정이다 — 파이프라인(pipeline.sh)은 갱신 전 판이 메모리에 남아 한 주기 동안 새 스크립트를 옛 인자로 부른다.
// 종료 코드: 0 완료·해당 없음 / 75 릴리스 자산 대기 / 1 실패·사용법.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_WEB = 'https://github.com';        // 공개 저장소 — 릴리스 자산은 토큰 없이 받는다(OMK_GITHUB_WEB 로 바꾼다)
const TAG_PREFIX = 'desktop-native-v';
const MANIFEST_ASSET = 'desktop-native.json';
const MANIFEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_DMG_BYTES = 512 * 1024 * 1024;         // 기본 상한(publish 의 maxDmgBytes) — 지금 dmg 는 이보다 한참 작다, 넘으면 받다 말고 중단
export const EXIT = { OK: 0, FAILED: 1, PENDING: 75 };

/** 점으로 나눈 수 비교(모자란 자리는 0) — 앱 Updater.swift 의 isNewer 와 같은 규칙. */
export function compareVersions(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

/** 저장소(체크아웃) 버전과 게시된 버전 → 'unchanged' | 'ahead' | 'publish'. */
export function decide({ repoVersion, publishedVersion }) {
    if (!publishedVersion) return 'publish';
    const order = compareVersions(repoVersion, publishedVersion);
    return order === 0 ? 'unchanged' : order < 0 ? 'ahead' : 'publish';
}

const VERSION_RE = /^[0-9]+(\.[0-9]+)*$/;                                  // build.sh 와 같은 규칙
const FILE_RE = /^OpenMake-[A-Za-z]+-([0-9]+(?:\.[0-9]+)*)-[A-Za-z0-9.-]+\.dmg$/; // 경로 구분자 없음 — 좁은 검사는 publish-desktop.sh
const SHA256_RE = /^[a-f0-9]{64}$/, GIT_SHA_RE = /^[a-f0-9]{40}$/;

/** dmg 파일명 → 버전(규칙 밖이면 undefined). publish-desktop.sh 가 같은 자리에서 버전을 뽑는다. */
function fileVersion(file) {
    return typeof file === 'string' ? FILE_RE.exec(file)?.[1] : undefined;
}

/** 릴리스 자산 desktop-native.json 검증 → { schemaVersion, version, file, sha256, gitSha }. 하나라도 어긋나면 throw. */
export function parseReleaseManifest(text, repoVersion) {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object') throw new Error('release manifest is not an object');
    const { schemaVersion, version, file, sha256, gitSha } = value;
    if (schemaVersion !== 1) throw new Error('release manifest schemaVersion is not 1');
    if (typeof version !== 'string' || !VERSION_RE.test(version)) throw new Error('release manifest version is malformed');
    if (version !== repoVersion) throw new Error(`release manifest version ${version} differs from checkout ${repoVersion}`);
    if (fileVersion(file) !== version) throw new Error('release manifest file name is malformed or names another version');
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) throw new Error('release manifest sha256 is malformed');
    if (typeof gitSha !== 'string' || !GIT_SHA_RE.test(gitSha)) throw new Error('release manifest gitSha is malformed');
    return { schemaVersion, version, file, sha256, gitSha };
}

async function sha256File(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

/** CI: 릴리스에 올릴 dmg → desktop-native.json 객체. 파일명이 규칙 밖이면 throw. */
export async function buildManifest({ dmgPath, sha }) {
    const file = path.basename(dmgPath), version = fileVersion(file);
    if (!version) throw new Error(`dmg file name does not match OpenMake-<App>-<version>-<arch>.dmg: ${file}`);
    if (!GIT_SHA_RE.test(sha || '')) throw new Error('--sha must be a full commit SHA');
    return { schemaVersion: 1, version, file, sha256: await sha256File(dmgPath), gitSha: sha };
}

/** 임시 파일 → rename 으로 한 번에 바꾼다(읽는 쪽이 반쯤 쓴 파일을 보지 않게). */
function writeJsonAtomic(file, value, mode) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode });
    renameSync(temporary, file);
}

/** 서버에 게시된 macOS 앱(latest.json 의 native). 버전이 없거나 깨졌으면 undefined = 게시본 없음. file·sha256 은 규칙에 맞을 때만. */
function readPublished(manifestPath) {
    let native;
    try { native = JSON.parse(readFileSync(manifestPath, 'utf8'))?.native; } catch { return undefined; }
    if (typeof native?.version !== 'string' || !VERSION_RE.test(native.version)) return undefined;
    return {
        version: native.version,
        ...(typeof native.file === 'string' && FILE_RE.test(native.file) ? { file: native.file } : {}),
        ...(typeof native.sha256 === 'string' && SHA256_RE.test(native.sha256) ? { sha256: native.sha256 } : {}),
    };
}

/** dmg 를 스트림으로 받으며 sha256·크기를 잰다. 다르거나 넘치면 throw(파일 정리는 부르는 쪽). */
async function download(fetchImpl, url, target, expectedSha256, maxBytes) {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new Error(`dmg download failed: HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('dmg exceeds the size limit');
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
        transform(chunk, _encoding, callback) {
            size += chunk.length;
            if (size > maxBytes) { callback(new Error('dmg exceeds the size limit')); return; }
            hash.update(chunk);
            callback(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(target));
    if (hash.digest('hex') !== expectedSha256) throw new Error('dmg sha256 differs from the release manifest');
}

const defaultDeps = {
    fetch: (...args) => globalThis.fetch(...args),
    /** git -C cwd ... 의 종료 코드(신호로 끝나면 128). */
    git: (args, cwd) => spawnSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }).status ?? 128,
    /** 기존 게시 스크립트를 그대로 부른다 — 파일명 검사·windows 블록 보존은 그쪽 몫. */
    runPublishScript: ({ cwd, file, dir }) => spawnSync('bash', [path.join(cwd, 'scripts/publish-desktop.sh'), file], {
        env: { ...process.env, DESKTOP_UPDATE_DIR: dir }, stdio: ['ignore', 'inherit', 'inherit'],
    }).status ?? 1,
};

/**
 * 서버: 체크아웃의 앱 버전이 게시본보다 높으면 그 버전의 릴리스 자산을 받아 계보·sha256 확인 뒤 게시한다.
 * 결과는 언제나 영수증(--output)에 남긴다 — 주소·토큰류는 넣지 않는다. 돌려주는 값은 종료 코드(EXIT).
 */
export async function publish(options, deps = {}) {
    const { fetch, git, runPublishScript } = { ...defaultDeps, ...deps };
    const { cwd, sha, repo, output, maxDmgBytes = MAX_DMG_BYTES } = options;
    const web = (options.web || DEFAULT_WEB).replace(/\/+$/, '');
    const receipt = { schemaVersion: 1, stage: 'desktop-publish', sha };
    const finish = (status, code, reason) => {
        writeJsonAtomic(output, { ...receipt, status, ...(reason ? { reason } : {}), at: new Date().toISOString() }, 0o600);
        console.log(`desktop-publish: ${status}${receipt.version ? ` ${receipt.version}` : ''}${reason ? ` — ${reason}` : ''}`);
        return code;
    };
    try {
        if (!GIT_SHA_RE.test(sha || '')) throw new Error('--sha must be a full commit SHA');
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('--repo must be OWNER/REPO');
        const dir = path.resolve(cwd, options.dir);       // API 처럼 작업 폴더 기준
        const version = readFileSync(path.join(cwd, 'apps/desktop-native/VERSION'), 'utf8').trim();
        if (!VERSION_RE.test(version)) throw new Error('apps/desktop-native/VERSION is malformed');
        receipt.version = version;
        const manifestPath = path.join(dir, 'latest.json'), prevPath = `${manifestPath}.prev`;
        const published = readPublished(manifestPath), publishedVersion = published?.version;
        const decision = decide({ repoVersion: version, publishedVersion });
        // 게시하지 않을 때도 지금 게시된 바이트를 남긴다 — 손 게시 등으로 릴리스 자산과 달라졌는지 사후 대조용.
        if (decision !== 'publish') receipt.published = { file: published.file, sha256: published.sha256 };
        if (decision === 'unchanged') return finish('unchanged', EXIT.OK);
        if (decision === 'ahead') {
            console.warn(`desktop-publish: published ${publishedVersion} is higher than checkout ${version}; not downgrading`);
            return finish('ahead', EXIT.OK, `published version ${publishedVersion} is higher`);
        }

        const base = `${web}/${repo}/releases/download/${TAG_PREFIX}${version}`;
        const response = await fetch(`${base}/${MANIFEST_ASSET}`, { redirect: 'follow', signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
        if (response.status === 404) return finish('pending', EXIT.PENDING, `release asset ${TAG_PREFIX}${version} not available yet`);
        if (!response.ok) throw new Error(`release manifest download failed: HTTP ${response.status}`);
        const asset = parseReleaseManifest(await response.text(), version);
        Object.assign(receipt, { file: asset.file, sha256: asset.sha256, gitSha: asset.gitSha });
        const lineage = git(['merge-base', '--is-ancestor', asset.gitSha, sha], cwd);
        if (lineage !== 0) throw new Error(lineage === 1 ? 'build commit is not an ancestor of the installed commit' : `cannot check build commit lineage (git exit ${lineage})`);

        const incoming = path.join(dir, '.incoming');
        rmSync(incoming, { recursive: true, force: true });
        mkdirSync(incoming, { recursive: true });
        try {
            const received = path.join(incoming, asset.file);
            await download(fetch, `${base}/${asset.file}`, received, asset.sha256, maxDmgBytes);
            const hadManifest = existsSync(manifestPath);
            if (hadManifest) copyFileSync(manifestPath, prevPath);
            const restore = () => { if (hadManifest) copyFileSync(prevPath, manifestPath); else rmSync(manifestPath, { force: true }); };
            if (runPublishScript({ cwd, file: received, dir }) !== 0) { restore(); throw new Error('publish-desktop.sh failed; previous manifest restored'); }
            let native;
            try { native = JSON.parse(readFileSync(manifestPath, 'utf8'))?.native; } catch { /* 아래에서 실패 */ }
            if (native?.version !== version || native?.file !== asset.file || native?.sha256 !== asset.sha256) {
                restore();
                throw new Error('published manifest does not match the release asset; previous manifest restored');
            }
        } finally {
            rmSync(incoming, { recursive: true, force: true });
        }
        return finish('published', EXIT.OK);
    } catch (error) {
        console.error(`desktop-publish: ${error.message}`);
        return finish('failed', EXIT.FAILED, error.message);
    }
}

const COMMANDS = { manifest: ['dmg', 'sha', 'output'], publish: ['cwd', 'sha', 'dir', 'repo', 'output'] };
const USAGE = `Usage:
  desktop-publish.mjs manifest --dmg PATH --sha FULL_SHA --output PATH
  desktop-publish.mjs publish --cwd LLM_DIR --sha INSTALLED_SHA --dir UPDATE_DIR --repo OWNER/REPO --output RECEIPT_PATH`;

export async function main(argv) {
    const [command, ...rest] = argv, names = COMMANDS[command];
    let values;
    try {
        if (!names) throw new Error('unknown command');
        ({ values } = parseArgs({ args: rest, options: Object.fromEntries(names.map((name) => [name, { type: 'string' }])), strict: true, allowPositionals: false }));
        if (names.some((name) => !values[name])) throw new Error('missing argument');
    } catch {
        console.error(USAGE);
        return EXIT.FAILED;
    }
    if (command === 'publish') return publish({ ...values, web: process.env.OMK_GITHUB_WEB });
    try {
        writeJsonAtomic(values.output, await buildManifest({ dmgPath: values.dmg, sha: values.sha }), 0o644);
        return EXIT.OK;
    } catch (error) {
        console.error(`desktop-publish: ${error.message}`);
        return EXIT.FAILED;
    }
}

const invokedDirectly = (() => {
    try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
