import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    validateCommands, missingEnv, parseCounts, buildReceipt, redactSecrets,
    classify, validateAcceptances, decideVerdict, renderReleaseCandidate, candidateVerdict,
} from './lib.mjs';
import { createChunkMasker, runCommand } from './runner.mjs';

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

test('renderReleaseCandidate: receipt 의 git SHA 가 섞이면 머리말에 모두 적고 판단 대기로 둔다', () => {
    const d = doc([cmd(), cmd({ id: 'drill', group: 'drill', counts: null, covers: ['롤백'] })]);
    const receipts = [
        buildReceipt(cmd(), raw({ output: 'Tests: 3 passed, 3 total' }), { gitSha: 'a'.repeat(40) }),
        buildReceipt(d.commands[1], raw(), { gitSha: 'b'.repeat(40) }),
    ];
    const md = renderReleaseCandidate({ meta: { runId: 'r', gitSha: 'a'.repeat(40), createdAt: 't' }, receipts, commandsDoc: d, acceptances: { schemaVersion: 1, items: {} } });
    assert.ok(md.includes(`- git SHA: **섞임(2개)** — \`${'a'.repeat(40)}\`, \`${'b'.repeat(40)}\``));
    assert.ok(md.includes('판정: **판단 대기**'));
    assert.match(md, /## 판단이 필요한 항목\n\n- git SHA 혼합 — .*jest-api.*drill/);
    assert.equal(candidateVerdict(receipts, { schemaVersion: 1, items: {} }), '판단 대기');
    // 한 SHA 면 종전대로 후보
    assert.equal(candidateVerdict([receipts[0]], { schemaVersion: 1, items: {} }), '후보');
});

const RC_SCRIPT = fileURLToPath(new URL('./release-candidate.mjs', import.meta.url));
function runReleaseCandidate(setup, extraArgs = []) {
    const root = mkdtempSync(join(tmpdir(), 'release-rc-'));
    const taskDir = join(root, 'r1', 'task-11');
    mkdirSync(join(taskDir, 'receipts'), { recursive: true });
    setup(taskDir, root);
    return spawnSync(process.execPath, [RC_SCRIPT, '--run-id', 'r1', '--evidence-root', root, ...extraArgs], { encoding: 'utf8' });
}

test('release-candidate: task-11/commands.json 이 없거나 acceptances JSON 이 깨지면 exit 2(입력 오류)', () => {
    const missing = runReleaseCandidate(() => {});
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /commands\.json 없음/);
    const one = doc([cmd()]);
    const root2 = mkdtempSync(join(tmpdir(), 'release-rc-acc-'));
    writeFileSync(join(root2, 'acc.json'), '{ 깨진 JSON');
    const bad = runReleaseCandidate((taskDir) => {
        writeFileSync(join(taskDir, 'commands.json'), JSON.stringify(one));
        writeFileSync(join(taskDir, 'receipts', 'jest-api.json'), JSON.stringify(buildReceipt(cmd(), raw(), meta)));
    }, ['--acceptances', join(root2, 'acc.json')]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /acceptances 읽기 실패/);
});

test('createChunkMasker: 두 청크로 갈린 URL 의 비밀번호도 가린다', () => {
    const out = [];
    // runner 와 같이 내보낸 조각마다 가린다 — 조각이 URL 을 가르지 않아야 가려진다
    const m = createChunkMasker((t) => out.push(redactSecrets(t)));
    m.push(Buffer.from('connect postgresql://openmake:sec'));
    m.push(Buffer.from('ret@localhost:5433/db ok\n'));
    m.flush();
    const joined = out.join('');
    assert.equal(joined.includes('secret'), false);
    assert.ok(joined.includes('connect '));
    assert.ok(joined.endsWith('ok\n'));
});

test('runCommand: 두 번의 write 로 갈린 URL 비밀번호가 출력·로그에 남지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-run-'));
    const logPath = join(dir, 'split.log');
    const res = await runCommand({ cmd: "printf 'url=postgresql://u:sec'; sleep 0.3; printf 'ret@h:5433/db\\n'", cwd: dir, env: process.env, timeoutSec: 10, logPath });
    assert.equal(res.exitCode, 0);
    assert.equal(res.output, 'url=postgresql://u:***@h:5433/db\n');
    assert.equal(readFileSync(logPath, 'utf8'), res.output);
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

test('commands.json: 드릴 스크립트를 부르는 명령은 모두 KNOWLEDGE_DRILL_ENV_FILE 을 증거 디렉터리로 둔다(저장소 .env 를 읽지 않게)', () => {
    const drills = commandsDoc.commands.filter((c) => c.cmd.includes('knowledge-worker-rollback-drill.sh'));
    assert.ok(drills.length >= 2);
    for (const c of drills) {
        assert.ok(c.cmd.includes('KNOWLEDGE_DRILL_ENV_FILE="$EVIDENCE_ROOT/$RUN_ID/task-11/drill.env"'), c.id);
        assert.ok(c.cmd.indexOf('KNOWLEDGE_DRILL_ENV_FILE=') < c.cmd.indexOf('knowledge-worker-rollback-drill.sh'), c.id);
    }
});

test('commands.json: db-tests 요약 줄 전체를 읽어 통과·실패·skip 수를 센다(run-db-tests.mjs 형식)', () => {
    const spec = commandsDoc.commands.find((c) => c.id === 'db-tests').counts;
    const out = 'some log\ndb tests ran: 7 (passed 5, failed 1, skipped 1, files 3)\n';
    assert.deepEqual(parseCounts(out, spec), { passed: 5, failed: 1, skipped: 1 });
});

