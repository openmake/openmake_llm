/**
 * 샌드박스 명령의 터미널 출력을 실행 중에 작업 폴더 숨김 파일(LIVE_VIEW.TERMINAL_FILE)로 남긴다.
 *
 * 실시간 작업 화면이 이 파일을 읽어 보여준다. 출력은 끝부분(tailChars)만 남기고, 파일은
 * writeMs 간격으로만 다시 쓴다. 쓰기는 `.tmp` 에 쓴 뒤 rename(읽는 쪽이 반쯤 쓴 파일을 보지 않게)하고,
 * 차례로 이어 붙여 늦게 끝난 쓰기가 마지막 상태를 덮지 않게 한다. 모든 실패는 삼킨다(fail-open).
 *
 * @module services/task-sandbox/live-terminal
 */
import { writeFile, rename } from 'fs/promises';
import { join } from 'path';
import type { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import type { ExecResult } from './executor';
import { LIVE_VIEW } from '../../config/agent-task-live-view';

export interface LiveTerminalState {
    /** 감싸기 전 원래 명령. */
    command: string;
    /** stdout·stderr 를 섞은 출력의 끝부분. */
    output: string;
    /** 앞부분을 잘라냈는지. */
    truncatedHead: boolean;
    startedAt: number;
    /** 끝난 시각 — 실행 중이면 null. */
    endedAt: number | null;
    /** 종료 코드 — 실행 중이면 null. */
    exitCode: number | null;
}

export function startLiveTerminal(
    hostWorkdir: string,
    command: string,
    opts: { now?: () => number; tailChars?: number; writeMs?: number } = {},
): { append(chunk: string): void; finish(exitCode: number): Promise<void> } {
    const now = opts.now ?? Date.now;
    const tailChars = opts.tailChars ?? LIVE_VIEW.TERMINAL_TAIL_CHARS;
    const writeMs = opts.writeMs ?? LIVE_VIEW.TERMINAL_WRITE_MS;
    const file = join(hostWorkdir, LIVE_VIEW.TERMINAL_FILE);
    const tmp = `${file}.tmp`;
    const state: LiveTerminalState = { command, output: '', truncatedHead: false, startedAt: now(), endedAt: null, exitCode: null };
    let lastWrite = 0;
    let chain: Promise<void> = Promise.resolve();

    const flush = (): Promise<void> => {
        lastWrite = now();
        const json = JSON.stringify(state);
        chain = chain.then(async () => {
            try {
                await writeFile(tmp, json, 'utf8');
                await rename(tmp, file);
            } catch { /* 실시간 기록 실패는 명령 실행에 영향을 주지 않는다 */ }
        });
        return chain;
    };
    void flush();

    return {
        append(chunk: string): void {
            try {
                state.output += chunk;
                if (state.output.length > tailChars) {
                    state.output = state.output.slice(state.output.length - tailChars);
                    state.truncatedHead = true;
                }
                if (now() - lastWrite >= writeMs) void flush();
            } catch { /* fail-open */ }
        },
        finish(exitCode: number): Promise<void> {
            state.endedAt = now();
            state.exitCode = exitCode;
            return flush();
        },
    };
}

/**
 * 자식 프로세스의 stdout·stderr 조각을 onOutput 에 넘긴다(출력 상한과 무관). 멀티바이트 글자가
 * 조각 경계에서 깨지지 않게 스트림별 디코더를 쓰고, 콜백 예외는 삼킨다. onOutput 이 없으면 그대로 돌려준다.
 */
export function tapOutput<T extends { stdout: Readable; stderr: Readable }>(child: T, onOutput?: (chunk: string) => void): T {
    if (!onOutput) return child;
    for (const stream of [child.stdout, child.stderr]) {
        const decoder = new StringDecoder('utf8');
        stream.on('data', (buf: Buffer) => {
            try { onOutput(decoder.write(buf)); } catch { /* 실시간 기록은 실행 결과에 영향을 주지 않는다 */ }
        });
    }
    return child;
}

/**
 * LIVE_VIEW.ENABLED 면 command 의 실시간 기록을 시작하고 run 에 append 를 onOutput 으로 넘긴 뒤,
 * 끝나면(실패해도) 종료 코드(결과가 없으면 -1)로 마무리한다. run 의 결과·예외는 그대로 전달한다.
 */
export async function withLiveTerminal(
    hostWorkdir: string,
    command: string,
    run: (onOutput?: (chunk: string) => void) => Promise<ExecResult>,
): Promise<ExecResult> {
    if (!LIVE_VIEW.ENABLED) return run(undefined);
    const live = startLiveTerminal(hostWorkdir, command);
    let r: ExecResult | undefined;
    try {
        r = await run((c) => live.append(c));
        return r;
    } finally {
        await live.finish(r?.exitCode ?? -1);
    }
}
