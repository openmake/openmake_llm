/**
 * @module services/orchestrator/preflight
 * @description 실행 승인 경계 — Planner JSON 이 검증을 통과했더라도 **실행 전에** 서버가 계산한 조건으로 작업을 거른다.
 *
 * 계승하는 기존 정책(Codex 4차 검토 반영, 2026-09-12):
 *  - 로컬 vLLM 용량 보호: `LLM_HOURLY/WEEKLY_TOKEN_LIMIT` per-user 쿼터(`llm/user-quota`) — 로컬 대상 작업이 하나라도 있으면
 *    실행 전 `checkUserQuota`, 실행 후 토큰을 `recordUserUsage`(orchestrate). 외부 BYOK 는 종전대로 쿼터 면제 + 사용량 기록.
 *  - 모델 사용 가능 여부: capability 배정·게이트웨이 편입·BYOK 상태(누락/비활성/OAuth)·조회 장애 → `capability-resolver` 의 명시 실패를
 *    실행 전에 확정(자식은 skipped, 과금 없음).
 *  - 어댑터 지원: `UNSUPPORTED_CAPABILITIES` 는 `unsupported` 로 즉시 실패.
 *  - 입력 형식: capability 가 요구하는 첨부 종류(이미지/오디오·영상/텍스트)가 계획에 실제로 있는지.
 *  변경한 정책: 종전 미디어 tool 은 역할 게이트 없이 전 사용자에게 열려 있었다 — 그대로(추가 권한 체계 없음).
 *  인증 컨텍스트는 호출부(message-pipeline)가 req.userId 로 넘기며, userId 없는 게스트는 외부 BYOK 가 없어 로컬 기본값만 쓴다.
 */
import { UNSUPPORTED_CAPABILITIES, type Capability } from '../../config/capabilities';
import { checkUserQuota } from '../../llm/user-quota';
import { QuotaExceededError } from '../../errors/quota-exceeded.error';
import { resolveCapabilityTarget, CapabilityUnavailableError, type CapabilityTarget } from './capability-resolver';
import type { PlanTask, ValidatedPlan } from './plan-schema';
import { resolveTaskAttachments, type AttachmentKind, type ExecContext } from './types';

export interface PreflightResult {
    /** 실행 전에 실패로 확정된 작업 → 사유 */
    rejected: Map<string, string>;
    /** 실행 가능한 작업의 해석 결과(executor 가 재해석하지 않도록 캐시 가능 — 현재는 검증용) */
    targets: Map<string, CapabilityTarget>;
    /** 로컬 대상 작업 존재 여부(쿼터·사용량 기록 대상) */
    hasLocal: boolean;
}

/** capability 별 필수 첨부 종류 — 계획에 없으면 실행하지 않는다(모델 호출·과금 전에 거절) */
const REQUIRED_INPUT: Partial<Record<Capability, ReadonlySet<AttachmentKind>>> = {
    'vision.describe': new Set(['image']),
    'vision.ocr': new Set(['image']),
    'image.edit': new Set(['image']),
    'audio.transcribe': new Set(['audio', 'video']),
    'video.analyze': new Set(['video']),
    'audio.analyze': new Set(['audio']),
    'music.analyze': new Set(['audio']),
};

function inputProblem(task: PlanTask, ctx: ExecContext): string | null {
    const need = REQUIRED_INPUT[task.capability];
    if (!need) return null;
    // refs 가 있으면 앞 작업의 미디어 산출물이 올 수 있으므로(실행 시점에야 확정) 첨부 id 만 검사
    const direct = resolveTaskAttachments({ ...task, refs: [] }, ctx, need);
    if (direct.length > 0) return null;
    if (task.refs.length > 0) return null;
    if (task.capability === 'video.generate') return null;
    return `${task.capability}: 필요한 첨부(${[...need].join('/')})가 계획에 없습니다`;
}

export async function preflightPlan(plan: ValidatedPlan, ctx: ExecContext): Promise<PreflightResult> {
    const rejected = new Map<string, string>();
    const targets = new Map<string, CapabilityTarget>();
    let hasLocal = false;

    for (const task of plan.tasks) {
        if (UNSUPPORTED_CAPABILITIES.has(task.capability)) { rejected.set(task.id, `[unsupported] ${task.capability}: 검증된 provider 어댑터가 아직 없습니다`); continue; }
        const inputErr = inputProblem(task, ctx);
        if (inputErr) { rejected.set(task.id, `[input] ${inputErr}`); continue; }
        if (task.capability === 'web.search') continue; // 모델 배정 없음
        try {
            const target = await resolveCapabilityTarget(task.capability, ctx.userId);
            targets.set(task.id, target);
            if (target.providerId === 'local-llm') hasLocal = true;
        } catch (err) {
            if (err instanceof CapabilityUnavailableError) {
                const kind = err.code === 'CAPABILITY_UNASSIGNED' ? 'unassigned' : 'unavailable';
                rejected.set(task.id, `[${kind}] ${err.message}`);
            } else {
                rejected.set(task.id, `[unavailable] ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // 로컬 vLLM 용량 보호 — per-user 토큰 쿼터(종전 LLMClient 경로와 같은 정책)
    if (hasLocal && ctx.userId) {
        try {
            await checkUserQuota(ctx.userId, Date.now());
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                for (const [id, t] of targets) if (t.providerId === 'local-llm' && !rejected.has(id)) rejected.set(id, `[quota] ${err.message}`);
            } else {
                throw err;
            }
        }
    }
    return { rejected, targets, hasLocal };
}