test('parseCounts: keysOn anchor 면 anchor 가 잡은 줄 전체를 읽는다 — 접두만 잡는 anchor·$ 없는 동치 형태도 같은 결과', () => {
    const out = 'Tests: 1 passed, 1 total\nmore\nTests:       2 failed, 4321 passed, 1 skipped, 4324 total\n';
    const want = { passed: 4321, failed: 2, skipped: 1 };
    for (const anchor of ['^Tests:.*$', '^Tests: ', '^Tests:[^\\n]*', '^Tests:.*']) {
        assert.deepEqual(validateCommands(doc([cmd({ counts: { ...JEST, anchor } })])), [], anchor);
        assert.deepEqual(parseCounts(out, { ...JEST, anchor }), want, anchor);
    }
    assert.deepEqual(validateCommands(doc([cmd({ counts: { ...NODE, anchor: '^ℹ tests \\d+' } })])), []);
});

test('parseCounts: anchor 가 줄바꿈부터 잡아도(\\s*·\\n? 로 시작) 앞 줄이 아니라 anchor 가 든 줄을 읽는다', () => {
    const out = 'Tests: 1 passed, 1 total\nmore\n\nTests:       2 failed, 4321 passed, 1 skipped, 4324 total\n';
    const want = { passed: 4321, failed: 2, skipped: 1 };
    for (const anchor of ['\\s*Tests:', '\\n?Tests:', '\\s*^Tests:.*$']) {
        assert.deepEqual(parseCounts(out, { ...JEST, anchor }), want, anchor);
    }
    assert.deepEqual(parseCounts(out.replace(/\n/g, '\r\n'), { ...JEST, anchor: '\\s*Tests:' }), want, 'CRLF');
});

test('validateCommands: null·객체 아닌 항목은 예외가 아니라 검증 오류', () => {
    for (const bad of [null, 42, 'x']) {
        const errs = validateCommands(doc([cmd(), bad]));
        assert.ok(errs.some((e) => e.includes('객체')), String(bad));
    }
});

test('validateCommands: counts 의 passed·failed·skipped 정규식에 캡처 그룹이 없으면 오류', () => {
    for (const k of ['passed', 'failed', 'skipped']) {
        const errs = validateCommands(doc([cmd({ counts: { ...JEST, [k]: '\\d+ ' + k } })]));
        assert.ok(errs.some((e) => e.includes(`counts.${k}`) && e.includes('캡처')), k);
    }
});

test('parseCounts: 캡처가 숫자가 아니면 NaN 이 아니라 null(미확인)', () => {
    const spec = { ...JEST, skipped: '(skipped)' };
    const got = parseCounts('Tests: 3 passed, 1 skipped, 4 total\n', spec);
    assert.deepEqual(got, { passed: 3, failed: 0, skipped: null });
});

test('createChunkMasker: 청크 경계에서 갈린 한글 멀티바이트 문자가 깨지지 않는다', () => {
    const text = '한글 출력 검증 — 통과\n';
    const bytes = Buffer.from(text, 'utf8');
    const out = [];
    const m = createChunkMasker((t) => out.push(t));
    m.push(bytes.subarray(0, 1));
    m.push(bytes.subarray(1, 8));
    m.push(bytes.subarray(8));
    m.flush();
    const joined = out.join('');
    assert.equal(joined.includes('\uFFFD'), false);
    assert.equal(joined, text);
});

test('runCommand: spawn 실패(없는 cwd → ENOENT)는 예외 없이 실패 결과로 돌아온다', async () => {
    // bash 는 늘 있으므로 없는 cwd 로 spawn 자체를 실패시킨다 — 어느 환경에서나 ENOENT 로 결정적이다
    const dir = mkdtempSync(join(tmpdir(), 'release-run-'));
    const res = await runCommand({ cmd: 'echo never', cwd: join(dir, 'no-such-dir'), env: process.env, timeoutSec: 10, logPath: join(dir, 'err.log') });
    assert.equal(res.exitCode, null);
    assert.equal(res.signal, null);
    assert.equal(res.timedOut, false);
    assert.match(res.output, /ENOENT/);
    assert.equal(readFileSync(join(dir, 'err.log'), 'utf8'), res.output);
    assert.equal(buildReceipt(cmd(), res, meta).status, 'failed');
});

test('runCommand: spawn 뒤에 온 \'error\'(kill 실패 등)는 프로세스 그룹을 끝낸 뒤 실패 결과로 한 번만 돌아온다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-run-'));
    let child;
    // spawn 은 그대로 쓰고 자식만 붙잡는다 — 'spawn' 이 온 뒤 'error' 를 흉내 낸다
    const spawnImpl = (...args) => {
        child = spawn(...args);
        child.once('spawn', () => child.emit('error', new Error('흉내 낸 kill 실패')));
        return child;
    };
    const res = await runCommand({ cmd: 'sleep 30 & sleep 30; wait', cwd: dir, env: process.env, timeoutSec: 60, logPath: join(dir, 'late.log'), spawnImpl });
    const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };
    try {
        assert.equal(groupAlive(), false, '프로세스 그룹이 남았다');
        assert.equal(res.exitCode, null);
        assert.equal(res.timedOut, false);
        assert.ok(res.durationMs < 15_000);
        assert.match(res.output, /실행 실패: 흉내 낸 kill 실패/);
        assert.equal(buildReceipt(cmd(), res, meta).status, 'failed');
    } finally {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝남 */ }
    }
});
