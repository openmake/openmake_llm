/**
 * 샌드박스 명령의 터미널 출력을 실행 중에 작업 폴더 숨김 파일(LIVE_VIEW.TERMINAL_FILE)로 남긴다.
 *
 * 실시간 작업 화면이 이 파일을 읽어 보여준다. 출력은 끝부분(tailChars)만 남기고, 파일은
 * writeMs 간격으로만 다시 쓴다. 쓰기는 `.tmp` 에 쓴 뒤 rename(읽는 쪽이 반쯤 쓴 파일을 보지 않게)하고,
 * 차례로 이어 붙여 늦게 끝난 쓰기가 마지막 상태를 덮지 않게 한다. 모든 실패는 삼킨다(fail-open).
 * hideTag(파이프 종료 코드 표식, pipe-status)를 주면 stderr 의 표식 줄을 걸러낸다 — 표식일 수 있는
 * 미완성 줄은 줄바꿈이 올 때까지 붙잡아 두므로 기록 파일에는 표식이 남지 않는다.
 *
 * @module services/task-sandbox/live-terminal
 */
import { writeFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import type { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import type { ExecResult } from './executor';
import { pipeStatusMarkerPattern } from './pipe-status';
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

type OutputStream = 'out' | 'err';

/** 줄 조각이 표식을 담았거나, 끝부분이 표식의 앞부분일 수 있는지. */
function mayBeMarker(line: string, tag: string): boolean {
    if (line.includes(tag)) return true;
    for (let k = Math.min(line.length, tag.length); k > 0; k--) if (tag.startsWith(line.slice(-k))) return true;
    return false;
}

export function startLiveTerminal(
    hostWorkdir: string,
    command: string,
    opts: { now?: () => number; tailChars?: number; writeMs?: number; hideTag?: string } = {},
): { append(chunk: string, stream?: OutputStream): void; finish(exitCode: number): Promise<void> } {
    const now = opts.now ?? Date.now;
    const tailChars = opts.tailChars ?? LIVE_VIEW.TERMINAL_TAIL_CHARS;
    const writeMs = opts.writeMs ?? LIVE_VIEW.TERMINAL_WRITE_MS;
    const file = join(hostWorkdir, LIVE_VIEW.TERMINAL_FILE);
    const tmp = `${file}.tmp`;
    const state: LiveTerminalState = { command, output: '', truncatedHead: false, startedAt: now(), endedAt: null, exitCode: null };
    const hide = opts.hideTag;
    let errHold = '';
    let lastWrite = 0;
    let chain: Promise<void> = Promise.resolve();

    const push = (text: string): void => {
        state.output += text;
        if (state.output.length > tailChars) {
            state.output = state.output.slice(state.output.length - tailChars);
            state.truncatedHead = true;
        }
    };

    const flush = (): Promise<void> => {
        lastWrite = now();
        const json = JSON.stringify(state);
        chain = chain.then(async () => {
            try {
                // 이 쓰기는 호스트 API 권한으로 한다 — 에이전트가 .tmp 를 심링크(폴더 밖 덮어쓰기)나
                // FIFO(영원히 대기)로 바꿔 둘 수 있으므로 지우고 새로 만든다(wx: 이미 있으면 EEXIST 로 실패).
                // rename 은 최종 파일이 심링크여도 링크 자체를 바꾼다.
                await rm(tmp, { force: true });
                await writeFile(tmp, json, { encoding: 'utf8', flag: 'wx' });
                await rename(tmp, file);
            } catch { /* 실시간 기록 실패는 명령 실행에 영향을 주지 않는다 */ }
        });
        return chain;
    };
    void flush();

    return {
        append(chunk: string, stream?: OutputStream): void {
            try {
                if (!hide || stream === 'out') push(chunk);
                else {
                    // 표식은 stderr 에 한 줄로 온다 — 끝난 줄에서만 지우고, 표식일 수 있는 남은 줄은 붙잡는다.
                    const text = errHold + chunk;
                    const cut = text.lastIndexOf('\n') + 1;
                    const rest = text.slice(cut);
                    errHold = mayBeMarker(rest, hide) ? rest : '';
                    push(text.slice(0, cut).replace(pipeStatusMarkerPattern(hide, false), '') + (errHold ? '' : rest));
                }
                if (now() - lastWrite >= writeMs) void flush();
            } catch { /* fail-open */ }
        },
        finish(exitCode: number): Promise<void> {
            try {
                if (hide && errHold) {
                    const left = errHold.replace(pipeStatusMarkerPattern(hide), '');
                    const at = left.indexOf(hide);
                    push(at >= 0 ? left.slice(0, at) : left);
                    errHold = '';
                }
            } catch { /* fail-open */ }
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
export function tapOutput<T extends { stdout: Readable; stderr: Readable }>(child: T, onOutput?: (chunk: string, stream: OutputStream) => void): T {
    if (!onOutput) return child;
    for (const [stream, which] of [[child.stdout, 'out'], [child.stderr, 'err']] as const) {
        const decoder = new StringDecoder('utf8');
        const emit = (text: string): void => {
            try { if (text) onOutput(text, which); } catch { /* 실시간 기록은 실행 결과에 영향을 주지 않는다 */ }
        };
        stream.on('data', (buf: Buffer) => emit(decoder.write(buf)));
        stream.on('end', () => emit(decoder.end())); // 잘린 멀티바이트로 끝난 마지막 바이트
    }
    return child;
}

/**
 * LIVE_VIEW.ENABLED 이고 기록 대상(target)이 있으면 그 명령의 실시간 기록을 시작하고 run 에 append 를
 * onOutput 으로 넘긴 뒤, 끝나면(실패해도) 종료 코드(결과가 없으면 -1)로 마무리한다. run 의 결과·예외는 그대로 전달한다.
 * target 이 null 이면(내부 도구 실행 등) 기록하지 않는다.
 */
export async function withLiveTerminal(
    hostWorkdir: string,
    target: { command: string; hideTag?: string } | null,
    run: (onOutput?: (chunk: string, stream: OutputStream) => void) => Promise<ExecResult>,
): Promise<ExecResult> {
    if (!LIVE_VIEW.ENABLED || !target) return run(undefined);
    const live = startLiveTerminal(hostWorkdir, target.command, { hideTag: target.hideTag });
    let r: ExecResult | undefined;
    try {
        r = await run((c, s) => live.append(c, s));
        return r;
    } finally {
        await live.finish(r?.exitCode ?? -1);
    }
}
