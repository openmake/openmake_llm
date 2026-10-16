/**
 * 명령 한 건 실행 — bash -c 로 돌리고 stdout·stderr 를 로그 파일과 메모리에 함께 남긴다.
 * 시간 초과면 SIGTERM, 10초 뒤에도 살아 있으면 SIGKILL(프로세스 그룹 전체).
 * 로그 WriteStream 의 'finish'(end 콜백)를 기다린 뒤에 결과를 돌려준다.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets } from './lib.mjs';

const KILL_GRACE_MS = 10_000;
// 공백 없는 꼬리를 이만큼까지 붙잡아 둔다 — URL 이 청크 경계에서 잘려도 다음 청크와 합친 뒤 가린다
const MAX_HELD_TAIL = 4096;

/**
 * 스트림 하나의 청크를 받아 마지막 공백 문자 뒤 꼬리를 다음 청크와 합칠 때까지 붙잡는다.
 * 비밀번호가 든 URL 은 공백을 품지 않으므로, 공백까지 끊어 내보내면 URL 이 두 청크로 갈려 가리기를 피하지 못한다.
 * 꼬리가 MAX_HELD_TAIL 을 넘으면(공백 없는 긴 출력) 그대로 내보낸다. 끝나면 flush 로 남은 꼬리를 내보낸다.
 */
export function createChunkMasker(emit) {
    let held = '';
    return {
        push(buf) {
            const text = held + buf.toString('utf8');
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
            const rest = held;
            held = '';
            emit(rest);
        },
    };
}

export function runCommand({ cmd, cwd, env, timeoutSec, logPath }) {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath);
    const startedAt = new Date();
    return new Promise((resolve) => {
        const child = spawn('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
        const timer = setTimeout(() => {
            timedOut = true;
            try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ }
            killTimer = setTimeout(() => {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝남 */ }
            }, KILL_GRACE_MS);
        }, timeoutSec * 1000);
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            stdoutMask.flush();
            stderrMask.flush();
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
        });
    });
}
