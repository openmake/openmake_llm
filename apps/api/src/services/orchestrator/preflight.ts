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
import { UNSUPPORTED_CAPABILITIES, ORCHESTRATOR, CAPABILITY_LIMITS, type Capability } from '../../config/capabilities';
import { admitCapability, ADMISSION_LABEL, type ApprovedInvocationHandle } from '../../capability-contract/admission';
import { ensureLegacyCapabilityBridge } from '../../addon-host/legacy-capability-bridge';
import { reserveUserQuota, type QuotaReservation } from '../../llm/user-quota';
import { reserveServerKeyBudget, type ServerKeyReservation } from '../server-key-quota';
import { SERVER_KEY_MEDIA_RESERVE_TOKENS } from '../../config/runtime-limits';
import { QuotaExceededError } from '../../errors/quota-exceeded.error';
import { resolveCapabilityTarget, CapabilityUnavailableError, type CapabilityTarget } from './capability-resolver';
import { savedJobResultPath } from './media-io';
import type { PlanTask, ValidatedPlan } from './plan-schema';
import { resolveTaskAttachments, type AttachmentKind, type ExecContext } from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('OrchestratorPreflight');

interface PreflightResult {
    /** 실행 전에 실패로 확정된 작업 → 사유 */
    rejected: Map<string, string>;
    /** 실행 가능한 작업의 해석 결과(executor 가 재해석하지 않도록 캐시 가능 — 현재는 검증용) */
    targets: Map<string, CapabilityTarget>;
    /** 로컬 대상 작업 존재 여부(쿼터·사용량 기록 대상) */
    hasLocal: boolean;
    /** 작업별 승인 handle(P03) — 실행기는 이것이 있는 작업만, 실행 직전 재검사 후 실행한다 */
    handles: Map<string, ApprovedInvocationHandle>;
    /** 원자적 예약(P04) — 실행 후 orchestrate 가 실측으로 정산한다. 승인 전 거절은 예약 없음 */
    reservations: PreflightReservations;
}

export interface PreflightReservations {
    /** 로컬 vLLM 토큰 쿼터(per-user) — 로컬 대상 작업이 있을 때 한 번 */
    user: QuotaReservation | null;
    /** 서버 공용 키 예산 — 작업별(taskId → 예약) */
    serverKeys: Map<string, ServerKeyReservation>;
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
    // Planner 가 첨부 id 를 빠뜨린 계획 — 이 종류 첨부가 정확히 하나면 그것을 채운다(여러 개면 어느 것인지 몰라 거절 유지).
    // 실측(2026-09-15): hasa exaone-4.0-32b planner 가 이미지 이해·OCR·전사 계획에서 attachments:[] 를 냈다.
    const candidates = [...ctx.attachments.values()].filter((a) => need.has(a.kind));
    if (candidates.length === 1) {
        task.attachments = [candidates[0].id];
        logger.info(`[Preflight] ${task.id}(${task.capability}) 에 빠진 첨부 ${candidates[0].id} 보정`);
        return null;
    }
    return `${task.capability}: 필요한 첨부(${[...need].join('/')})가 계획에 없습니다`;
}

export async function preflightPlan(plan: ValidatedPlan, ctx: ExecContext): Promise<PreflightResult> {
    const rejected = new Map<string, string>();
    const targets = new Map<string, CapabilityTarget>();
    const handles = new Map<string, ApprovedInvocationHandle>();
    const reservations: PreflightReservations = { user: null, serverKeys: new Map() };
    let hasLocal = false;
    ensureLegacyCapabilityBridge();
    const now = Date.now();

    for (const task of plan.tasks) {
        // ① Registry 등록·소유 add-on 의도(관리자 중지)·상태 저장소 조회 실패 — 배정·키보다 먼저, Planner 없는 직접 경로(T23)도 같은 문
        const admission = await admitCapability(task.capability);
        if (!admission.ok) { rejected.set(task.id, `[${ADMISSION_LABEL[admission.code]}] ${admission.reason}`); continue; }
        if (UNSUPPORTED_CAPABILITIES.has(task.capability)) { rejected.set(task.id, `[unsupported] ${task.capability}: 검증된 provider 어댑터가 아직 없습니다`); continue; }
        const inputErr = inputProblem(task, ctx);
        if (inputErr) { rejected.set(task.id, `[input] ${inputErr}`); continue; }
        const handle: ApprovedInvocationHandle = {
            taskId: task.id, capability: task.capability, userId: ctx.userId, sessionId: ctx.sessionId,
            owner: admission.owner, registryRevision: admission.registryRevision, stateRevision: admission.stateRevision,
            issuedAt: now, deadline: now + ORCHESTRATOR.TURN_DEADLINE_MS,
        };
        if (task.capability === 'web.search') { handles.set(task.id, handle); continue; } // 모델 배정 없음
        // 완료·저장된 job 결과 조회는 외부 키 없이 반환되므로 배정·키 검사를 요구하지 않는다(Codex 검토 4 — T15)
        if (task.attachments.some((id) => savedJobResultPath(ctx.attachments.get(id), task.capability))) { handles.set(task.id, handle); continue; }
        try {
            const target = await resolveCapabilityTarget(task.capability, ctx.userId);
            // 서버 공용 키는 check-only 가 아니라 **원자적 예약**(T24) — 동시 요청이 각각 통과해 총한도를 넘지 못한다
            if (target.costOwner === 'server' && target.serverBudget) {
                const r = await reserveServerKeyBudget(target.providerId, SERVER_KEY_MEDIA_RESERVE_TOKENS, target.serverBudget.dailyTokenLimit, target.serverBudget.monthlyTokenLimit, now);
                if ('rejected' in r) { rejected.set(task.id, `[budget] ${r.rejected}`); continue; }
                reservations.serverKeys.set(task.id, r.reservation);
            }
            targets.set(task.id, target);
            handles.set(task.id, handle);
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

    // 로컬 vLLM 용량 보호 — per-user 토큰 쿼터를 **선예약**(종전 check-only → reserve/settle, 계획서 9.2). 실측은 orchestrate 가 정산
    if (hasLocal && ctx.userId) {
        const localTasks = [...targets.values()].filter((t) => t.providerId === 'local-llm').length;
        try {
            reservations.user = await reserveUserQuota(ctx.userId, localTasks * CAPABILITY_LIMITS.TEXT_MAX_TOKENS, now);
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                for (const [id, t] of targets) if (t.providerId === 'local-llm' && !rejected.has(id)) rejected.set(id, `[quota] ${err.message}`);
            } else {
                throw err;
            }
        }
    }
    for (const id of rejected.keys()) handles.delete(id);
    return { rejected, targets, hasLocal, handles, reservations };
}
