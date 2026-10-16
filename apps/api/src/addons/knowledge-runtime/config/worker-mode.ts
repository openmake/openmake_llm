/**
 * 이 프로세스의 수집 소비자 설정 — `KNOWLEDGE_WORKER_MODE`·`KNOWLEDGE_WORKER_HEALTH_PORT`(config/env.ts).
 * 설정 모드는 "이 API 프로세스가 poller 를 띄우는가"만 정한다. claim 권한은 DB `knowledge_worker_mode` 가 정한다.
 * 테스트는 이 모듈을 mock 한다(실제 .env 에 묶이지 않게).
 *
 * @module addons/knowledge-runtime/config/worker-mode
 */
import { getConfig } from '../../../config';
import type { KnowledgeWorkerMode } from '../jobs/job-schema';

export function configuredWorkerMode(): KnowledgeWorkerMode {
    return getConfig().knowledgeWorkerMode;
}

export function configuredWorkerHealthPort(): number {
    return getConfig().knowledgeWorkerHealthPort;
}
