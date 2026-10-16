import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    validateCommands, missingEnv, parseCounts, buildReceipt, redactSecrets,
    classify, validateAcceptances, decideVerdict, renderReleaseCandidate,
} from './lib.mjs';
import { runCommand } from './runner.mjs';

const JEST = { anchor: '^Tests:.*$', keysOn: 'anchor', passed: '(\\d+) passed', failed: '(\\d+) failed', skipped: '(\\d+) skipped' };
const NODE = { anchor: '^ℹ tests \\d+', keysOn: 'output', passed: '^ℹ pass (\\d+)', failed: '^ℹ fail (\\d+)', skipped: '^ℹ skipped (\\d+)' };

function cmd(overrides = {}) {
    return { id: 'jest-api', title: 'API Jest', group: 'unit', cmd: 'true', timeoutSec: 60, requiresEnv: [], skipLocal: null, counts: JEST, covers: ['예약'], ...overrides };
}
const doc = (commands) => ({ schemaVersion: 1, matrixRows: ['예약', '롤백'], commands });
const meta = { gitSha: 'a'.repeat(40) };
const raw = (o = {}) => ({ exitCode: 0, signal: null, timedOut: false, durationMs: 5, startedAt: 's', finishedAt: 'f', output: '', ...o });

test('validateCommands: 올바른 문서는 오류 없음, 중복 id·모르는 group·모르는 covers·깨진 정규식은 오류', () => {
    assert.deepEqual(validateCommands(doc([cmd()])), []);
    assert.ok(validateCommands(doc([cmd(), cmd()])).some((e) => e.includes('중복')));
    assert.ok(validateCommands(doc([cmd({ group: 'x' })])).some((e) => e.includes('group')));
    assert.ok(validateCommands(doc([cmd({ covers: ['없는 행'] })])).some((e) => e.includes('covers')));
    assert.ok(validateCommands(doc([cmd({ counts: { ...JEST, passed: '(' } })])).some((e) => e.includes('정규식')));
});

test('missingEnv: 비었거나 없는 env 이름만 돌려준다', () => {
    assert.deepEqual(missingEnv(cmd({ requiresEnv: ['A', 'B', 'C'] }), { A: 'x', B: '' }), ['B', 'C']);
});

test('parseCounts: Jest 요약 줄 — 없는 항목은 0', () => {
    const out = 'Test Suites: 3 passed, 3 total\nTests:       2 failed, 4321 passed, 4323 total\n';
    assert.deepEqual(parseCounts(out, JEST), { passed: 4321, failed: 2, skipped: 0 });
});

test('parseCounts: node --test 요약 줄', () => {
    const out = 'ℹ tests 11\nℹ suites 0\nℹ pass 10\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\n';
    assert.deepEqual(parseCounts(out, NODE), { passed: 10, failed: 0, skipped: 1 });
});

test('parseCounts: 요약 줄을 못 찾으면 모두 null, spec 이 null 이면 null', () => {
    assert.deepEqual(parseCounts('crash before summary', JEST), { passed: null, failed: null, skipped: null });
    assert.equal(parseCounts('anything', null), null);
});

test('redactSecrets: URL 비밀번호를 가린다', () => {
    assert.equal(redactSecrets('postgresql://openmake:secret@localhost:5433/db ok'), 'postgresql://openmake:***@localhost:5433/db ok');
});

test('buildReceipt: exit 0 은 passed, exit≠0·timeout 은 failed', () => {
    assert.equal(buildReceipt(cmd(), raw({ output: 'Tests: 5 passed, 5 total' }), meta).status, 'passed');
    const failed = buildReceipt(cmd(), raw({ exitCode: 1 }), meta);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.reason, 'exit 1');
    const timeout = buildReceipt(cmd(), raw({ exitCode: null, signal: 'SIGKILL', timedOut: true }), meta);
    assert.equal(timeout.status, 'failed');
    assert.equal(timeout.timedOut, true);
    assert.match(timeout.reason, /시간 초과/);
});

