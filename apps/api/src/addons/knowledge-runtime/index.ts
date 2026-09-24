/**
 * knowledge-runtime 런타임 진입점 — 수집 작업 worker 를 백그라운드로 돌린다.
 * add-on 매니페스트 `entry.runtime = index#startKnowledgeRuntime` 가 부팅 절차에서 이 함수를 부른다.
 * capability 를 게시하지 않으므로 host 인자는 무시한다(다른 런타임 add-on 과 동일).
 *
 * @module addons/knowledge-runtime/index
 */
import { createLogger } from '../../utils/logger';
import { KNOWLEDGE_RUNTIME } from './constants';
import { KnowledgeWorker } from './jobs/worker';

const logger = createLogger('KnowledgeRuntime');

let timer: NodeJS.Timeout | null = null;
let worker: KnowledgeWorker | null = null;

/** worker 를 폴링 주기로 기동한다. 이미 돌고 있으면 아무것도 하지 않는다(중복 기동 방지). */
export async function startKnowledgeRuntime(): Promise<void> {
    if (timer) return;
    worker = new KnowledgeWorker();
    const w = worker;
    // 매 tick 은 fail-open — 한 번의 오류가 폴링을 멈추지 않는다
    timer = setInterval(() => {
        void w.tick().catch((err) => logger.warn(`수집 worker tick 실패(무시): ${err instanceof Error ? err.message : String(err)}`));
    }, KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);
    // 프로세스 종료를 막지 않는다(job-poller 와 동일 패턴)
    timer.unref();
    logger.info(`Knowledge 수집 worker 시작 (poll ${KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS}ms)`);
}

/** 테스트·정리용 — 폴링 중단 */
export function stopKnowledgeRuntime(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    worker = null;
}
