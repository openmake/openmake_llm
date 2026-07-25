#!/usr/bin/env node
/**
 * build-info.json 생성 — 서버 빌드 메타(버전 + git 좌표).
 *
 * apps/api 빌드의 마지막 단계에서 실행되며 `apps/api/dist/build-info.json` 을 만든다.
 * 소비처는 `config/build-id.ts`(부팅 시 1회 read → /health 응답 + WS build_id handshake).
 *
 * version 은 **루트 package.json** 에서 읽는다 — release-please 가 bump 하는 단일 SoT.
 * gitTag 는 `git describe --tags` 결과로, 태그가 아직 없으면 빈 문자열.
 *
 * 실행: node scripts/build-info.js  (cwd 무관 — 경로는 이 파일 기준으로 해석)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outPath = path.join(repoRoot, 'apps/api/dist/build-info.json');

/** git 명령 실행 — 실패 시 fallback (얕은 클론·태그 부재 등). */
function git(cmd, fallback = '') {
    try {
        return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        return fallback;
    }
}

const { version } = require(path.join(repoRoot, 'package.json'));

const info = {
    version,
    buildTime: new Date().toISOString(),
    gitHash: git('git rev-parse --short HEAD', 'unknown'),
    gitDate: git('git log -1 --format=%cd --date=short', 'unknown'),
    gitTag: git('git describe --tags --abbrev=0'),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(info));
console.log('build-info:', info);
