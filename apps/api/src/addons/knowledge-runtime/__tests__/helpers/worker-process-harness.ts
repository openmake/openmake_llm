/**
 * 별도 worker 프로세스 실 DB 테스트 공용 — 가짜 임베딩 게이트웨이(HTTP), 자식 프로세스(ts-node transpile-only 로
 * Base 진입점 workers/knowledge-worker.ts 실행), 대기, 수집 fixture, lease 단축. 테스트 전용 파일(.test 아님).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';

// __tests__/helpers → apps/api
const API_DIR = resolve(__dirname, '../../../../..');
const WORKER_ENTRY = resolve(API_DIR, 'src/workers/knowledge-worker.ts');
const POLL_MS = 100;

/** 가짜 임베딩 차원·모델 — 테스트 활성 index 행과 같아야 한다 */
export const FAKE_DIM = 8;
export const FAKE_MODEL = 'fake-embed';

/** 결정적 가짜 벡터 — 같은 텍스트면 같은 벡터(두 모드 비교용) */
export function fakeVector(text: string): number[] {
    const v = new Array<number>(FAKE_DIM).fill(0);
    for (let i = 0; i < text.length; i++) v[i % FAKE_DIM] += text.charCodeAt(i) % 97;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
}

export interface FakeGateway {
    url: string;
    requests(): number;
    /** 응답을 붙잡아 둔 요청 수 */
    pending(): number;
    /** true 면 새 요청의 응답을 붙잡는다(실행자가 임베딩 호출에서 멈춘 상태를 만든다) */
    hold(on: boolean): void;
    releaseAll(): void;
    close(): Promise<void>;
}

/** OpenAI 호환 /v1/embeddings 가짜 — 경로는 보지 않고 { input: string[] } 에 벡터를 돌려준다 */
export async function startFakeGateway(embed: (text: string) => number[]): Promise<FakeGateway> {
    let holding = false;
    let count = 0;
    const waiting: Array<() => void> = [];
    const sockets = new Set<Socket>();
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
            count++;
            const respond = (): void => {
                const input = (JSON.parse(body || '{}') as { input?: string[] }).input ?? [];
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: embed(t) })) }));
            };
            if (holding) waiting.push(respond);
            else respond();
        });
    });
    server.on('connection', (s: Socket) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}`,
        requests: () => count,
        pending: () => waiting.length,
        hold: (on) => { holding = on; },
        releaseAll: () => { for (const respond of waiting.splice(0)) respond(); },
        close: () => new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
        }),
    };
}

export function freePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const s = createNetServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const a = s.address();
            s.close(() => resolvePort(typeof a === 'object' && a ? a.port : 0));
        });
    });
}

/** 자식 worker 의 env — 짧은 폴링·heartbeat·캐시로 테스트 시간을 줄인다. .env 의 같은 키는 dotenv 가 덮지 않는다 */
export function workerEnv(o: { databaseUrl: string; gatewayUrl: string; storageDir: string; healthPort?: number }): NodeJS.ProcessEnv {
    return {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: o.databaseUrl,
        LLM_BASE_URL: o.gatewayUrl,
        LLM_API_KEY: 'test-key',
        ADDON_BUILTIN_DISABLED: '',
        KNOWLEDGE_STORAGE_DIR: o.storageDir,
        KNOWLEDGE_WORKER_MODE: 'external',
        KNOWLEDGE_WORKER_HEALTH_PORT: String(o.healthPort ?? 0),
        KNOWLEDGE_JOB_POLL_INTERVAL_MS: '200',
        KNOWLEDGE_PROFILE_CACHE_TTL_MS: '100',
        KNOWLEDGE_WORKER_HEARTBEAT_MS: '300',
        KNOWLEDGE_WORKER_DRAIN_TIMEOUT_MS: '10000',
        ADDON_STATE_CACHE_TTL_MS: '200',
    };
}

export interface WorkerChild {
    proc: ChildProcess;
    output: string[];
    exited: Promise<number | null>;
}

export function spawnWorker(env: NodeJS.ProcessEnv): WorkerChild {
    const proc = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', WORKER_ENTRY], { cwd: API_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const output: string[] = [];
    proc.stdout?.on('data', (d: Buffer) => output.push(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => output.push(d.toString()));
    const exited = new Promise<number | null>((r) => proc.once('exit', (code) => r(code)));
    return { proc, output, exited };
}

/** 신호를 보내고 끝나기를 기다린다 — 상한을 넘기면 SIGKILL. 종료 코드(신호로 죽었으면 null) */
export async function stopWorker(child: WorkerChild, signal: NodeJS.Signals, timeoutMs: number): Promise<number | null> {
    if (child.proc.exitCode !== null || child.proc.signalCode !== null) return child.proc.exitCode;
    child.proc.kill(signal);
    const timedOut = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
    const result = await Promise.race([child.exited, timedOut]);
    if (result !== 'timeout') return result;
    child.proc.kill('SIGKILL');
    return child.exited;
}

export async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs: number, label: string, child?: WorkerChild): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await read();
        if (done(value)) return value;
        if (Date.now() > deadline) {
            throw new Error(`대기 초과(${timeoutMs}ms): ${label} — 마지막 값 ${JSON.stringify(value)}${child ? `\n--- worker 출력 ---\n${child.output.join('')}` : ''}`);
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
}

/** 가짜 모델의 활성 index — local-llm 태그라 게이트웨이(LLM_BASE_URL)로 임베딩한다 */
export async function activateFakeIndex(pool: Pool): Promise<string> {
    const id = randomUUID();
    await pool.query('UPDATE knowledge_embedding_indexes SET is_active = FALSE WHERE is_active');
    await pool.query(
        `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at)
         VALUES ($1, $2, $3, $4, 'cosine', 'ready', TRUE, NOW())`,
        [id, `local-llm:${FAKE_MODEL}`, FAKE_MODEL, FAKE_DIM],
    );
    return id;
}

export interface IngestFixture { space: string; doc: string; version: string; job: string }

/** text/plain 수집 작업 하나 — 원본을 storageDir/<versionId> 에 쓰고, 시스템 actor·하루 전 due 로 넣는다(가장 먼저 집힌다) */
export async function insertIngestFixture(pool: Pool, storageDir: string, text: string): Promise<IngestFixture> {
    const f = { space: randomUUID(), doc: randomUUID(), version: randomUUID(), job: randomUUID() };
    await pool.query(`INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name) VALUES ($1, 'user', 'proc-test', 'proc-test', 'proc')`, [f.space]);
    await pool.query(`INSERT INTO knowledge_documents (id, space_id, logical_name, created_by) VALUES ($1, $2, 'proc.txt', 'proc-test')`, [f.doc, f.space]);
    await writeFile(join(storageDir, f.version), text, 'utf8');
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size)
         VALUES ($1, $2, $3, 'text/plain', 'proc.txt', $1, $4)`,
        [f.version, f.doc, createHash('sha256').update(text).digest('hex'), Buffer.byteLength(text)],
    );
    await pool.query(
        `INSERT INTO knowledge_ingestion_jobs (id, kind, document_version_id, space_id, actor_kind, run_after)
         VALUES ($1, 'ingest', $2, $3, 'system', NOW() - INTERVAL '1 day')`,
        [f.job, f.version, f.space],
    );
    return f;
}

