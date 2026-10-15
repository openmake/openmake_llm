// apps/api/src/addons/knowledge-runtime/jobs/lease.ts
/**
 * 작업 lease 문맥 — worker 가 claim 때 받은 fencing token 을 핸들러의 **모든 확정 쓰기**까지 끌고 간다 (2026-10-16, 설계 문서 9).
 *
 * 종전에는 job 행 갱신(finish·retry·heartbeat)만 token 조건부였고 청크 교체·임베딩 삽입·문서 ready 게시·index 전환은
 * 무조건 써서, lease 가 만료돼 다른 worker 가 다시 집은 작업의 옛 실행자가 결과를 덮어쓸 수 있었다.
 * 이제 확정 쓰기 트랜잭션은 첫 문장으로 `assertLeaseHeld` 를 부르고, heartbeat 가 0행을 보면 `markLost` 로 끊어
 * 핸들러가 단계 경계(`throwIfLost`)에서 멈춘다. lease 를 잃은 실행자는 job 행·문서 상태 어느 것도 쓰지 않는다.
 *
 * @module addons/knowledge-runtime/jobs/lease
 */
import type { PoolClient } from 'pg';

export class LeaseLostError extends Error {
    constructor(public readonly jobId: string, detail: string) {
        super(`작업 ${jobId} 의 lease 를 잃었다 — ${detail}`);
        this.name = 'LeaseLostError';
    }
}

export interface JobLease {
    readonly jobId: string;
    /** `knowledge_ingestion_jobs.fencing_token`(BIGINT) — pg 가 돌려준 문자열 그대로. `Number` 로 바꾸지 않는다(2^53 넘는 값 보존) */
    readonly token: string;
    readonly owner: string;
    /** heartbeat 갱신이 0행이거나 확정 쓰기 검사가 실패하면 끊긴다 — 핸들러는 단계 경계에서 `throwIfLost()` 로 멈춘다 */
    readonly signal: AbortSignal;
    /** 마지막으로 heartbeat 갱신이 성공한 시각(ms) — worker 가 갱신 오류 지속 시간을 재는 기준 */
    renewedAt: number;
    /** heartbeat 갱신 성공 때 worker 가 부른다 */
    touch(nowMs: number): void;
    /** 잃었으면 LeaseLostError */
    throwIfLost(): void;
    /** worker(heartbeat)·assertLeaseHeld 가 부른다 — 첫 사유만 남긴다 */
    markLost(detail: string): void;
}

export function createJobLease(input: { jobId: string; token: string; owner: string; now?: number }): JobLease {
    const controller = new AbortController();
    let detail = '';
    const lease: JobLease = {
        jobId: input.jobId,
        token: input.token,
        owner: input.owner,
        signal: controller.signal,
        renewedAt: input.now ?? Date.now(),
        touch(nowMs: number) {
            lease.renewedAt = nowMs;
        },
        throwIfLost() {
            if (controller.signal.aborted) throw new LeaseLostError(input.jobId, detail);
        },
        markLost(d: string) {
            if (controller.signal.aborted) return;
            detail = d;
            controller.abort();
        },
    };
    return lease;
}

/**
 * 확정 쓰기 트랜잭션의 첫 문장 — 이 작업 행이 여전히 내 token·내 owner 로 running 인지 확인하며 `FOR SHARE` 로 잠근다.
 * 잠금이 트랜잭션 끝까지 유지되므로 확인과 쓰기 사이에 다른 claim(`FOR UPDATE SKIP LOCKED`)이 이 행을 집지 못한다
 * (집으려는 쪽은 행을 건너뛰고 다음 tick 에 다시 본다). lease 가 없으면(레거시·평가 하네스 호출) 검사하지 않는다.
 */
export async function assertLeaseHeld(client: Pick<PoolClient, 'query'>, lease: JobLease | undefined): Promise<void> {
    if (!lease) return;
    lease.throwIfLost();
    const r = await client.query(
        `SELECT 1 FROM knowledge_ingestion_jobs
          WHERE id = $1 AND fencing_token = $2 AND lease_owner = $3 AND state = 'running'
          FOR SHARE`,
        [lease.jobId, lease.token, lease.owner],
    );
    if ((r.rowCount ?? 0) === 0) {
        lease.markLost('확정 쓰기 직전 검사 — 다른 실행자가 집었거나 작업이 끝났음');
        lease.throwIfLost();
    }
}
