/**
 * knowledge-runtime 런타임 진입점 — 수집 작업 worker 를 백그라운드로 돌리고 수명주기 handle 을 돌려준다.
 * add-on 매니페스트 `entry.runtime = index#startKnowledgeRuntime` 가 부팅 절차에서 이 함수를 부른다.
 * 폴링 타이머는 호스트 타이머(`host.setInterval` — owner 태그·unref·종료 때 회수)로 건다. capability 는 게시하지 않는다.
 * 관리자 토글(disabled)은 handle.stop 으로 새 claim 을 멈추고 진행 중 작업을 drain 하며, enabled 는 resume 으로 다시 연다
 * (같은 프로세스에서 재시작 없이). 프로세스 종료도 같은 stop(drain) 을 거친다(boot/graceful-shutdown).
 *
 * @module addons/knowledge-runtime/index
 */
import type { AddonRuntimeHandle, AddonRuntimeHost } from '../../addon-host';
import { createLogger } from '../../utils/logger';
import { KNOWLEDGE_RUNTIME } from './constants';
import { KnowledgeWorker } from './jobs/worker';

const logger = createLogger('KnowledgeRuntime');

let worker: KnowledgeWorker | null = null;

function handleFor(w: KnowledgeWorker): AddonRuntimeHandle {
    return {
        async stop(opts) {
            await w.stop(opts);
            logger.info(`Knowledge 수집 worker 정지(${opts.drain ? 'drain' : '즉시'}) — 새 작업을 집지 않는다`);
        },
        async resume() {
            w.resume();
            logger.info('Knowledge 수집 worker 재개 — 새 작업을 다시 집는다');
        },
        health: () => w.health(),
    };
}

/** worker 를 폴링 주기로 기동한다. 이미 돌고 있으면 새로 띄우지 않고 그 worker 의 handle 을 돌려준다(중복 기동 방지). */
export async function startKnowledgeRuntime(host: AddonRuntimeHost): Promise<AddonRuntimeHandle> {
    if (worker) return handleFor(worker);
    const w = new KnowledgeWorker();
    worker = w;
    // 매 tick 은 fail-open — 한 번의 오류가 폴링을 멈추지 않는다. 정지 중에는 tick 이 claim 을 건너뛴다
    host.setInterval(() => {
        void w.tick().catch((err) => logger.warn(`수집 worker tick 실패(무시): ${err instanceof Error ? err.message : String(err)}`));
    }, KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);
    logger.info(`Knowledge 수집 worker 시작 (poll ${KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS}ms)`);
    return handleFor(w);
}

/** 테스트·정리용 — worker 를 즉시 정지하고 잊는다(폴링 타이머는 호스트가 회수한다) */
export async function stopKnowledgeRuntime(): Promise<void> {
    const w = worker;
    worker = null;
    if (w) await w.stop({ drain: false, signal: AbortSignal.abort() });
}
