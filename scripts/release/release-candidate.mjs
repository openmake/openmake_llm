#!/usr/bin/env node
/**
 * receipt 들로 release-candidate.md 를 만든다(로드맵 작업 11 증거).
 *   node scripts/release/release-candidate.mjs --run-id <id> [--evidence-root …] [--acceptances <file>]
 * stdout 첫 줄 "verdict: <판정>". exit 0 작성 · 2 입력 없음·형식 오류
 */
import { parseArgs } from 'node:util';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { decideVerdict, classify, renderReleaseCandidate, validateAcceptances, validateCommands } from './lib.mjs';

function fail(message) {
    console.error(`[release-candidate] ${message}`);
    process.exit(2);
}

let values;
try {
    ({ values } = parseArgs({
        strict: true,
        options: {
            'run-id': { type: 'string' },
            'evidence-root': { type: 'string', default: '.omo/evidence/base-plugin-separation' },
            acceptances: { type: 'string', default: '' },
        },
    }));
} catch (e) {
    fail(e.message);
}
if (!values['run-id']) fail('--run-id 가 필요하다');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const taskDir = resolve(repoRoot, values['evidence-root'], values['run-id'], 'task-11');
const receiptsDir = join(taskDir, 'receipts');
if (!existsSync(receiptsDir)) fail(`receipt 디렉터리 없음: ${receiptsDir}`);
const commandsDoc = JSON.parse(readFileSync(join(taskDir, 'commands.json'), 'utf8'));
const cmdErrors = validateCommands(commandsDoc);
if (cmdErrors.length > 0) fail(`commands.json 오류:\n${cmdErrors.join('\n')}`);

const receiptFiles = readdirSync(receiptsDir).filter((f) => f.endsWith('.json'));
const receipts = commandsDoc.commands
    .map((c) => (receiptFiles.includes(`${c.id}.json`) ? JSON.parse(readFileSync(join(receiptsDir, `${c.id}.json`), 'utf8')) : null))
    .filter(Boolean);
const notRun = commandsDoc.commands.filter((c) => !receiptFiles.includes(`${c.id}.json`)).map((c) => c.id);
if (notRun.length > 0) fail(`receipt 가 없는 명령: ${notRun.join(', ')} — verify-matrix 를 이 run-id 로 먼저 돌린다`);

let acceptances = { schemaVersion: 1, items: {} };
if (values.acceptances) {
    acceptances = JSON.parse(readFileSync(resolve(repoRoot, values.acceptances), 'utf8'));
    const errors = validateAcceptances(acceptances);
    if (errors.length > 0) fail(`acceptances 오류:\n${errors.join('\n')}`);
}

const gitSha = receipts[0]?.gitSha ?? 'unknown';
const md = renderReleaseCandidate({ meta: { runId: values['run-id'], gitSha, createdAt: new Date().toISOString() }, receipts, commandsDoc, acceptances });
writeFileSync(join(taskDir, 'release-candidate.md'), md);
console.log(`verdict: ${decideVerdict(receipts.map((r) => classify(r, acceptances.items[r.id])))}`);
console.log(`[release-candidate] 작성: ${join(taskDir, 'release-candidate.md')}`);