export interface JobSnapshot {
    state: string;
    fencing_token: string;
    attempts: number;
    version_status: string;
    failure_code: string | null;
    chunks: number;
    embeddings: number;
}

export async function jobSnapshot(pool: Pool, jobId: string): Promise<JobSnapshot> {
    return (await pool.query<JobSnapshot>(
        `SELECT j.state, j.fencing_token, j.attempts, v.status AS version_status, v.failure_code,
                (SELECT COUNT(*)::int FROM knowledge_chunks c WHERE c.document_version_id = v.id) AS chunks,
                (SELECT COUNT(*)::int FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
                  WHERE c.document_version_id = v.id) AS embeddings
           FROM knowledge_ingestion_jobs j JOIN knowledge_document_versions v ON v.id = j.document_version_id
          WHERE j.id = $1`,
        [jobId],
    )).rows[0];
}

/** 기본 limits 프로필의 jobLeaseMs 를 바꾸고 되돌리는 함수를 돌려준다(heartbeat 주기 = max(1초, lease × 0.4)) */
export async function setJobLeaseMs(pool: Pool, ms: number): Promise<() => Promise<void>> {
    const before = await pool.query<{ v: string | null }>(`SELECT config->>'jobLeaseMs' AS v FROM knowledge_profiles WHERE kind = 'limits' AND is_default`);
    const original = before.rows[0]?.v ?? null;
    await pool.query(`UPDATE knowledge_profiles SET config = jsonb_set(config, '{jobLeaseMs}', to_jsonb($1::int)) WHERE kind = 'limits' AND is_default`, [ms]);
    return async () => {
        if (original === null) {
            await pool.query(`UPDATE knowledge_profiles SET config = config - 'jobLeaseMs' WHERE kind = 'limits' AND is_default`);
            return;
        }
        await pool.query(`UPDATE knowledge_profiles SET config = jsonb_set(config, '{jobLeaseMs}', to_jsonb($1::int)) WHERE kind = 'limits' AND is_default`, [Number(original)]);
    };
}

/** 이 테스트 DB 가 전체 스키마(setup-test-db.sh)인지 — 자식 worker 는 addon_installations·system_settings 를 읽는다 */
export async function assertFullTestSchema(pool: Pool): Promise<void> {
    const r = await pool.query<{ t: string | null }>(`SELECT to_regclass('addon_installations')::text AS t`);
    if (!r.rows[0]?.t) throw new Error('TEST_DATABASE_URL 이 전체 스키마가 아니다 — scripts/setup-test-db.sh 로 만든 DB 를 쓴다(addon_installations 없음)');
}
