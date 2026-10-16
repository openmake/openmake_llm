/**
 * Knowledge 수집 worker 별도 프로세스 본체 — API 를 띄우지 않고 수집 poller 만 돈다(설계 D5, external 모드).
 * Base 진입점(`workers/knowledge-worker.ts`)이 설정·시스템 설정 overlay·종료 신호를 맡고, 매니페스트
 * `entry.workers[name=knowledge-ingest]` 로 이 함수를 찾아 부른다(addon-host/worker-entry).
 *
 * 기동: ① add-on 마이그레이션 004 확인 — API 가 아직 적용하지 않았으면 `WORKER_SCHEMA_WAIT_MS` 까지 기다리고 끝내 없으면
 *       AddonWorkerConfigError(진입점이 종료 코드 78 로 끝내 PM2 재시작 루프를 막는다)
 *       ② add-on 상태 캐시 적재 ③ worker(consumerKind external) 폴링 ④ heartbeat 행(즉시 1회 + 주기)
 *       ⑤ 작은 HTTP `/health`(127.0.0.1, 포트 0 이면 끔)
 * 정지: 폴링 중단 → worker.stop(drain, `WORKER_DRAIN_TIMEOUT_MS` — 넘으면 C1 규칙대로 lease 반납) → heartbeat 중단·행 삭제
 *       → /health 닫기. DB 풀은 진입점이 닫는다.
 * DB 모드(`knowledge_worker_mode`)가 inprocess 면 이 프로세스는 떠 있어도 집지 않는다(claim 이 대조한다).
 *
 * @module addons/knowledge-runtime/standalone/worker-process
 */
import { createServer, type Server } from 'node:http';
import { AddonWorkerConfigError, type AddonWorkerHandle, type AddonWorkerOptions } from '../../../addon-host/worker-entry';
import { warmAddonStates } from '../../../runtime-ports/addon-admission';
import { createLogger } from '../../../utils/logger';
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';
import { KnowledgeWorker } from '../jobs/worker';
import { REQUIRED_JOB_SCHEMA_VERSION, type KnowledgeWorkerMode } from '../jobs/job-schema';
import { removeWorkerHeartbeat, writeWorkerHeartbeat } from '../jobs/heartbeat-row';

const logger = createLogger('KnowledgeWorkerProcess');

/** 별도 프로세스는 언제나 external 소비자다 */
const PROCESS_KIND: KnowledgeWorkerMode = 'external';

export interface KnowledgeWorkerProcessOptions extends AddonWorkerOptions {
    /** 정지 때 진행 중 작업을 기다리는 상한(ms) — 기본 KNOWLEDGE_RUNTIME.WORKER_DRAIN_TIMEOUT_MS */
    drainTimeoutMs?: number;
    /** 기동 때 마이그레이션을 기다리는 상한(ms) — 기본 KNOWLEDGE_RUNTIME.WORKER_SCHEMA_WAIT_MS */
    migrationWaitMs?: number;
}

export interface KnowledgeWorkerProcessHandle extends AddonWorkerHandle {
    readonly workerId: string;
    /** 실제로 연 /health 포트 — 열지 않았거나 닫았으면 null */
    healthPort(): number | null;
}

interface ProcessView {
    dbMode: KnowledgeWorkerMode | null;
    generation: number | null;
    lastHeartbeatAt: number | null;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

async function hasRequiredSchema(): Promise<boolean> {
    try {
        const r = await kdb().query('SELECT 1 FROM migration_versions WHERE version = $1', [REQUIRED_JOB_SCHEMA_VERSION]);
        return (r.rowCount ?? 0) > 0;
    } catch (err) {
        logger.warn(`마이그레이션 기록 조회 실패: ${message(err)}`);
        return false;
    }
}

/** 004 가 적용될 때까지 기다린다 — API 가 먼저 떠서 적용한다(배포 순서가 뒤바뀌어도 바로 죽지 않게) */
async function waitForSchema(waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
        if (await hasRequiredSchema()) return true;
        if (Date.now() >= deadline) return false;
        logger.warn(`add-on 마이그레이션 ${REQUIRED_JOB_SCHEMA_VERSION} 대기 중 — API 가 먼저 떠서 적용한다`);
        await new Promise((resolve) => setTimeout(resolve, KNOWLEDGE_RUNTIME.WORKER_SCHEMA_POLL_MS));
    }
}

