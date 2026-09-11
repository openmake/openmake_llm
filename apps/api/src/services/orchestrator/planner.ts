/**
 * @module services/orchestrator/planner
 * @description Planner — 역할 `planner` 모델 1회 호출로 capability 작업 계획(JSON)을 얻는다.
 *
 * ⚠️ 판단 경계: 앞단 LLM 판단(A형). 사용자 결정(2026-09-12)으로 모든 턴에 도입하되
 *  - JSON 스키마 강제(로컬 vLLM json_schema / 외부 response_format) + max_tokens 상한
 *  - 타임아웃·검증 실패는 **fail-open**(null 반환 → 종전 단일 경로), 재시도 1회
 *  - 계획 시간·결과를 orchestrator_runs 에 적재(비용 재판정 근거)
 */
import { ORCHESTRATOR } from '../../config/capabilities';
import { resolveRoleClientForUser } from '../model-role-resolver';
import { getPlannerSystemPrompt, buildPlannerUserPrompt, type PlannerAttachmentMeta } from '../../prompts/orchestrator-planner';
import { extractPlanJson, validatePlan, PLAN_JSON_SCHEMA, type ValidatedPlan } from './plan-schema';
import type { ChatMessage, FormatOption } from '../../llm/types';
import { createLogger } from '../../utils/logger';
import { combineSignals } from './http-call';

const logger = createLogger('OrchestratorPlanner');

export interface PlannerInput {
    message: string;
    attachments: PlannerAttachmentMeta[];
    recentTurns: Array<{ role: string; content: string }>;
    lang: string;
    userId?: string;
    signal?: AbortSignal;
}

export interface PlannerOutcome {
    plan: ValidatedPlan | null;
    /** 해석된 planner 모델 fullId (관측) */
    model: string;
    ms: number;
    error?: string;
    attempts: number;
}

/** LLM 호출 함수 — 테스트에서 주입 */
export type PlannerLlmCall = (messages: ChatMessage[], format: FormatOption, signal: AbortSignal) => Promise<string>;

async function defaultLlmCall(userId: string | undefined): Promise<{ call: PlannerLlmCall; model: string }> {
    const resolved = await resolveRoleClientForUser('planner', userId);
    const call: PlannerLlmCall = async (messages, format, signal) => {
        const r = await resolved.client.chat(
            messages,
            { num_predict: ORCHESTRATOR.PLANNER_MAX_TOKENS, temperature: 0 },
            undefined,
            { think: false, format, signal },
        );
        return r.content ?? '';
    };
    return { call, model: resolved.fullId };
}

export async function planRequest(input: PlannerInput, llm?: { call: PlannerLlmCall; model: string }): Promise<PlannerOutcome> {
    const startedAt = Date.now();
    const deadline = startedAt + ORCHESTRATOR.PLANNER_TOTAL_DEADLINE_MS;
    const cancelled = (): PlannerOutcome | null => input.signal?.aborted
        ? { plan: null, model: 'cancelled', ms: Date.now() - startedAt, error: 'cancelled', attempts: 0 }
        : null;
    // 진입 전 취소 검사 — 취소된 요청은 모델 해석조차 시작하지 않는다
    const early = cancelled(); if (early) return early;

    let resolved: { call: PlannerLlmCall; model: string };
    try {
        resolved = llm ?? await defaultLlmCall(input.userId);
    } catch (err) {
        return { plan: null, model: 'unresolved', ms: Date.now() - startedAt, error: `planner 모델 해석 실패: ${err instanceof Error ? err.message : String(err)}`, attempts: 0 };
    }
    const afterResolve = cancelled(); if (afterResolve) return afterResolve;

    const known = new Set(input.attachments.map((a) => a.id));
    const messages: ChatMessage[] = [
        { role: 'system', content: getPlannerSystemPrompt(input.lang) },
        { role: 'user', content: buildPlannerUserPrompt({ ...input, message: input.message.slice(0, ORCHESTRATOR.PLANNER_MESSAGE_MAX_CHARS) }) },
    ];
    const format: FormatOption = PLAN_JSON_SCHEMA as unknown as FormatOption;

    let lastError = '';
    let attempts = 0;
    const maxAttempts = 1 + Math.max(0, ORCHESTRATOR.PLANNER_RETRIES);
    while (attempts < maxAttempts) {
        // 매 시도 전 취소·전체 deadline 검사 — 사용자 취소는 timeout/fallback 과 구분해 새 호출을 시작하지 않는다
        if (input.signal?.aborted) return { plan: null, model: resolved.model, ms: Date.now() - startedAt, error: 'cancelled', attempts };
        const remaining = deadline - Date.now();
        if (remaining <= 0) { lastError = `total deadline ${ORCHESTRATOR.PLANNER_TOTAL_DEADLINE_MS}ms`; break; }
        attempts++;
        const perAttempt = Math.min(ORCHESTRATOR.PLANNER_TIMEOUT_MS, remaining);
        const signal = combineSignals(input.signal, AbortSignal.timeout(perAttempt));
        try {
            const text = await resolved.call(messages, format, signal);
            const json = extractPlanJson(text);
            if (json === null) { lastError = `JSON 파싱 실패: ${text.slice(0, 120)}`; }
            else {
                const v = validatePlan(json, known);
                if (v.ok) {
                    const ms = Date.now() - startedAt;
                    logger.info(`[Planner] ${v.plan.complexity} tasks=${v.plan.tasks.length} levels=${v.plan.levels.length} (${resolved.model}, ${ms}ms, attempt ${attempts})`);
                    return { plan: v.plan, model: resolved.model, ms, attempts };
                }
                lastError = v.reason;
            }
            // 재시도 프롬프트에 실패 사유를 싣는다(모델이 같은 실수를 반복하지 않도록)
            messages.push({ role: 'assistant', content: text.slice(0, 2000) });
            messages.push({ role: 'user', content: `계획이 거부되었습니다: ${lastError}. 규칙에 맞는 JSON 만 다시 출력하세요.` });
        } catch (err) {
            if (input.signal?.aborted) return { plan: null, model: resolved.model, ms: Date.now() - startedAt, error: 'cancelled', attempts };
            lastError = signal.aborted ? `timeout ${perAttempt}ms` : (err instanceof Error ? err.message : String(err));
        }
        logger.warn(`[Planner] attempt ${attempts} 실패: ${lastError}`);
    }
    return { plan: null, model: resolved.model, ms: Date.now() - startedAt, error: lastError, attempts };
}
