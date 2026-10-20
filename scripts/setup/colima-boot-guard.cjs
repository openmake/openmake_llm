#!/usr/bin/env node
'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */ // Plain Node CLI copied to the owner's home and run by launchd.
// ==============================================================================
// OpenMake Colima 로그인 기동 가드 — LaunchAgent com.openmake.colima 가 소유자의 node 로 직접 실행한다
// (30-toolchain.sh 가 ~/.local/share/openmake/colima-boot-guard.cjs 로 복사·등록). 다른 파일을 읽지 않는다.
// 외장 볼륨 접근 권한은 이미 승인된 node 가 갖는다 — bash 부모를 두지 않는다.
//
//   node colima-boot-guard.cjs <colima> <profile> [시작 플래그…]     (환경: COLIMA_HOME, HOME)
//
// 1) 전용 프로필 openmake 만. 기존 프로필(<COLIMA_HOME>/openmake/colima.yaml)과 기존 Lima 인스턴스
//    (<COLIMA_HOME>/_lima/colima-openmake)가 없으면 시작하지 않는다 — 새 VM 을 만들지 않는다.
// 2) 이 가드는 한 번에 하나만 돈다: /usr/bin/lockf 가 내장 HOME 의 잠금을 쥔 채 같은 node 로 이 파일을 다시 실행한다.
// 3) 지난 부팅의 비정상 종료가 남긴 ha.pid·vz.pid 만 치운다: 이 인스턴스 디렉터리 안의, 실행 사용자 소유
//    일반 파일(링크 아님)이고 mtime·ctime 이 모두 kern.boottime 보다 앞설 때. 파일 속 PID 는 보지 않는다 —
//    재부팅 뒤 그 번호는 무관한 프로세스일 수 있다. 신호를 보내지 않는다.
//    두 파일의 모습(없음 포함)을 분류 전에 잡아 두고, 분류 뒤와 옮기기 직전마다 같은지 본다 — 다르면 멈춘다.
//    이번 부팅의 파일이 있으면 치우지 않는다. 이번 부팅의 이 인스턴스 host agent 가 보이면 치우지도 시작하지도 않는다.
//    원본은 같은 볼륨의 <COLIMA_HOME>/.openmake-boot-guard/quarantine/… 로 옮겨 보관한다(0600) — 치울 때만 만든다.
// 4) 기존 프로필을 평소대로 시작하고 그 종료 코드를 돌려준다: colima start --profile openmake [플래그] --activate=false
// 하지 않는 일: 프로세스 신호·강제 정지·VM/디스크/설정 변경·다른 프로필 접근·권한 상승.
//
// 종료 코드: colima start 의 것 / 75 다른 가드 실행 중·이 인스턴스 host agent 실행 중 / 78 없음·거부
// ==============================================================================
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PROFILE = 'openmake';
const PID_FILES = ['ha.pid', 'vz.pid'];
const LOCKF = '/usr/bin/lockf';

const log = message => process.stderr.write(`${new Date().toISOString()} colima-boot-guard: ${message}\n`);
class Refusal extends Error { constructor(message, code = 78) { super(message); this.code = code; } }
const refuse = (message, code) => { throw new Refusal(message, code); };
const lstat = file => { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// 파일 하나의 모습: 종류·소유자·장치·inode·mtime·ctime(ms)·크기·내용 해시. 없으면 'absent'.
function look(file) {
    const st = lstat(file);
    if (!st) return 'absent';
    const kind = st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other';
    const hash = kind === 'file' ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : '-';
    return [kind, st.uid, st.dev, st.ino, st.mtimeMs, st.ctimeMs, st.size, hash].join('|');
}
const snapshot = inst => PID_FILES.map(n => `${n}=${look(path.join(inst, n))}`).join('\n');

function bootTimeSeconds() {
    const r = spawnSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 10000 });
    const m = r.status === 0 && /^\{ sec = (\d+),/.exec(r.stdout || '');
    if (!m) refuse('cannot read kern.boottime');
    return Number(m[1]);
}

// 이번 부팅에 이 인스턴스의 host agent(limactl hostagent …colima-openmake…)가 이 사용자로 돌고 있는가
function hostAgentRunning(uid, instanceName) {
    const r = spawnSync('ps', ['-axo', 'uid=,command='], { encoding: 'utf8', timeout: 10000 });
    if (r.status !== 0) refuse('cannot list processes to check for a running host agent');
    return r.stdout.split('\n').some(line => {
        const words = line.trim().split(/\s+/);
        return words[0] === String(uid) && /(limactl|hostagent)/.test(line)
            && words.slice(1).some(w => w === instanceName || w.includes(`/${instanceName}/`));
    });
}

function realDir(dir, what) {
    const st = lstat(dir);
    if (st && st.isSymbolicLink()) refuse(`${dir} is a symlink`);
    if (!st || !st.isDirectory()) refuse(`${what} is missing (no replacement VM)`);
}