function startHealthServer(port: number, read: () => unknown): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            if (req.method !== 'GET' || req.url !== '/health') {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(read()));
        });
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

export async function runKnowledgeWorkerProcess(opts: KnowledgeWorkerProcessOptions): Promise<KnowledgeWorkerProcessHandle> {
    const drainTimeoutMs = opts.drainTimeoutMs ?? KNOWLEDGE_RUNTIME.WORKER_DRAIN_TIMEOUT_MS;
    if (!(await waitForSchema(opts.migrationWaitMs ?? KNOWLEDGE_RUNTIME.WORKER_SCHEMA_WAIT_MS))) {
        throw new AddonWorkerConfigError(
            `Knowledge add-on 마이그레이션 ${REQUIRED_JOB_SCHEMA_VERSION} 이 없다 — API 를 먼저 배포해 add-on 마이그레이션을 적용한 뒤 기동한다`,
        );
    }
    await warmAddonStates();

    const worker = new KnowledgeWorker({ consumerKind: PROCESS_KIND });
    const view: ProcessView = { dbMode: null, generation: null, lastHeartbeatAt: null };

    const beat = async (): Promise<void> => {
        try {
            const snap = await writeWorkerHeartbeat({ workerId: worker.id, kind: PROCESS_KIND, inflight: worker.health().inflight });
            if (snap.dbMode !== view.dbMode || snap.generation !== view.generation) {
                logger.info(`DB 모드 ${snap.dbMode ?? '없음'} · generation ${snap.generation ?? '-'} — ${snap.dbMode === PROCESS_KIND ? '이 프로세스가 수집한다' : '이 프로세스는 집지 않는다'}`);
            }
            view.dbMode = snap.dbMode;
            view.generation = snap.generation;
            view.lastHeartbeatAt = Date.now();
        } catch (err) {
            logger.warn(`heartbeat 행 갱신 실패(다음 주기에 다시): ${message(err)}`);
        }
    };

    await beat();
    const heartbeatTimer = setInterval(() => { void beat(); }, KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_MS);
    const pollTimer = setInterval(() => {
        void worker.tick().catch((err: unknown) => logger.warn(`수집 worker tick 실패(무시): ${message(err)}`));
    }, KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);

    let server: Server | null = null;
    if (opts.healthPort > 0) {
        server = await startHealthServer(opts.healthPort, () => ({
            ...worker.health(),
            kind: PROCESS_KIND,
            workerId: worker.id,
            dbMode: view.dbMode,
            generation: view.generation,
            lastClaimAt: iso(worker.lastClaimAt()),
            lastHeartbeatAt: iso(view.lastHeartbeatAt),
        }));
    }
    logger.info(`Knowledge 수집 worker 프로세스 준비 — id=${worker.id} poll=${KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS}ms health=${server ? `127.0.0.1:${opts.healthPort}` : '끔'}`);

    let stopping: Promise<void> | null = null;
    return {
        workerId: worker.id,
        shutdownTimeoutMs: KNOWLEDGE_RUNTIME.WORKER_SHUTDOWN_TIMEOUT_MS,
        healthPort: () => {
            const address = server?.listening ? server.address() : null;
            return address && typeof address === 'object' ? address.port : null;
        },
        stop(reason: string): Promise<void> {
            stopping ??= (async () => {
                clearInterval(pollTimer);
                logger.info(`정지 시작(${reason}) — 새 작업을 집지 않고 진행 중 작업을 최대 ${drainTimeoutMs}ms 기다린다`);
                await worker.stop({ drain: true, signal: AbortSignal.timeout(drainTimeoutMs) });
                clearInterval(heartbeatTimer);
                await removeWorkerHeartbeat(worker.id).catch((err: unknown) => logger.warn(`heartbeat 행 삭제 실패(보존 기간 뒤 지워진다): ${message(err)}`));
                const s = server;
                if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
                logger.info('정지 완료');
            })();
            return stopping;
        },
    };
}
