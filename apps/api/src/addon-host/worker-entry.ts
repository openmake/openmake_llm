/**
 * Add-on 별도 프로세스 worker 진입 — Base 진입점(`workers/<이름>.ts`)이 매니페스트 `entry.workers[].name` 으로
 * 구현을 찾아 부른다(2026-10-16, C4). Base 는 add-on id·코드 경로를 모른다(경계 lint: Base → addons import 금지).
 * 찾은 add-on 이 env(`ADDON_BUILTIN_DISABLED`)로 꺼져 있거나 이름이 없으면 기동하지 않는다(설정 오류, 종료 코드 78).
 * DB 의도(관리자 토글)는 여기서 보지 않는다 — worker 가 claim 때 add-on 상태로 판정한다(꺼져 있으면 떠 있어도 집지 않는다).
 *
 * @module addon-host/worker-entry
 */
import { isBuiltinAddonEnabled, listBuiltinAddonDefs } from './builtin-registry';
import { loadAddonEntry } from './entry-loader';

/** 기동 불가(설정·스키마) 종료 코드 — EX_CONFIG. PM2 앱의 stop_exit_codes 가 재시작 루프를 막는다 */
export const ADDON_WORKER_CONFIG_EXIT_CODE = 78;

/** 기동 불가 — 진입점이 ADDON_WORKER_CONFIG_EXIT_CODE 로 끝낸다 */
export class AddonWorkerConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AddonWorkerConfigError';
    }
}

export interface AddonWorkerOptions {
    /** 작은 HTTP /health 포트(127.0.0.1) — 0 이면 열지 않는다 */
    healthPort: number;
}

export interface AddonWorkerHandle {
    /** 진행 중 작업을 예산 안에서 마치고 멈춘다(DB 풀 종료는 진입점이 한다) */
    stop(reason: string): Promise<void>;
    /** 종료 전체 상한(ms) — 진입점의 graceful shutdown 이 쓴다 */
    readonly shutdownTimeoutMs: number;
}

export type AddonWorkerEntry = (opts: AddonWorkerOptions) => Promise<AddonWorkerHandle>;

export function loadAddonWorker(workerName: string): { addonId: string; start: AddonWorkerEntry } {
    for (const addon of listBuiltinAddonDefs()) {
        const declared = addon.manifest.entry?.workers?.find((w) => w.name === workerName);
        if (!declared) continue;
        if (!isBuiltinAddonEnabled(addon.id)) {
            throw new AddonWorkerConfigError(`worker '${workerName}' 의 add-on '${addon.id}' 이 ADDON_BUILTIN_DISABLED 로 꺼져 있다`);
        }
        return { addonId: addon.id, start: loadAddonEntry<AddonWorkerEntry>(addon, declared.module) };
    }
    throw new AddonWorkerConfigError(`매니페스트에 worker '${workerName}' 을 선언한 내장 add-on 이 없다`);
}
