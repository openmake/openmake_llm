/**
 * Knowledge 수집 worker 별도 프로세스 진입점 — PM2 앱 `openmake-knowledge-worker`(ecosystem.config.js)의 script
 * (`apps/api/dist/workers/knowledge-worker.js`). 설계 D5: KNOWLEDGE_WORKER_MODE=external 로 전환할 때만 띄운다.
 *
 * Base 는 add-on 코드를 직접 import 하지 않는다(경계 lint) — 매니페스트 `entry.workers[].name` 으로 구현을 찾는다
 * (addon-host/worker-entry). 이 파일은 프로세스 공통부만 맡는다: 루트 .env 로딩, 설정 검증, 시스템 설정(DB) overlay,
 * 종료 신호(SIGTERM·SIGINT → drain → DB 풀 종료, 상한 handle.shutdownTimeoutMs), 기동 불가 시 종료 코드 78.
 * API listen·add-on 전체 부팅·마이그레이션 적용은 하지 않는다(마이그레이션은 API 가 적용한다).
 *
 * @module workers/knowledge-worker
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
// API(server.ts)와 같은 루트 .env — src·dist 어느 쪽에서 실행해도 apps/api/<src|dist>/workers 기준 네 단계 위. 이미 있는 값은 덮지 않는다
dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

import { createLogger } from '../utils/logger';
import { getConfig } from '../config';
import { createGracefulShutdown } from '../boot/graceful-shutdown';
import { closeDatabase } from '../data/models/unified-database';
import {
    ADDON_WORKER_CONFIG_EXIT_CODE, AddonWorkerConfigError, loadAddonWorker, type AddonWorkerHandle,
} from '../addon-host/worker-entry';

const logger = createLogger('KnowledgeWorkerMain');

/** 매니페스트 entry.workers[].name — PM2 앱 openmake-knowledge-worker·이 파일 이름과 짝인 계약 */
const WORKER_NAME = 'knowledge-ingest';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 관리 화면이 바꾼 시스템 설정(DB) — API 와 같은 overlay 를 쓴다(임베딩 capability 배정을 포함). 실패는 env 로 계속 */
async function loadSystemSettings(): Promise<void> {
    try {
        const { getSystemSettingsService } = await import('../services/system-settings-service');
        await getSystemSettingsService().loadAndApply();
    } catch (err) {
        logger.warn(`시스템 설정 로드 실패(env 로 계속): ${message(err)}`);
    }
}

async function startOrExit(): Promise<AddonWorkerHandle> {
    const config = getConfig();
    if (config.knowledgeWorkerMode !== 'external') {
        logger.warn('KNOWLEDGE_WORKER_MODE 가 external 이 아니다 — API 도 poller 를 띄우고 있을 수 있다(DB 모드가 한쪽만 집게 하므로 중복 처리는 없다)');
    }
    try {
        const { addonId, start } = loadAddonWorker(WORKER_NAME);
        logger.info(`worker '${WORKER_NAME}'(add-on ${addonId}) 기동`);
        return await start({ healthPort: config.knowledgeWorkerHealthPort });
    } catch (err) {
        if (err instanceof AddonWorkerConfigError) {
            logger.error(`기동 불가 — ${err.message}`);
            await closeDatabase().catch(() => undefined);
            process.exit(ADDON_WORKER_CONFIG_EXIT_CODE);
        }
        throw err;
    }
}

async function main(): Promise<void> {
    await loadSystemSettings();
    const handle = await startOrExit();
    const shutdown = createGracefulShutdown([
        { name: 'Knowledge 수집 worker 정지(drain)', run: () => handle.stop('종료 신호') },
        { name: 'DB 커넥션 풀 종료', run: () => closeDatabase() },
    ], { timeoutMs: handle.shutdownTimeoutMs });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
    process.on('uncaughtException', (err) => {
        logger.error('uncaughtException:', err);
        void shutdown('uncaughtException', 1);
    });
    process.on('unhandledRejection', (reason) => {
        logger.error('unhandledRejection:', reason);
        void shutdown('unhandledRejection', 1);
    });
}

void main().catch((err: unknown) => {
    logger.error('기동 실패:', err);
    process.exit(1);
});
