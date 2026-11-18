/**
 * 브리지 등록 대기 (설계 2026-11-19 device-id-conflict §3.2 r4) — run·resume 은 **자기 소켓**이 bridge_ready 를 받았을 때만
 * 작업을 만든다. 서버 기기 목록은 "그 id 로 누군가 붙어 있다"만 말하고 "내가 붙었다"를 말하지 않는다.
 *
 * 코어가 넘기는 상태 코드를 연결을 시작하기 전부터 받아 두고(놓치는 상태가 없다), 처음 나온 결정 상태로 끝난다.
 */
import { AUTH_CLOSE_REASONS, type BridgeStatusCode } from '@openmake/local-bridge-core';

export type RegisterOutcome =
    | { kind: 'ok' }
    | { kind: 'conflict' }
    /** 인증 사유로 닫힘 — text 는 코어의 사유 문구. */
    | { kind: 'auth'; text: string }
    /** 시간 안에 결정 상태가 없었다 — serverError 는 마지막으로 받은 서버 오류 문구(기기 상한 등). */
    | { kind: 'timeout'; serverError?: string };

export class RegistrationWatch {
    private decided: RegisterOutcome | null = null;
    private lastServerError: string | undefined;
    private readonly waiters = new Set<(o: RegisterOutcome) => void>();

    /** 코어 onStatus 를 그대로 넘긴다. */
    note(text: string, code?: BridgeStatusCode, arg?: string): void {
        if (code === 'server_error' && arg) this.lastServerError = arg;
        if (this.decided) return;
        const outcome: RegisterOutcome | null = code === 'connected' ? { kind: 'ok' }
            : code === 'device_conflict' ? { kind: 'conflict' }
                : code && (AUTH_CLOSE_REASONS as readonly string[]).includes(code) ? { kind: 'auth', text }
                    : null;
        if (!outcome) return;
        this.decided = outcome;
        for (const w of [...this.waiters]) w(outcome);
    }

    /** 결정 상태를 기다린다. 이미 나왔으면 바로 그 값. 시간이 다 되면 timeout. 끝난 뒤 타이머를 남기지 않는다. */
    wait(timeoutMs: number): Promise<RegisterOutcome> {
        if (this.decided) return Promise.resolve(this.decided);
        return new Promise((resolve) => {
            const done = (o: RegisterOutcome): void => { clearTimeout(timer); this.waiters.delete(done); resolve(o); };
            const timer = setTimeout(() => done({ kind: 'timeout', ...(this.lastServerError ? { serverError: this.lastServerError } : {}) }), timeoutMs);
            this.waiters.add(done);
        });
    }
}
