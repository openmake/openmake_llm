#!/usr/bin/env node
/**
 * 통합 검증 매트릭스 실행 — commands.json 의 명령을 차례로 돌리고 명령마다 receipt 를 남긴다.
 *
 *   node scripts/release/verify-matrix.mjs --run-id <id> [--evidence-root .omo/evidence/base-plugin-separation]
 *     [--commands scripts/release/commands.json] [--only id1,id2] [--local]
 *
 * --local: skipLocal 사유가 있는 명령은 실행하지 않고 "미측정(로컬 정책)" receipt 를 남긴다.
 * requiresEnv 가 비어 있지 않은데 env 가 없으면 실행하지 않고 "환경 부재" receipt 를 남긴다.
 * 명령은 commands.json 순서대로 돈다 — jest-api·db-tests 는 e2e 대상 API 를 띄우기 전에 돌려야 한다(같은 격리 테스트 DB 를
 * 쓴다). 그래서 commands.json 에서 모든 e2e·live 명령보다 앞에 있고, --only 로 나눠 돌릴 때도 이 순서를 지킨다.
 * 명령의 env 에는 RUN_ID·EVIDENCE_ROOT 를 이 CLI 의 --run-id·--evidence-root 값으로 넣는다(드릴 설정 파일 경로가 이 run 을 가리키게).
 * drill-worker-roundtrip 의 드릴 스크립트 exit: 0 성공 · 2 사용법 · 3 DB · 4 lease 대기 초과 · 5 generation 불일치
 *   · 6 헬스 확인 실패 · 7 설정 파일의 KNOWLEDGE_WORKER_MODE 불일치 · 8 단계 명령 실패
 * exit: 0 실패 없음 · 1 실패 있음 · 2 인자·commands.json 오류
 */
import { parseArgs } from 'node:util';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { buildReceipt, missingEnv, validateCommands } from './lib.mjs';
import { runCommand } from './runner.mjs';

function fail(message) {
    console.error(`[verify-matrix] ${message}`);
    process.exit(2);
}

let values;
try {
    ({ values } = parseArgs({
        strict: true,
        options: {
            'run-id': { type: 'string' },
            'evidence-root': { type: 'string', default: '.omo/evidence/base-plugin-separation' },
            commands: { type: 'string', default: 'scripts/release/commands.json' },
            only: { type: 'string', default: '' },
            local: { type: 'boolean', default: false },
        },
    }));
} catch (e) {
    fail(e.message);
}
if (!values['run-id']) fail('--run-id 가 필요하다');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let doc;
try {
    doc = JSON.parse(readFileSync(resolve(repoRoot, values.commands), 'utf8'));
} catch (e) {
    fail(`commands.json 읽기 실패: ${e.message}`);
}
const errors = validateCommands(doc);
if (errors.length > 0) fail(`commands.json 오류:\n${errors.join('\n')}`);

const only = values.only ? values.only.split(',').map((s) => s.trim()).filter(Boolean) : [];
const unknown = only.filter((id) => !doc.commands.some((c) => c.id === id));
if (unknown.length > 0) fail(`모르는 id: ${unknown.join(', ')}`);
const selected = only.length > 0 ? doc.commands.filter((c) => only.includes(c.id)) : doc.commands;

const taskDir = resolve(repoRoot, values['evidence-root'], values['run-id'], 'task-11');
const receiptsDir = join(taskDir, 'receipts');
mkdirSync(receiptsDir, { recursive: true });
copyFileSync(resolve(repoRoot, values.commands), join(taskDir, 'commands.json'));

const runEnv = { ...process.env, RUN_ID: values['run-id'], EVIDENCE_ROOT: values['evidence-root'] };
let failed = 0;
for (const command of selected) {
    let raw;
    const missing = missingEnv(command, runEnv);
    if (values.local && command.skipLocal) raw = { skipped: 'local' };
    else if (missing.length > 0) raw = { skipped: 'env', missing };
    else {
        console.log(`[verify-matrix] ▶ ${command.id} — ${command.title}`);
        raw = await runCommand({ cmd: command.cmd, cwd: repoRoot, env: runEnv, timeoutSec: command.timeoutSec, logPath: join(receiptsDir, `${command.id}.log`) });
    }
    const receipt = buildReceipt(command, raw, { gitSha });
    writeFileSync(join(receiptsDir, `${command.id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.status === 'failed') failed += 1;
    const counts = receipt.counts ? ` (${receipt.counts.passed ?? '-'}/${receipt.counts.failed ?? '-'}/${receipt.counts.skipped ?? '-'})` : '';
    console.log(`[verify-matrix] ${receipt.status.padEnd(11)} ${command.id} ${Math.round(receipt.durationMs / 1000)}s${counts}${receipt.reason ? ` — ${receipt.reason}` : ''}`);
}
console.log(`[verify-matrix] 끝 — ${selected.length}건, 실패 ${failed}건, receipt: ${receiptsDir}`);
process.exit(failed > 0 ? 1 : 0);
