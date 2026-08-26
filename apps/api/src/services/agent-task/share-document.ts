/**
 * 공유 문서 조립 — 원본을 통째로 내보내지 않고 **allowlist 로 새로 만든다**.
 *
 * plan `2026-08-26-agent-task-share-plan.md` §2. 제외 대상이 핵심이다:
 *   - `messages_snapshot` : 대화 전문 — 시스템 프롬프트·크로스대화 메모리·스킬 본문이 섞인다
 *   - `tool_args`         : 명령줄 원문 — 경로·비밀이 가장 많이 섞이는 곳
 *   - `workspace_path` · `device_id` · `folder_rel` : 머신 식별 정보
 *   - `assistant`/`assistant_tool_call` 원문 : 모델 사고 과정(길고 공유 가치 낮음)
 *
 * 남는 텍스트에는 `redactText` 를 적용하지만 그것은 **보조**다 — 안전의 본선은 이 선별과
 * 공유 흐름의 미리보기·명시 확인이다.
 *
 * PURE — DB 접근 없이 이미 조회된 행을 받아 변환한다(단위테스트 대상).
 *
 * @module services/agent-task/share-document
 */
import { redactText, capText } from '../../utils/redact';

/** 공유 문서에 담는 스텝 종류 — 이 목록에 없는 step_type 은 통째로 버린다. */
const SHARED_STEP_TYPES = new Set(['tool_result', 'judge', 'artifact', 'diff']);

/** 길이 상한 — 공유 문서가 통째로 커지는 것을 막는다. */
export const SHARE_LIMITS = {
    GOAL: 2000,
    RESULT: 20000,
    STEP_LINE: 300,
    DIFF: 60000,
    MAX_STEPS: 200,
} as const;

export interface ShareStepInput {
    step_number: number;
    step_type: string;
    tool_name?: string | null;
    content?: string | null;
}

export interface ShareTaskInput {
    id: string;
    goal?: string | null;
    result?: string | null;
    status?: string | null;
    current_turn?: number | null;
    created_at?: string | Date | null;
    completed_at?: string | Date | null;
    /** 정화 기준 루트 — 서버 workspace 경로. 공유 문서에는 담지 않고 치환에만 쓴다. */
    workspace_path?: string | null;
}

export interface ShareDocument {
    taskId: string;
    goal: string;
    result: string;
    status: string;
    /** 숫자 요약만 — 원문 없음 */
    summary: { turns: number; toolCalls: number; retries: number; diffs: number; artifacts: number };
    /** include_steps=false 면 빈 배열 */
    steps: { n: number; type: string; tool?: string; text: string }[];
    /** include_diff=false 면 빈 배열 */
    diffs: string[];
    createdAt: string | null;
    completedAt: string | null;
}

export interface BuildShareOptions {
    includeSteps?: boolean;
    includeDiff?: boolean;
}

function iso(v: string | Date | null | undefined): string | null {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 공유 문서를 만든다. 게시 시점에 1회 실행해 **스냅샷으로 저장**한다 — 라이브 조인하면
 * 이후 resume·재실행으로 생긴 새 민감 정보가 자동 노출된다(plan §4).
 */
export function buildShareDocument(
    task: ShareTaskInput,
    steps: ShareStepInput[],
    opts: BuildShareOptions = {},
): ShareDocument {
    const includeSteps = opts.includeSteps !== false;
    const includeDiff = opts.includeDiff !== false;
    const redactOpts = { rootPath: task.workspace_path ?? null };
    const r = (s: string): string => redactText(s, redactOpts);

    // 숫자 요약은 전체 스텝에서 센다(선별 전) — 무엇이 얼마나 있었는지는 민감하지 않다.
    const summary = {
        turns: Number(task.current_turn ?? 0),
        toolCalls: steps.filter((s) => s.step_type === 'assistant_tool_call').length,
        retries: steps.filter((s) => s.step_type === 'retry').length,
        diffs: steps.filter((s) => s.step_type === 'diff').length,
        artifacts: steps.filter((s) => s.step_type === 'artifact').length,
    };

    const shared = steps.filter((s) => SHARED_STEP_TYPES.has(s.step_type));

    const sharedSteps = !includeSteps ? [] : shared
        .filter((s) => s.step_type !== 'diff') // diff 는 별도 필드로
        .slice(0, SHARE_LIMITS.MAX_STEPS)
        .map((s) => ({
            n: s.step_number,
            type: s.step_type,
            ...(s.tool_name ? { tool: r(s.tool_name) } : {}),
            text: capText(r((s.content ?? '').replace(/\s+/g, ' ').trim()), SHARE_LIMITS.STEP_LINE),
        }))
        .filter((s) => s.text.length > 0);

    const diffs = !includeDiff ? [] : shared
        .filter((s) => s.step_type === 'diff')
        .map((s) => capText(r(s.content ?? ''), SHARE_LIMITS.DIFF))
        .filter((d) => d.length > 0);

    return {
        taskId: task.id,
        goal: capText(r(task.goal ?? ''), SHARE_LIMITS.GOAL),
        result: capText(r(task.result ?? ''), SHARE_LIMITS.RESULT),
        status: task.status ?? 'unknown',
        summary,
        steps: sharedSteps,
        diffs,
        createdAt: iso(task.created_at),
        completedAt: iso(task.completed_at),
    };
}
