/**
 * spawn_agents 끝난 서브 결과의 즉시 기록·재사용 — fan-out 도중 서버가 재시작되면 부모는 같은 spawn_agents 호출을
 * 다시 실행한다(결과 없는 도구 호출 재진입). 종전에는 결과가 fan-out 전체가 끝난 뒤에만 남아 끝난 서브까지 전부 다시 돌았다.
 *
 * 저장 자리는 서브에이전트 체크포인트 표(173)를 그대로 쓴다 — 키 머리(`spawn-result|`)가 달라 주차된 delegate 대화와
 * 겹치지 않는다. fan-out 이 끝나면 지우므로 남아 있는 행은 "도중에 끊긴 fan-out 의 끝난 서브"뿐이다.
 * 읽기·쓰기 실패는 실행을 막지 않는다(fail-open — 못 읽으면 다시 돌 뿐이다).
 *
 * @module services/agent-spawn/spawn-result-store
 */
import { createHash } from 'crypto';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AgentTaskSubagentStepRepository } from '../../data/repositories/agent-task-subagent-step-repository';
import { SUBAGENT_EXIT_REASONS, type SubagentExitReason } from '../../config/agent-task-delegation';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentSpawnResultStore');

interface SpawnTaskIdentity { prompt: string; role?: string; agentId?: string }

export interface StoredSpawnResult { result: string; exit: SubagentExitReason }

/** PURE: 태스크 식별 키 — 재개된 부모가 같은 태스크(같은 지시·역할·에이전트)를 다시 맡길 때 끝난 결과를 찾는다. */
export function spawnResultKey(task: SpawnTaskIdentity): string {
    return createHash('sha256').update(`spawn-result|${task.role ?? ''}|${task.agentId ?? ''}|${task.prompt}`).digest('hex');
}

function isStored(v: unknown): v is StoredSpawnResult {
    const o = v as Partial<StoredSpawnResult> | null;
    return !!o && typeof o.result === 'string' && SUBAGENT_EXIT_REASONS.includes(o.exit as SubagentExitReason);
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SpawnResultStore {
    private readonly repo = new AgentTaskSubagentStepRepository(getUnifiedDatabase().getPool());

    constructor(private readonly taskId: string) {}

    async load(task: SpawnTaskIdentity): Promise<StoredSpawnResult | null> {
        try {
            const first = (await this.repo.loadCheckpoint(this.taskId, spawnResultKey(task)))?.conversation[0];
            return isStored(first) ? first : null;
        } catch (e) {
            logger.warn(`[${this.taskId}] 끝난 서브 결과 조회 실패 — 다시 실행: ${why(e)}`);
            return null;
        }
    }

    async save(task: SpawnTaskIdentity, stored: StoredSpawnResult): Promise<void> {
        await this.repo.saveCheckpoint({
            task_id: this.taskId, ckpt_key: spawnResultKey(task), conversation: [stored], turn: 0, tokens: 0, trace_id: null, trace_seq: 0,
        }).catch((e) => logger.warn(`[${this.taskId}] 끝난 서브 결과 기록 실패 — 재개 때 다시 실행: ${why(e)}`));
    }

    async clear(tasks: ReadonlyArray<SpawnTaskIdentity>): Promise<void> {
        await Promise.all(tasks.map((task) => this.repo.deleteCheckpoint(this.taskId, spawnResultKey(task))
            .catch(() => { /* 남아도 같은 태스크가 다시 올 때만 쓰인다 */ })));
    }
}
