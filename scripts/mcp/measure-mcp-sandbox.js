#!/usr/bin/env node
/**
 * measure-mcp-sandbox.js — 외부 MCP stdio 서버 bwrap 격리 호환성 재측정 (read-only)
 *
 * 목적: MCP_SANDBOX_ENABLED=true 활성화 전, 운영 DB에 등록된 stdio MCP 서버의
 *   command/args/env 를 점검해 (1) 격리 호환성 위험을 분류하고 (2) 서버별
 *   sandbox_network('full'|'none') 정책을 추천한다. 어떤 변경도 하지 않으며,
 *   추천 UPDATE 문을 "주석으로" 출력만 한다(사람이 검토 후 직접 실행).
 *
 * 실행 (운영 서버, repo 루트에서 — DATABASE_URL 이 .env 또는 환경에 있어야 함):
 *   node scripts/mcp/measure-mcp-sandbox.js
 *
 * 근거: docs/superpowers/plans/2026-06-22-mcp-sandbox-bubblewrap.md
 *   - 네트워크는 bwrap 한계상 binary: full(공유) | none(--unshare-net)
 *   - 대부분 MCP 는 외부 API 호출 → 기본 'full'. 임의 코드 실행 등 net 불필요
 *     고위험 서버만 'none' 후보(예: Python REPL).
 */
/* eslint-disable @typescript-eslint/no-require-imports */ // 운영서 ts-node 없이 `node` 로 직접 실행되는 ops 스크립트
'use strict';

const { Pool } = require('pg');
try { require('dotenv').config(); } catch { /* dotenv 없으면 환경변수 그대로 사용 */ }

// ── 호환성 휴리스틱 ─────────────────────────────────────────────
const SECRETISH = /(SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL|CREDENTIAL)/i;
const INTERNAL_NET = /(localhost|127\.0\.0\.1|::1|:5432|:13401|:4000|:52416|:6379)/i;
const HOME_DEP = /(\$HOME|~\/|\/home\/|\/Users\/|\.config|\.cache|\.local)/i;
// 임의 코드 실행 / 셸 계열 → 네트워크 차단(none) 후보
const ARBITRARY_CODE = /(repl|interpreter|exec|eval|code-?run|shell|bash|python-?repl)/i;

function classify(s) {
    const args = Array.isArray(s.args) ? s.args : [];
    const env = s.env && typeof s.env === 'object' ? s.env : {};
    const envKeys = Object.keys(env);
    const blob = [s.name, s.command, ...args.map(String), ...Object.values(env).map(String)].join(' ');

    const flags = [];
    if (envKeys.some((k) => SECRETISH.test(k))) flags.push('host-secret-env');
    if (INTERNAL_NET.test(blob)) flags.push('internal-net');   // → net 필요(full 유지)
    if (HOME_DEP.test(blob)) flags.push('home-path');           // → 설치/데이터 디렉토리 bind 필요
    const arbitrary = ARBITRARY_CODE.test(blob);
    if (arbitrary) flags.push('arbitrary-code');

    // 네트워크 추천: 내부 net 의존이면 full 필수. 임의 코드 + 내부net 아님 → none 후보.
    let suggestNet = 'full';
    let reason = '외부 API 호출 가능성 — 기본 full';
    if (flags.includes('internal-net')) {
        reason = '내부 서비스(loopback) 접속 필요 — full 유지';
    } else if (arbitrary) {
        suggestNet = 'none';
        reason = '임의 코드 실행 + 내부net 의존 없음 — net 차단(none) 권장';
    }
    return { flags, suggestNet, reason, envKeys, args };
}

(async () => {
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL 미설정. .env 로드 또는 환경변수 export 후 재실행.');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const { rows } = await pool.query(
            "SELECT name, command, args, env, sandbox_network FROM mcp_servers WHERE transport_type='stdio' ORDER BY name"
        );
        if (rows.length === 0) {
            console.log('등록된 stdio MCP 서버가 없습니다.');
            return;
        }
        console.log(`\n외부 MCP stdio 서버 ${rows.length}개 — bwrap 격리 호환성 재측정`);
        console.log('='.repeat(72));

        const updates = [];
        let i = 0;
        for (const s of rows) {
            i++;
            const c = classify(s);
            const current = s.sandbox_network || 'full(기본)';
            console.log(`\n${i}. ${s.name}`);
            console.log(`   command : ${s.command} ${JSON.stringify(c.args)}`);
            console.log(`   env keys: ${c.envKeys.length ? c.envKeys.join(', ') : '(none)'}`);
            console.log(`   flags   : ${c.flags.length ? c.flags.join(', ') : '특이 의존 없음'}`);
            console.log(`   현재 net: ${current}  →  추천: ${c.suggestNet}  (${c.reason})`);
            if (c.suggestNet === 'none' && s.sandbox_network !== 'none') {
                updates.push(`UPDATE mcp_servers SET sandbox_network='none' WHERE name=${quote(s.name)};`);
            }
        }

        console.log('\n' + '='.repeat(72));
        console.log('📋 추천 정책 변경 (검토 후 직접 실행 — 이 스크립트는 변경하지 않음):');
        if (updates.length === 0) {
            console.log('   변경 추천 없음 — 전부 full 유지 권장.');
        } else {
            console.log('   /* 아래는 추천일 뿐. 각 서버가 실제로 네트워크 불필요한지 확인 후 적용 */');
            for (const u of updates) console.log('   ' + u);
        }
        console.log('\n⚠️  bwrap 한계: 네트워크는 full/none 만 가능. "외부 허용+내부 loopback 차단"은');
        console.log('    Phase 2(netns+nftables) 별도 작업. internal-net flag 서버는 full 유지 필수.');
    } catch (e) {
        console.error('ERR:', e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
})();

/** SQL 문자열 리터럴 안전 인용 (작은따옴표 이스케이프) */
function quote(v) {
    return `'${String(v).replace(/'/g, "''")}'`;
}
