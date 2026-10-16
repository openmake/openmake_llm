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

export function runCommand({ cmd, cwd, env, timeoutSec, logPath }) {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath);
    const startedAt = new Date();
    return new Promise((resolve) => {
        const child = spawn('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const onData = (buf) => {
            const text = redactSecrets(buf.toString('utf8'));
            chunks.push(text);
            log.write(text);
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
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