test('buildReceipt: 로컬 정책·env 부재는 실행하지 않은 receipt', () => {
    const local = buildReceipt(cmd({ skipLocal: '이 맥북은 빌드하지 않는다' }), { skipped: 'local' }, meta);
    assert.equal(local.status, 'unmeasured');
    assert.equal(local.exitCode, null);
    const env = buildReceipt(cmd({ requiresEnv: ['X'] }), { skipped: 'env', missing: ['X'] }, meta);
    assert.equal(env.status, 'env_missing');
    assert.equal(env.reason, 'env 없음: X');
});

test('classify: skip 수를 못 읽으면 "skip 수 미확인"(0 으로 치지 않는다)', () => {
    const r = buildReceipt(cmd(), raw({ output: 'no summary here' }), meta);
    assert.equal(r.counts.skipped, null);
    assert.equal(classify(r).category, 'skip 수 미확인');
    assert.equal(classify(buildReceipt(cmd(), raw({ output: 'Tests: 1 skipped, 5 passed, 6 total' }), meta)).category, '통과(skip 있음)');
    assert.equal(classify(buildReceipt(cmd({ counts: null }), raw(), meta)).category, '통과');
});

test('classify·decideVerdict: 수용은 맞는 종류만, 실패가 있으면 후보 아님', () => {
    const failed = buildReceipt(cmd(), raw({ exitCode: 1 }), meta);
    const unmeasured = buildReceipt(cmd({ id: 'build-full', skipLocal: '로컬 정책' }), { skipped: 'local' }, meta);
    const passed = buildReceipt(cmd({ id: 'ok', counts: null }), raw(), meta);
    assert.equal(classify(failed, { kind: 'pre-existing', reason: 'r', evidence: 'e' }).accepted, true);
    assert.equal(classify(failed, { kind: 'deferred', reason: 'r', evidence: 'e' }).accepted, false);
    assert.equal(decideVerdict([classify(passed)]), '후보');
    assert.equal(decideVerdict([classify(passed), classify(unmeasured)]), '판단 대기');
    assert.equal(decideVerdict([classify(passed), classify(unmeasured, { kind: 'deferred', reason: 'CI Gate 2', evidence: 'run url' })]), '조건부 후보');
    assert.equal(decideVerdict([classify(passed), classify(failed)]), '릴리스 후보 아님');
});

test('validateAcceptances: kind·reason·evidence 가 없으면 오류', () => {
    assert.deepEqual(validateAcceptances({ schemaVersion: 1, items: { a: { kind: 'deferred', reason: 'r', evidence: 'e' } } }), []);
    assert.ok(validateAcceptances({ schemaVersion: 1, items: { a: { kind: 'later', reason: '', evidence: '' } } }).length >= 2);
});

test('renderReleaseCandidate: 판정·분류 표·매트릭스 행별 증거·판단 필요 항목', () => {
    const d = doc([cmd(), cmd({ id: 'drill', covers: ['롤백'], counts: null })]);
    const receipts = [
        buildReceipt(d.commands[0], raw({ output: 'Tests: 5 passed, 5 total' }), meta),
        buildReceipt(d.commands[1], { skipped: 'env', missing: ['KNOWLEDGE_PSQL'] }, meta),
    ];
    const md = renderReleaseCandidate({ meta: { runId: 'r1', gitSha: meta.gitSha, createdAt: 't' }, receipts, commandsDoc: d, acceptances: { schemaVersion: 1, items: {} } });
    assert.ok(md.includes('판정: **판단 대기**'));
    assert.ok(md.includes('| jest-api | unit | passed | 통과 |'));
    assert.ok(md.includes('| 롤백 | drill(환경 부재) | 증거 없음 |'));
    assert.ok(md.includes('- drill — 환경 부재: env 없음: KNOWLEDGE_PSQL'));
});

