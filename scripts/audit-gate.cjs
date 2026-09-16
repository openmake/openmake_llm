#!/usr/bin/env node
/**
 * npm audit 게이트 (F28.8, CI Gate 0.7) — 운영 의존성(--omit=dev)의 high 이상 권고가 새로 생기면 막는다.
 *
 * 기존 부채는 `.audit-allowlist.json` 에 GHSA id·사유·만료일로 적는다. 만료가 지나면 다시 실패한다 —
 * "영구 무시" 를 만들지 않기 위해서다. npm audit 실행 자체가 실패하면(네트워크·JSON 파싱) 실패로 본다.
 *
 * 사용: node scripts/audit-gate.cjs [--level high|critical]
 * @module scripts/audit-gate
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/**
 * PURE: npm audit JSON(v2) + 허용 목록 → 판정.
 * @param {object} audit - `npm audit --json` 결과
 * @param {Array<{id: string, package?: string, reason: string, expires: string}>} allowlist
 * @param {{ level?: string, now?: Date }} opts
 */
function evaluateAudit(audit, allowlist, opts = {}) {
    const minRank = SEVERITY_RANK[opts.level || 'high'];
    const now = opts.now || new Date();
    const advisories = new Map();
    for (const [pkg, v] of Object.entries((audit && audit.vulnerabilities) || {})) {
        for (const via of v.via || []) {
            if (!via || typeof via !== 'object') continue; // 문자열 via 는 전이 경로 — 실제 권고는 그 패키지 항목에 있다
            if ((SEVERITY_RANK[via.severity] ?? -1) < minRank) continue;
            const id = String(via.url || '').split('/').pop() || String(via.source);
            if (!advisories.has(id)) advisories.set(id, { id, package: via.name || pkg, severity: via.severity, title: via.title || '', url: via.url || '' });
        }
    }
    const byId = new Map((allowlist || []).map((a) => [a.id, a]));
    const allowed = [];
    const expired = [];
    const failures = [];
    for (const adv of advisories.values()) {
        const entry = byId.get(adv.id);
        if (!entry) failures.push(adv);
        else if (!(new Date(entry.expires) > now)) expired.push({ ...adv, expires: entry.expires });
        else allowed.push({ ...adv, reason: entry.reason, expires: entry.expires });
    }
    const unused = (allowlist || []).filter((a) => !advisories.has(a.id)).map((a) => a.id);
    return { ok: failures.length === 0 && expired.length === 0, failures, expired, allowed, unused };
}

function runNpmAudit(cwd) {
    try {
        return execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        // 취약점이 있으면 npm audit 은 exit 1 이지만 JSON 은 stdout 에 온다
        if (e && typeof e.stdout === 'string' && e.stdout.trim().startsWith('{')) return e.stdout;
        throw e;
    }
}

function main() {
    const root = path.resolve(__dirname, '..');
    const levelIdx = process.argv.indexOf('--level');
    const level = levelIdx > 0 ? process.argv[levelIdx + 1] : 'high';
    const allowlistPath = path.join(root, '.audit-allowlist.json');
    const allowlist = fs.existsSync(allowlistPath) ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8')).advisories || [] : [];
    let audit;
    try {
        audit = JSON.parse(runNpmAudit(root));
    } catch (e) {
        console.error(`::error::npm audit 실행 실패 — ${e && e.message ? e.message.split('\n')[0] : e}`);
        process.exit(1);
    }
    const r = evaluateAudit(audit, allowlist, { level });
    for (const a of r.allowed) console.log(`허용(만료 ${a.expires}): ${a.id} ${a.package} [${a.severity}] — ${a.reason}`);
    for (const a of r.expired) console.log(`::error::허용 만료: ${a.id} ${a.package} [${a.severity}] (만료 ${a.expires}) ${a.url}`);
    for (const a of r.failures) console.log(`::error::새 ${a.severity} 권고: ${a.id} ${a.package} — ${a.title} ${a.url}`);
    if (r.unused.length) console.log(`::warning::해소돼 지워도 되는 허용 항목: ${r.unused.join(', ')}`);
    console.log(r.ok ? `audit 게이트 통과 (level ${level}, 허용 ${r.allowed.length}건)` : 'audit 게이트 실패 — 의존성을 올리거나 사유·만료일과 함께 .audit-allowlist.json 에 적으세요');
    process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { evaluateAudit };
