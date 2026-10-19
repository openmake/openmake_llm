/**
 * 명령 한 건 실행 — bash -c 로 돌리고 stdout·stderr 를 로그 파일과 메모리에 함께 남긴다.
 * 시간 초과면 SIGTERM, 10초 뒤에도 살아 있으면 SIGKILL(프로세스 그룹 전체).
 * bash 가 먼저 끝나도 그룹에 남은 프로세스가 있으면 SIGKILL 을 보낸 뒤에 결과를 돌려준다.
 * 로그 WriteStream 의 'finish'(end 콜백)를 기다린 뒤에 결과를 돌려준다.
 * spawn 자체가 실패하면('error' — 없는 cwd·EAGAIN 등) 예외 없이 exitCode null 의 실패 결과로 돌려준다.
 * spawn 뒤에 'error' 가 오면 시간 초과와 같은 순서로 프로세스 그룹을 끝낸 뒤 exitCode null 의 실패 결과로 돌려준다.
 * spawnImpl 은 테스트용 이음매다(기본 node:child_process spawn) — 테스트가 자식에 'error' 를 흉내 내려고 넘긴다.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { redactSecrets } from './lib.mjs';

const KILL_GRACE_MS = 10_000;
// 공백 없는 꼬리를 이만큼까지 붙잡아 둔다 — URL 이 청크 경계에서 잘려도 다음 청크와 합친 뒤 가린다
const MAX_HELD_TAIL = 4096;

/**
 * 스트림 하나의 청크를 받아 마지막 공백 문자 뒤 꼬리를 다음 청크와 합칠 때까지 붙잡는다.
 * 비밀번호가 든 URL 은 공백을 품지 않으므로, 공백까지 끊어 내보내면 URL 이 두 청크로 갈려 가리기를 피하지 못한다.
 * 꼬리가 MAX_HELD_TAIL 을 넘으면(공백 없는 긴 출력) 그대로 내보낸다. 끝나면 flush 로 남은 꼬리를 내보낸다.
 * 스트림마다 StringDecoder 하나로 이어 디코딩한다 — 청크 경계에서 갈린 멀티바이트(한글) 문자가 U+FFFD 로 깨지지 않게.
 */
export function createChunkMasker(emit) {
    const decoder = new StringDecoder('utf8');
    let held = '';
    return {
        push(buf) {
            const text = held + decoder.write(buf);
            const cut = text.search(/\s(?=\S*$)/);
            if (cut === -1) {
                if (text.length > MAX_HELD_TAIL) { held = ''; emit(text); } else held = text;
                return;
            }
            held = text.slice(cut + 1);
            emit(text.slice(0, cut + 1));
            if (held.length > MAX_HELD_TAIL) { emit(held); held = ''; }
        },
        flush() {
            const rest = held + decoder.end();
            held = '';
            emit(rest);
        },
    };
}

export function runCommand({ cmd, cwd, env, timeoutSec, logPath, spawnImpl = spawn }) {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath);
    const startedAt = new Date();
    return new Promise((resolve) => {
        const child = spawnImpl('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const emit = (text) => {
            if (!text) return;
            const masked = redactSecrets(text);
            chunks.push(masked);
            log.write(masked);
        };
        const stdoutMask = createChunkMasker(emit);
        const stderrMask = createChunkMasker(emit);
        child.stdout.on('data', stdoutMask.push);
        child.stderr.on('data', stderrMask.push);
        let timedOut = false;
        let killTimer = null;
        let killSent = false;
        // bash 가 먼저 끝났는데 그룹이 남아 SIGKILL 을 기다리는 동안의 'close' 결과
        let pendingClose = null;
        const groupAlive = () => {
            try { process.kill(-child.pid, 0); return true; } catch { return false; }
        };
        // 프로세스 그룹 전체에 SIGTERM, KILL_GRACE_MS 뒤에도 살아 있으면 SIGKILL
        const terminateGroup = () => {
            try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ }
            killTimer = setTimeout(() => {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝남 */ }
                killSent = true;
                if (pendingClose) finish(...pendingClose);
            }, KILL_GRACE_MS);
        };
        const timer = setTimeout(() => {
            timedOut = true;
            terminateGroup();
        }, timeoutSec * 1000);
        // 'error' 뒤에 'close' 가 와도 한 번만 끝낸다
        let settled = false;
        const finish = (code, signal, extra = '') => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            stdoutMask.flush();
            stderrMask.flush();
            emit(extra);
            const finishedAt = new Date();
            // 로그 파일이 디스크에 다 써진 뒤에 돌려준다 — 호출 측이 바로 읽어도 잘리지 않게
            log.end(() => resolve({
                exitCode: code,
                signal,
                timedOut,
                durationMs: finishedAt - startedAt,
                startedAt: startedAt.toISOString(),
                finishedAt: finishedAt.toISOString(),
                output: chunks.join(''),
            }));
        };
        // spawn 뒤에 온 'error'(kill 실패 등)는 바로 끝내면 그룹의 자식이 남는다 — 그룹을 끝내고 'close' 에서 실패로 끝낸다
        let lateError = null;
        child.on('error', (err) => {
            const extra = `[runner] 실행 실패: ${err.message}\n`;
            if (child.pid === undefined) return finish(null, null, extra);
            if (lateError) return;
            lateError = extra;
            if (!killTimer) terminateGroup(); // 시간 초과가 이미 끝내는 중이면 그 순서를 따른다
        });
        child.on('close', (code, signal) => {
            const result = lateError ? [null, signal, lateError] : [code, signal];
            // 끝내는 중에 bash 만 먼저 끝나고 그룹(SIGTERM 을 무시한 손자 등)이 남았으면 SIGKILL 을 보낸 뒤에 끝낸다
            if (killTimer && !killSent && groupAlive()) {
                clearTimeout(timer);
                pendingClose = result;
                return;
            }
            finish(...result);
        });
    });
}
