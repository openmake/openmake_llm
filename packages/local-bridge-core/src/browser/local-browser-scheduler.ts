/**
 * LocalBrowser 의 실행 조정 — 작업별 실행 줄·동시 실행 자리·중지 요청(local-browser.ts 에서 분리, 2026-11-04).
 *
 * 같은 작업의 요청은 순서대로, 다른 작업은 BROWSER_MAX_CONCURRENT 까지 동시에 실행한다.
 * 다운로드 폴더는 브라우저 전역 설정이라 다운로드 폴더가 다른 작업끼리는 동시에 돌리지 않는다.
 */
import { BROWSER_MAX_CONCURRENT } from '../constants';

export class BrowserScheduler {
    /** 중지 요청마다 오른다 — 실행 중인 요청이 시작 때의 값과 달라지면 멈춘다(전체 중지·제어권) */
    private stopGeneration = 0;
    /** 작업별 중지 — requestStop(taskId) 마다 그 작업의 값이 오른다 */
    private readonly taskStops = new Map<string, number>();
    /** 작업별 실행 줄 — 같은 작업은 앞 요청이 끝난 뒤에 실행한다 */
    private readonly chains = new Map<string, Promise<unknown>>();
    /** 지금 실행 중인 작업 → 그 다운로드 폴더 */
    private readonly running = new Map<string, string>();
    /** 실행 자리·탭 자리를 기다리는 요청 — 자리가 나면 모두 깨워 다시 확인한다 */
    private waiters: Array<() => void> = [];

    /** 실행 중인 요청을 멈춘다(다음 액션부터 실행하지 않는다). taskId 를 주면 그 작업만, 없으면 모두. */
    requestStop(taskId?: string): void {
        if (taskId === undefined) { this.stopGeneration++; return; }
        this.taskStops.set(taskId, (this.taskStops.get(taskId) ?? 0) + 1);
    }

    /** 지금 시작하는 요청의 중지 확인 — 전체 중지·제어권이나 그 작업의 중지가 시작 때의 값과 달라지면 true. */
    stopCheck(key: string): () => boolean {
        const generation = this.stopGeneration;
        const taskGeneration = this.taskStops.get(key) ?? 0;
        return () => this.stopGeneration !== generation || (this.taskStops.get(key) ?? 0) !== taskGeneration;
    }

    /** 작업이 끝났다 — 그 작업의 중지 기록을 지운다. */
    forgetTask(key: string): void { this.taskStops.delete(key); }

    isRunning(key: string): boolean { return this.running.has(key); }

    /** 요청 1건 실행 — 같은 작업은 순서대로, 다른 작업은 동시 실행 상한까지 함께. */
    run<T>(key: string, downloadDir: string, fn: () => Promise<T>): Promise<T> {
        const p = (this.chains.get(key) ?? Promise.resolve()).then(async () => {
            await this.acquire(key, downloadDir);
            try { return await fn(); } finally { this.release(key); }
        });
        const tail = p.catch(() => undefined);
        this.chains.set(key, tail);
        void tail.then(() => { if (this.chains.get(key) === tail) this.chains.delete(key); });
        return p;
    }

    /** 실행 자리를 얻을 때까지 기다린다 — 동시 실행 상한 안이고, 실행 중인 작업이 모두 같은 다운로드 폴더일 때. */
    private async acquire(key: string, downloadDir: string): Promise<void> {
        while (this.running.size >= BROWSER_MAX_CONCURRENT || [...this.running.values()].some((d) => d !== downloadDir)) {
            await this.nextRelease();
        }
        this.running.set(key, downloadDir);
    }

    private release(key: string): void {
        this.running.delete(key);
        const waiters = this.waiters;
        this.waiters = [];
        for (const w of waiters) w();
    }

    /** 다음 실행이 끝날 때까지 기다린다 — 실행 자리·탭 자리 공용. */
    nextRelease(): Promise<void> { return new Promise((r) => { this.waiters.push(r); }); }
}
