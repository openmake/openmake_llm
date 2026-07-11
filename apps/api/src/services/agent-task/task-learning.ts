/**
 * Agent Task 크로스-task 학습 주입 (Phase 5-2).
 *
 * 같은 사용자의 과거 유사 작업(성공/실패·사용 도구·실패 사유)을 새 task 의 system 프롬프트에
 * 압축 블록으로 주입한다 — 같은 실수(예: browser 상태 미보존, 도구 오선택)를 반복하지 않게.
 *
 * 설계 원칙:
 *  - 신규 테이블 없음: agent_tasks(결과) + agent_task_steps(도구 사용)에서 파생.
 *  - 무-LLM·결정적: 유사도는 tool-selector 의 키워드 토큰 오버랩 재사용(추가 지연·비용 0).
 *  - 절대 throw 하지 않음: 실패 시 '' 반환(작업 시작을 막지 않음).
 *
 * @module services/agent-task/task-learning
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { tokenizeGoal } from './tool-selector';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskLearning');

/** PURE: goal 간 키워드 오버랩 점수(자카드 유사). 0~1. */
export function goalSimilarity(a: string, b: string): number {
    const ta = new Set(tokenizeGoal(a));
    const tb = new Set(tokenizeGoal(b));
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
}

interface LessonSource {
    goal: string;
    status: string;
    error?: string | null;
    current_turn: number;
    tools: string[];
}

/** PURE: 교훈 1줄 렌더 — 결과·사유·도구·턴수를 압축. */
export function renderLesson(s: LessonSource): string {
    const outcome = s.status === 'completed'
        ? '성공'
        : s.status === 'failed' ? `실패(${s.error || '원인 미상'})` : '취소됨';
    const goal = s.goal.length > 80 ? s.goal.slice(0, 80) + '…' : s.goal;
    const tools = s.tools.length > 0 ? ` — 도구: ${s.tools.slice(0, 6).join(', ')}` : '';
    return `- [${outcome}] "${goal}" (${s.current_turn}턴${tools})`;
}

/**
 * 과거 유사 작업 교훈 블록 생성 — system 프롬프트에 덧붙일 텍스트('' 이면 미주입).
 * 유저 최근 terminal task 중 goal 유사도 상위 N 건(임계 이상, 자기 자신 제외).
 */
export async function buildLearningBlock(userId: string, goal: string, excludeTaskId?: string): Promise<string> {
    if (!AGENT_TASK_LIMITS.LEARNING_ENABLED) return '';
    try {
        const repo = new AgentTaskRepository(getPool());
        const recent = await repo.getRecentTerminalTaskMetas(userId, AGENT_TASK_LIMITS.LEARNING_LOOKBACK);
        const scored = recent
            .filter((t) => t.id !== excludeTaskId)
            .map((t) => ({ t, sim: goalSimilarity(goal, t.goal) }))
            .filter((x) => x.sim >= AGENT_TASK_LIMITS.LEARNING_MIN_SIMILARITY)
            .sort((a, b) => b.sim - a.sim)
            .slice(0, AGENT_TASK_LIMITS.LEARNING_MAX_LESSONS);
        if (scored.length === 0) return '';

        const lessons: string[] = [];
        for (const { t } of scored) {
            const tools = await repo.getTaskToolNames(t.id).catch(() => [] as string[]);
            lessons.push(renderLesson({ ...t, tools }));
        }
        logger.info(`[Learning] 유사 과거 작업 ${lessons.length}건 주입 (user ${userId})`);
        return [
            '',
            '## 과거 유사 작업 기록 (참고)',
            '이 사용자의 이전 작업 결과입니다. 성공 사례의 도구 선택을 참고하고,',
            '실패 사례와 같은 실수(원인 참조)를 반복하지 마세요.',
            ...lessons,
        ].join('\n');
    } catch (e) {
        logger.debug(`[Learning] 교훈 블록 생성 실패 — 미주입: ${e instanceof Error ? e.message : e}`);
        return '';
    }
}