test('runCommand: 출력·exit 를 남기고, 시간 초과는 죽이고 timedOut', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-run-'));
    const ok = await runCommand({ cmd: 'echo hello; exit 3', cwd: dir, env: process.env, timeoutSec: 10, logPath: join(dir, 'ok.log') });
    assert.equal(ok.exitCode, 3);
    assert.equal(ok.timedOut, false);
    assert.match(readFileSync(join(dir, 'ok.log'), 'utf8'), /hello/);
    const slow = await runCommand({ cmd: 'sleep 30', cwd: dir, env: process.env, timeoutSec: 1, logPath: join(dir, 'slow.log') });
    assert.equal(slow.timedOut, true);
    assert.ok(slow.durationMs < 15_000);
});

test('runCommand: 끝나면 로그 파일이 출력 전부를 담고 있다(WriteStream finish 대기)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-run-'));
    const logPath = join(dir, 'big.log');
    const res = await runCommand({ cmd: 'for i in $(seq 1 20000); do echo "line-$i"; done', cwd: dir, env: process.env, timeoutSec: 30, logPath });
    assert.equal(res.exitCode, 0);
    const log = readFileSync(logPath, 'utf8');
    assert.equal(log, res.output);
    assert.ok(log.endsWith('line-20000\n'));
});

// commands.json 자체의 약속 — 컨트롤러 판정(R5·R6·R13·R16·R2)
const commandsDoc = JSON.parse(readFileSync(new URL('./commands.json', import.meta.url), 'utf8'));

test('commands.json: 스키마가 맞다', () => {
    assert.deepEqual(validateCommands(commandsDoc), []);
});

test('commands.json: jest-api·db-tests 는 모든 e2e·live 명령보다 앞에 둔다(공유 테스트 DB)', () => {
    const ids = commandsDoc.commands.map((c) => c.id);
    const firstLive = commandsDoc.commands.findIndex((c) => c.group === 'e2e' || c.group === 'live');
    assert.ok(firstLive > 0);
    assert.ok(ids.indexOf('jest-api') < firstLive);
    assert.ok(ids.indexOf('db-tests') < firstLive);
});

test('commands.json: e2e-all 은 chromium 만, 패턴 kill 은 쓰지 않는다', () => {
    assert.equal(commandsDoc.commands.find((c) => c.id === 'e2e-all').cmd, 'npm run test:e2e -- --project=chromium');
    assert.ok(commandsDoc.commands.every((c) => !/pkill|killall/.test(c.cmd)));
});

test('commands.json: 드릴 왕복은 증거 디렉터리의 설정 파일로 모드를 맞춘 뒤 전환한다', () => {
    const drill = commandsDoc.commands.find((c) => c.id === 'drill-worker-roundtrip').cmd;
    assert.match(drill, /KNOWLEDGE_DRILL_ENV_FILE="\$EVIDENCE_ROOT\/\$RUN_ID\/task-11\/drill\.env"/);
    const ext = drill.indexOf('KNOWLEDGE_WORKER_MODE=external');
    const toExt = drill.indexOf('rollback-drill.sh to-external');
    const inp = drill.indexOf('KNOWLEDGE_WORKER_MODE=inprocess');
    const toInp = drill.indexOf('rollback-drill.sh to-inprocess');
    assert.ok(ext >= 0 && ext < toExt && toExt < inp && inp < toInp);
});

test('commands.json: bench-compare 가 환경 부재면 "성능" 행은 증거 없음(test-infra 만으로 증거 삼지 않는다)', () => {
    const receipts = commandsDoc.commands.map((c) => (c.id === 'bench-compare'
        ? buildReceipt(c, { skipped: 'env', missing: ['BENCH_BASELINE'] }, meta)
        : buildReceipt(c, raw({ output: 'Tests: 1 passed, 1 total\nℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\ndb tests ran: 1 (passed 1, failed 0, skipped 0)\n  1 passed' }), meta)));
    const md = renderReleaseCandidate({ meta: { runId: 'r', gitSha: meta.gitSha, createdAt: 't' }, receipts, commandsDoc, acceptances: { schemaVersion: 1, items: {} } });
    assert.match(md, /^\| 성능 \| [^\n]*\| 증거 없음 \|$/m);
});