function guardAndStart(colima, flags) {
    const home = process.env.COLIMA_HOME;
    const lima = path.join(home, '_lima'); const instanceName = `colima-${PROFILE}`; const inst = path.join(lima, instanceName);
    realDir(lima, `Lima instance ${inst}`); realDir(inst, `Lima instance ${inst}`);
    const yaml = lstat(path.join(inst, 'lima.yaml'));
    if (!yaml || !yaml.isFile()) refuse(`Lima instance ${inst} has no lima.yaml (no replacement VM)`);

    const uid = process.getuid();
    const initial = snapshot(inst);
    const boot = bootTimeSeconds(); const bootMs = boot * 1000;
    const stale = []; let current = false;
    for (const n of PID_FILES) {
        const file = path.join(inst, n); const st = lstat(file);
        if (!st) continue;
        if (st.isSymbolicLink() || !st.isFile()) refuse(`${file} is not a regular file`);
        if (st.uid !== uid) refuse(`${file} is owned by uid ${st.uid}, not ${uid}`);
        if (st.mtimeMs < bootMs && st.ctimeMs < bootMs) stale.push({ n, file, st });
        else { current = true; log(`${file} is from the current boot (mtimeMs ${st.mtimeMs}, ctimeMs ${st.ctimeMs}, boot ${boot}); left for colima`); }
    }

    if (stale.length && !current) {
        if (snapshot(inst) !== initial) refuse(`${inst} pid files changed while they were being checked`);
        if (hostAgentRunning(uid, instanceName)) refuse(`a host agent for ${instanceName} is running in this boot but its pid files predate the boot`, 75);
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
        const quarantine = path.join(home, '.openmake-boot-guard', 'quarantine', `${instanceName}-boot${boot}-${stamp}-${process.pid}`);
        const top = path.join(home, '.openmake-boot-guard');
        if (lstat(top) && lstat(top).isSymbolicLink()) refuse(`${top} is a symlink`);
        fs.mkdirSync(quarantine, { recursive: true, mode: 0o700 });
        if (fs.statSync(quarantine).dev !== fs.statSync(inst).dev) refuse(`${quarantine} is on another volume than ${inst} (rename would not be atomic)`);
        const evidence = [`boottime=${boot} user=${uid} instance=${inst}`,
            ...stale.map(({ n, st }) => `${n} uid=${st.uid} dev=${st.dev} inode=${st.ino} mtimeMs=${st.mtimeMs} ctimeMs=${st.ctimeMs} size=${st.size} fingerprint=${look(path.join(inst, n))}`)];
        fs.writeFileSync(path.join(quarantine, 'evidence.txt'), `${evidence.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
        let expected = initial;
        for (const { n, file } of stale) {
            // 바로 직전에 두 파일을 모두 다시 본다 — 이미 옮긴 파일은 없어야 한다.
            if (snapshot(inst) !== expected) refuse(`${inst} pid files changed after they were checked; left as is (evidence in ${quarantine})`);
            fs.renameSync(file, path.join(quarantine, n));
            fs.chmodSync(path.join(quarantine, n), 0o600);
            log(`quarantined stale ${file} from before boot ${boot} to ${path.join(quarantine, n)} (metadata in evidence.txt)`);
            expected = expected.replace(new RegExp(`^${n.replace('.', '\\.')}=.*$`, 'm'), `${n}=absent`);
        }
    }

    const r = spawnSync(colima, ['start', '--profile', PROFILE, ...flags, '--activate=false'], { stdio: 'inherit' });
    if (r.error) refuse(`could not run ${colima}: ${r.error.message}`);
    return r.status === null ? 1 : r.status;
}

function main(argv) {
    if (argv.length < 2) refuse('usage: colima-boot-guard.cjs <colima> <profile> [start flags...]');
    const [colima, profile, ...flags] = argv;
    // 전용 프로필만 — 기본 프로필(colima)·다른 프로필·경로는 잠금·상태도 만들지 않고 거부한다.
    if (profile !== PROFILE) refuse(`only the dedicated OpenMake profile '${PROFILE}' is handled (got '${profile}'); other profiles are left untouched`);
    const home = process.env.COLIMA_HOME;
    if (!home) refuse('COLIMA_HOME is not set');
    if (!fs.existsSync(path.join(home, PROFILE, 'colima.yaml'))) {
        process.stderr.write(`OpenMake Colima profile ${PROFILE} is missing under ${home}; not starting (no replacement VM)\n`);
        return 78;
    }
    if (process.env.OMK_COLIMA_GUARD_LOCKED !== PROFILE) {
        if (!process.env.HOME) refuse('HOME is not set');
        const locks = path.join(process.env.HOME, '.local', 'share', 'openmake', '.locks');
        fs.mkdirSync(locks, { recursive: true, mode: 0o700 });
        if (lstat(locks).isSymbolicLink()) refuse(`${locks} is a symlink`);
        // 잠금을 쥔 채 같은 node 로 다시 실행한다 — 이미 쥐고 있으면 lockf 가 75 로 끝난다.
        const r = spawnSync(LOCKF, ['-t', '0', path.join(locks, `colima-${PROFILE}.lock`), process.execPath, __filename, ...argv],
            { stdio: 'inherit', env: { ...process.env, OMK_COLIMA_GUARD_LOCKED: PROFILE } });
        if (r.error) refuse(`could not run ${LOCKF}: ${r.error.message}`);
        return r.status === null ? 1 : r.status;
    }
    delete process.env.OMK_COLIMA_GUARD_LOCKED;
    return guardAndStart(colima, flags);
}

try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    log(`error: ${e.message}; not starting${e instanceof Refusal ? ', nothing more was removed (VM left untouched)' : ''}`);
    process.exitCode = e instanceof Refusal ? e.code : 78;
}
