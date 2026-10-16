#!/usr/bin/env node
/**
 * receipt 들로 release-candidate.md 를 만든다(로드맵 작업 11 증거).
 *   node scripts/release/release-candidate.mjs --run-id <id> [--evidence-root …] [--acceptances <file>]
 * stdout 첫 줄 "verdict: <판정>". receipt 들의 git SHA 가 섞였으면 머리말에 모두 적고 "판단이 필요한 항목" 에 한 줄을 둔다.
 * exit 0 작성 · 2 입력 없음·형식 오류(receipt 디렉터리·task-11/commands.json 없음, commands.json·acceptances JSON 깨짐·스키마 오류)
 */
import { parseArgs } from 'node:util';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { candidateVerdict, renderReleaseCandidate, validateAcceptances, validateCommands } from './lib.mjs';

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
// JSON 파일 읽기·파싱 실패는 입력 오류(exit 2)다 — 잡지 않으면 node 기본 exit 1 이 된다
function readJson(path, label) {
    if (!existsSync(path)) fail(`${label} 없음: ${path}`);
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        return fail(`${label} 읽기 실패: ${e.message}`);
    }
}

const commandsDoc = readJson(join(taskDir, 'commands.json'), 'commands.json');
const cmdErrors = validateCommands(commandsDoc);
if (cmdErrors.length > 0) fail(`commands.json 오류:\n${cmdErrors.join('\n')}`);

const receiptFiles = readdirSync(receiptsDir).filter((f) => f.endsWith('.json'));
const receipts = commandsDoc.commands
    .map((c) => (receiptFiles.includes(`${c.id}.json`) ? readJson(join(receiptsDir, `${c.id}.json`), `receipt ${c.id}`) : null))
    .filter(Boolean);
const notRun = commandsDoc.commands.filter((c) => !receiptFiles.includes(`${c.id}.json`)).map((c) => c.id);
if (notRun.length > 0) fail(`receipt 가 없는 명령: ${notRun.join(', ')} — verify-matrix 를 이 run-id 로 먼저 돌린다`);

let acceptances = { schemaVersion: 1, items: {} };
if (values.acceptances) {
    acceptances = readJson(resolve(repoRoot, values.acceptances), 'acceptances');
    const errors = validateAcceptances(acceptances);
    if (errors.length > 0) fail(`acceptances 오류:\n${errors.join('\n')}`);
}

// 머리말의 SHA 는 receipt 들에서 렌더러가 모은다(섞였으면 모두). meta.gitSha 는 receipt 가 없을 때만 쓰인다
const gitSha = receipts[0]?.gitSha ?? 'unknown';
const md = renderReleaseCandidate({ meta: { runId: values['run-id'], gitSha, createdAt: new Date().toISOString() }, receipts, commandsDoc, acceptances });
writeFileSync(join(taskDir, 'release-candidate.md'), md);
console.log(`verdict: ${candidateVerdict(receipts, acceptances)}`);
console.log(`[release-candidate] 작성: ${join(taskDir, 'release-candidate.md')}`);
