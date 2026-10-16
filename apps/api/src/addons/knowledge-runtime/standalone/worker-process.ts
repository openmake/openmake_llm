/**
 * Knowledge 수집 worker 별도 프로세스 본체 — API 를 띄우지 않고 수집 poller 만 돈다(설계 D5, external 모드).
 * Base 진입점(`workers/knowledge-worker.ts`)이 설정·시스템 설정 overlay·종료 신호를 맡고, 매니페스트
 * `entry.workers[name=knowledge-ingest]` 로 이 함수를 찾아 부른다(addon-host/worker-entry).
 *
 * 기동: ① add-on 마이그레이션 004 확인 — API 가 아직 적용하지 않았으면 `WORKER_SCHEMA_WAIT_MS` 까지 기다린다.
 *       끝내 행이 없으면 AddonWorkerConfigError(진입점이 종료 코드 78 로 끝내 PM2 재시작 루프를 막는다),
 *       마지막 조회가 DB 오류였으면 일반 오류(종료 코드 1 — PM2 가 다시 띄운다. 재부팅 때 DB 가 늦게 뜨는 경우)
 *       ② add-on 상태 캐시 적재 ③ 작은 HTTP `/health`(127.0.0.1, 포트 0 이면 끔 — 묶지 못하면 설정 오류 78)
 *       ④ heartbeat 행(즉시 1회 + 주기) ⑤ worker(consumerKind external) 폴링 — 타이머는 /health 를 묶은 뒤에 건다
 * 정지: 폴링 중단 → worker.stop(drain, `WORKER_DRAIN_TIMEOUT_MS` — 넘으면 C1 규칙대로 lease 반납) → heartbeat 중단
 *       → 진행 중 heartbeat 쓰기를 기다린 뒤 행 삭제(늦은 쓰기가 행을 되살리지 않게) → /health 닫기. DB 풀은 진입점이 닫는다.
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

/** 004 기록 조회 결과 — 행 없음(absent)과 조회 실패(error)를 나눈다(실패를 "없음"으로 보면 DB 일시 장애가 78 이 된다) */
type SchemaProbe = 'present' | 'absent' | 'error';

async function probeSchema(): Promise<SchemaProbe> {
    try {
        const r = await kdb().query('SELECT 1 FROM migration_versions WHERE version = $1', [REQUIRED_JOB_SCHEMA_VERSION]);
        return (r.rowCount ?? 0) > 0 ? 'present' : 'absent';
    } catch (err) {
        logger.warn(`마이그레이션 기록 조회 실패(대기 상한까지 다시): ${message(err)}`);
        return 'error';
    }
}

/**
 * 004 가 적용될 때까지 기다린다 — API 가 먼저 떠서 적용한다(배포 순서가 뒤바뀌어도 바로 죽지 않게).
 * 조회 오류도 상한까지 다시 시도한다 — 한 번의 시도가 PM2 min_uptime(10초)보다 오래 살아야 재시작 횟수 상한에 걸리지 않는다.
 * 돌려주는 값은 마지막 조회 결과다.
 */
async function waitForSchema(waitMs: number): Promise<SchemaProbe> {
    const deadline = Date.now() + waitMs;
    for (;;) {
        const probe = await probeSchema();
        if (probe === 'present' || Date.now() >= deadline) return probe;
        if (probe === 'absent') logger.warn(`add-on 마이그레이션 ${REQUIRED_JOB_SCHEMA_VERSION} 대기 중 — API 가 먼저 떠서 적용한다`);
        await new Promise((resolve) => setTimeout(resolve, KNOWLEDGE_RUNTIME.WORKER_SCHEMA_POLL_MS));
    }
}

/** 대기 상한에서의 마지막 조회 결과 → 기동 실패 오류. 행 없음만 설정 오류(78), DB 오류는 일반 오류(1 — PM2 재시작) */
const SCHEMA_WAIT_FAILURES: Record<Exclude<SchemaProbe, 'present'>, () => Error> = {
    absent: () => new AddonWorkerConfigError(
        `Knowledge add-on 마이그레이션 ${REQUIRED_JOB_SCHEMA_VERSION} 이 없다 — API 를 먼저 배포해 add-on 마이그레이션을 적용한 뒤 기동한다`,
    ),
    error: () => new Error(
        `Knowledge add-on 마이그레이션 ${REQUIRED_JOB_SCHEMA_VERSION} 확인 조회가 대기 상한까지 실패했다(DB 접속 확인) — 종료 코드 1 로 끝내 PM2 가 다시 띄운다`,
    ),
};

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
    const probe = await waitForSchema(opts.migrationWaitMs ?? KNOWLEDGE_RUNTIME.WORKER_SCHEMA_WAIT_MS);
    if (probe !== 'present') throw SCHEMA_WAIT_FAILURES[probe]();
    await warmAddonStates();

    const worker = new KnowledgeWorker({ consumerKind: PROCESS_KIND });
    const view: ProcessView = { dbMode: null, generation: null, lastHeartbeatAt: null };

    // /health 를 먼저 묶는다 — 묶지 못하면 폴링·heartbeat 타이머를 걸기 전에 끝낸다.
    // 포트 충돌(EADDRINUSE 등)은 설정 오류로 본다(78): 재시작해도 같은 포트에 다시 부딪혀 PM2 재시작 상한만 태우고
    // errored 로 끝나므로, 분명한 안내와 함께 멈추고 사람이 KNOWLEDGE_WORKER_HEALTH_PORT 를 고친다.
    let server: Server | null = null;
    if (opts.healthPort > 0) {
        try {
            server = await startHealthServer(opts.healthPort, () => ({
                ...worker.health(),
                kind: PROCESS_KIND,
                workerId: worker.id,
                dbMode: view.dbMode,
                generation: view.generation,
                lastClaimAt: iso(worker.lastClaimAt()),
                lastHeartbeatAt: iso(view.lastHeartbeatAt),
            }));
        } catch (err) {
            throw new AddonWorkerConfigError(
                `/health 를 127.0.0.1:${opts.healthPort} 에 열지 못했다(${message(err)}) — KNOWLEDGE_WORKER_HEALTH_PORT 를 비어 있는 포트나 0(끔)으로 바꾼다`,
            );
        }
    }

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
    // 진행 중 heartbeat 쓰기 — 정지가 행을 지우기 전에 기다린다(겹친 주기는 새로 쓰지 않고 진행 중인 것을 함께 기다린다)
    let beating: Promise<void> | null = null;
    const runBeat = (): Promise<void> => (beating ??= beat().finally(() => { beating = null; }));

    await runBeat();
    const heartbeatTimer = setInterval(() => { void runBeat(); }, KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_MS);
    const pollTimer = setInterval(() => {
        void worker.tick().catch((err: unknown) => logger.warn(`수집 worker tick 실패(무시): ${message(err)}`));
    }, KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);
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
                await beating;
                await removeWorkerHeartbeat(worker.id).catch((err: unknown) => logger.warn(`heartbeat 행 삭제 실패(보존 기간 뒤 지워진다): ${message(err)}`));
                const s = server;
                if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
                logger.info('정지 완료');
            })();
            return stopping;
        },
    };
}
