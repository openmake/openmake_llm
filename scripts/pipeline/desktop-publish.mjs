#!/usr/bin/env node
// 데스크톱 앱(dmg) 게시 — 앱 버전마다 한 번 만든 GitHub 릴리스 자산을 서버가 계보·sha256 확인 뒤 게시한다.
//   manifest (CI):   --dmg PATH --sha FULL_SHA --output PATH
//   publish (서버):  --cwd LLM_DIR --sha INSTALLED_SHA --dir UPDATE_DIR --repo OWNER/REPO --output RECEIPT_PATH
// 인자 모양은 고정이다 — 파이프라인(pipeline.sh)은 갱신 전 판이 메모리에 남아 한 주기 동안 새 스크립트를 옛 인자로 부른다.
// 종료 코드: 0 완료·해당 없음 / 75 릴리스 자산 대기 / 1 실패·사용법.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';

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
