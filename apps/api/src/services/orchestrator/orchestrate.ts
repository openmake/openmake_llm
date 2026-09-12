/**
 * @module services/orchestrator/orchestrate
 * @description 채팅 턴 진입점 — Planner → (multi 면) Executor → 종합용 컨텍스트 블록 + 미디어 산출물.
 *
 * 결과 계약(호출부 message-pipeline):
 *  - `simple`   : 계획이 텍스트 하나 → 종전 단일 경로 그대로(추가 호출 0)
 *  - `executed` : 작업 결과 블록을 enhancedMessage 에 덧붙이고, **성공한** 미디어만 결정적 첨부 목록으로 넘긴다
 *  - `fallback` : Planner 실패/타임아웃 → 종전 경로 + "이번 턴 미디어 기능 미실행" 노트(생성 완료로 오인 방지)
 *  - `cancelled`: 사용자 취소 → 호출부가 종전 경로도 시작하지 않는다
 * 셰도우(orchestrator_runs)는 fire-and-forget.
 */
import { ORCHESTRATOR, CAPABILITY_LABELS_KO, VIDEO_JOB_FOLLOWUP_PATTERN, VIDEO_JOB_RESULT_INTENT_PATTERN, VIDEO_JOB_NOT_FOLLOWUP_PATTERN, type Capability } from '../../config/capabilities';
import { getPool } from '../../data/models/unified-database';
import { OrchestratorRunsRepository } from '../../data/repositories/orchestrator-runs-repo';
import type { ChatMessageRequest } from '../chat-service-types';
import { planRequest } from './planner';
import { validatePlan, type ValidatedPlan } from './plan-schema';
import { executePlan } from './executor';
import { preflightPlan } from './preflight';
import { OrchestratorJobsRepository } from '../../data/repositories/orchestrator-jobs-repo';
import { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
import { ServerExternalKeysRepository } from '../../data/repositories/server-external-keys-repo';
import { recordServerKeyUsage } from '../server-key-quota';
import type { CapabilityTarget } from './capability-resolver';
import { recordUserUsage } from '../../llm/user-quota';
import { isExternalFullId } from '../../config/model-roles';
import { kindFromMime, mimeFromName } from './media-io';
import type { PlannerAttachmentMeta } from '../../prompts/orchestrator-planner';
import type { ExecContext, OrchestratorAttachment, OrchestratorProgressEvent, TaskMedia, TaskResult } from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Orchestrator');

export interface OrchestratorOutcome {
    mode: 'simple' | 'executed' | 'fallback' | 'cancelled';
    /** executed: 종합 모델에 넘길 작업 결과 블록 / fallback: 미실행 노트 */
    contextBlock?: string;
    /** executed: 성공한 작업의 미디어 마크다운(결정적 첨부) */
    mediaMarkdowns: string[];
    plannerMs: number;
    execMs?: number;
}

const GENERATED_LINK_RE = /\((\/generated\/[A-Za-z0-9._-]+)\)/g;

/** 사용자 첨부(a*) + 직전 턴 생성 미디어(m*, history 의 /generated 링크) */
export function collectAttachments(req: ChatMessageRequest): Map<string, OrchestratorAttachment> {
    const map = new Map<string, OrchestratorAttachment>();
    let n = 0;
    for (const img of req.images ?? []) {
        n++;
        const m = /^data:([^;]+);base64,/.exec(img);
        map.set(`a${n}`, { id: `a${n}`, kind: 'image', name: `image-${n}`, mime: m?.[1] ?? 'image/png', base64: img });
    }
    // 명시 계약 req.mediaFiles(오디오·영상·이미지 원본 base64) — WS/REST 입력 검증 → request-handler 가 채운다
    for (const f of req.mediaFiles ?? []) {
        n++;
        const mime = f.type || mimeFromName(f.name);
        map.set(`a${n}`, { id: `a${n}`, kind: kindFromMime(mime), name: f.name, mime, base64: f.data });
    }
    // 직전 턴 생성 미디어 — 최근 assistant 메시지부터 역순, 중복 제거, 상한 8
    const seen = new Set<string>();
    let m = 0;
    for (const h of [...(req.history ?? [])].reverse()) {
        if (h.role !== 'assistant' || m >= 8) continue;
        for (const match of h.content.matchAll(GENERATED_LINK_RE)) {
            const urlPath = match[1];
            if (seen.has(urlPath)) continue;
            seen.add(urlPath); m++;
            const mime = mimeFromName(urlPath);
            map.set(`m${m}`, { id: `m${m}`, kind: kindFromMime(mime), name: urlPath.split('/').pop() ?? urlPath, mime, urlPath });
            if (m >= 8) break;
        }
    }
    return map;
}

/** 최근 미완료 비동기 작업(영상) → kind=job 첨부 — Planner 가 새 제출 대신 재조회를 계획할 수 있게 */
async function collectPendingJobs(userId: string | undefined, sessionId: string | undefined, map: Map<string, OrchestratorAttachment>): Promise<void> {
    if (!userId) return;
    try {
        const rows = await new OrchestratorJobsRepository(getPool()).listRecent(userId, ORCHESTRATOR.JOB_LOOKBACK_HOURS, ORCHESTRATOR.JOB_MAX_LISTED, sessionId ?? null);
        rows.forEach((r, i) => {
            const id = `j${i + 1}`;
            const done = r.status === 'completed' && !!r.resultPath;
            const state = done ? '완료·저장됨' : '진행 중';
            const sameConversation = (r.sessionId ?? null) === (sessionId ?? null);
            map.set(id, {
                id, kind: 'job', mime: '',
                name: `${r.capability} ${state}${sameConversation ? '' : ' (다른 대화)'} (${r.providerId} ${r.jobId}, ${r.createdAt.toISOString().slice(11, 16)}Z)`,
                ...(done && r.resultPath ? { urlPath: r.resultPath } : {}),
                job: { capability: r.capability as Capability, providerId: r.providerId, jobId: r.jobId, resultPath: done ? r.resultPath : null, sameConversation },
            });
        });
    } catch (err) {
        logger.debug(`pending job 조회 실패(무시): ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Planner 가 `simple` 을 냈는데 영상 job 첨부가 있고 사용자가 영상을 묻는 발화면, 가장 최근 job 을 재조회하는 1작업 multi 로 보정한다.
 * (저장본은 실행기가 즉시 반환하므로 provider 호출 없음.) 그 외엔 계획 그대로.
 */
export function coerceJobFollowup(plan: ValidatedPlan, attachments: Map<string, OrchestratorAttachment>, message: string): ValidatedPlan {
    // 보정은 "기존 결과 조회" 의도에만 — 새 생성("만들어줘")·설명("압축 원리")·다른 대화의 job 은 Planner 판단을 그대로 둔다(Codex 검토 2)
    if (plan.complexity !== 'simple' || !VIDEO_JOB_FOLLOWUP_PATTERN.test(message)) return plan;
    if (!VIDEO_JOB_RESULT_INTENT_PATTERN.test(message) || VIDEO_JOB_NOT_FOLLOWUP_PATTERN.test(message)) return plan;
    const job = [...attachments.values()].find((a) => a.kind === 'job' && a.job?.capability === 'video.generate' && a.job.sameConversation !== false);
    if (!job) return plan;
    const v = validatePlan({ complexity: 'multi', language: plan.language, synthesis: true, tasks: [{ id: 't1', capability: 'video.generate', input: { instruction: message.slice(0, 400), attachments: [job.id] } }] }, new Set(attachments.keys()));
    if (!v.ok) return plan;
    logger.info(`[Orchestrator] simple → 영상 job 재조회로 보정 (${job.job?.jobId})`);
    return v.plan;
}

function toPlannerMeta(atts: Map<string, OrchestratorAttachment>): PlannerAttachmentMeta[] {
    return [...atts.values()].map((a) => ({ id: a.id, kind: a.kind, name: a.name, ...(a.urlPath ? { urlPath: a.urlPath } : {}) }));
}

function recentTurns(req: ChatMessageRequest): Array<{ role: string; content: string }> {
    const turns = (req.history ?? []).slice(-ORCHESTRATOR.PLANNER_HISTORY_TURNS * 2);
    return turns.map((h) => ({ role: h.role, content: h.content.replace(/\s+/g, ' ').slice(0, 400) }));
}

function buildResultBlock(results: TaskResult[], lang: string): string {
    const ko = lang === 'ko';
    const lines = results.map((r) => {
        const label = CAPABILITY_LABELS_KO[r.capability] ?? r.capability;
        const statusLabel = r.status === 'completed' ? (ko ? '완료' : 'done') : r.status === 'pending' ? (ko ? '진행 중(미완료)' : 'pending') : r.status === 'skipped' ? (ko ? '건너뜀' : 'skipped') : (ko ? '실패' : 'failed');
        const head = `### ${r.taskId} · ${r.capability} (${label}) — ${statusLabel}`;
        const body = r.text.length > ORCHESTRATOR.RESULT_MAX_CHARS ? `${r.text.slice(0, ORCHESTRATOR.RESULT_MAX_CHARS)}\n…(절단)` : r.text;
        const media = r.media.length ? `\n${r.media.map((x) => x.markdown).join('\n')}` : '';
        return `${head}\n${body}${media}`;
    });
    const intro = ko
        ? '[오케스트레이터 작업 결과 — 아래 결과를 근거로 사용자에게 답하세요. 완료된 미디어는 마크다운 링크를 그대로 답변에 포함하고, 실패·미지원·미배정·진행 중(미완료) 작업은 완료된 것처럼 말하지 말고 그 상태와 사유를 솔직히 알리세요. 링크나 파일명을 지어내지 마세요.]'
        : '[Orchestrator task results — answer the user based on these. Include completed media markdown links verbatim; for failed/unsupported/unassigned tasks tell the user the reason honestly. Never invent links or file names.]';
    return `${intro}\n\n${lines.join('\n\n')}`;
}

function fallbackNote(lang: string, reason: string): string {
    return lang === 'ko'
        ? `[시스템: 이번 턴에는 이미지·오디오·영상 등 미디어 기능이 실행되지 않았습니다(계획 단계 실패: ${reason.slice(0, 120)}). 텍스트로만 답하고, 미디어를 만들었다고 말하거나 파일 링크를 지어내지 마세요.]`
        : `[System: media capabilities (image/audio/video) did not run this turn (planning failed: ${reason.slice(0, 120)}). Answer in text only; do not claim media was generated or invent file links.]`;
}

/**
 * 사용량 관측 — 외부 BYOK 는 기존 external_provider_usage(비용 대시보드), 로컬은 per-user 토큰 쿼터에 누적.
 * provider 가 usage 를 안 주면 기록하지 않는다(0 으로 간주 금지). 비토큰 단위(이미지 수 등)는 셰도우 task_results 에만.
 */
export function recordUsage(userId: string | undefined, results: TaskResult[], targets?: Map<string, CapabilityTarget>): void {
    if (!userId) return;
    const now = Date.now();
    let localTokens = 0;
    for (const r of results) {
        const u = r.usage;
        if (!u || !r.model || (u.promptTokens === undefined && u.completionTokens === undefined)) continue;
        const inTok = u.promptTokens ?? 0; const outTok = u.completionTokens ?? 0;
        if (isExternalFullId(r.model)) {
            const idx = r.model.indexOf(':');
            const providerId = r.model.slice(0, idx); const modelId = r.model.slice(idx + 1);
            // 비용 주체는 preflight 가 해석한 대상(target.costOwner)으로 — 서버 공용 키 호출을 사용자 BYOK 로 기록하지 않는다(Codex 검토 1)
            if (targets?.get(r.taskId)?.costOwner === 'server') {
                void new ServerExternalKeysRepository(getPool()).recordUsage({ providerId, modelId, role: `capability:${r.capability}`, callerUserId: userId, inputTokens: inTok, outputTokens: outTok });
                void recordServerKeyUsage(providerId, inTok + outTok, now).catch(() => undefined);
            } else {
                void new ExternalKeysRepository(getPool()).recordUsage({ userId, providerId, modelId, inputTokens: inTok, outputTokens: outTok, durationMs: r.ms }).catch(() => undefined);
            }
        } else {
            localTokens += inTok + outTok;
        }
    }
    if (localTokens > 0) void recordUserUsage(userId, localTokens, now).catch(() => undefined);
}

export interface RunOrchestratorInput {
    req: ChatMessageRequest;
    lang: string;
    userId?: string;
    requestId?: string;
    signal?: AbortSignal;
    onProgress?: (event: OrchestratorProgressEvent) => void;
}

export async function runOrchestrator(input: RunOrchestratorInput): Promise<OrchestratorOutcome> {
    const { req, lang, userId, onProgress } = input;
    const attachments = collectAttachments(req);
    await collectPendingJobs(userId, req.sessionId, attachments);
    onProgress?.({ type: 'orchestrator_status', phase: 'planning' });

    const planned = await planRequest({
        message: req.message ?? '', attachments: toPlannerMeta(attachments), recentTurns: recentTurns(req), lang, userId, signal: input.signal,
    });
    const record = (partial: Parameters<OrchestratorRunsRepository['insert']>[0]) => {
        if (!ORCHESTRATOR.SHADOW_ENABLED) return;
        void new OrchestratorRunsRepository(getPool()).insert(partial).catch((e) => logger.debug(`셰도우 기록 실패: ${e instanceof Error ? e.message : String(e)}`));
    };

    if (planned.error === 'cancelled') {
        record({ requestId: input.requestId, userId, plannerModel: planned.model, plannerMs: planned.ms, plannerOk: false, plannerError: 'cancelled', outcome: 'fallback' });
        return { mode: 'cancelled', mediaMarkdowns: [], plannerMs: planned.ms };
    }
    if (!planned.plan) {
        logger.warn(`[Orchestrator] 계획 실패 → 종전 경로 (${planned.error})`);
        onProgress?.({ type: 'orchestrator_status', phase: 'skipped', detail: planned.error });
        record({ requestId: input.requestId, userId, plannerModel: planned.model, plannerMs: planned.ms, plannerOk: false, plannerError: planned.error, outcome: 'fallback' });
        return { mode: 'fallback', contextBlock: fallbackNote(lang, planned.error ?? 'unknown'), mediaMarkdowns: [], plannerMs: planned.ms };
    }
    const plan = coerceJobFollowup(planned.plan, attachments, req.message ?? '');
    onProgress?.({ type: 'orchestrator_plan', complexity: plan.complexity, tasks: plan.tasks.map((t) => ({ id: t.id, capability: t.capability, instruction: t.instruction.slice(0, 160) })) });

    if (plan.complexity === 'simple') {
        onProgress?.({ type: 'orchestrator_status', phase: 'done', detail: 'simple' });
        record({ requestId: input.requestId, userId, plannerModel: planned.model, plannerMs: planned.ms, plannerOk: true, complexity: 'simple', plan, taskCount: 1, outcome: 'simple' });
        return { mode: 'simple', mediaMarkdowns: [], plannerMs: planned.ms };
    }

    onProgress?.({ type: 'orchestrator_status', phase: 'executing' });
    const ctx: ExecContext = { userId, lang, userMessage: req.message ?? '', attachments, results: new Map(), signal: input.signal, onProgress, sessionId: req.sessionId };
    // 실행 승인 경계 — 배정·키·어댑터·입력 종류·로컬 쿼터를 실행 전에 확정(거절 작업은 호출·과금 없음). 승인된 대상은 그대로 실행 대상
    const pre = await preflightPlan(plan, ctx);
    ctx.targets = pre.targets;
    for (const [id, reason] of pre.rejected) {
        const t = plan.tasks.find((x) => x.id === id)!;
        ctx.results.set(id, { taskId: id, capability: t.capability, ok: false, status: 'failed', text: reason, media: [], ms: 0, error: reason });
    }
    const summary = await executePlan(plan, ctx);
    const media: TaskMedia[] = summary.results.filter((r) => r.ok).flatMap((r) => r.media);
    recordUsage(userId, summary.results, pre.targets);
    onProgress?.({ type: 'orchestrator_status', phase: summary.cancelled ? 'skipped' : 'synthesizing', detail: `${summary.ok}/${summary.results.length}` });
    record({
        requestId: input.requestId, userId, plannerModel: planned.model, plannerMs: planned.ms, plannerOk: true, complexity: 'multi', plan,
        taskCount: summary.results.length, tasksOk: summary.ok, tasksFailed: summary.failed + summary.skipped, tasksPending: summary.pending, execMs: summary.ms,
        taskResults: summary.results.map((r) => ({ id: r.taskId, capability: r.capability, model: r.model, ms: r.ms, ok: r.ok, status: r.status, error: r.error, usage: r.usage ?? null })),
        outcome: 'executed',
    });
    if (summary.cancelled) return { mode: 'cancelled', mediaMarkdowns: [], plannerMs: planned.ms, execMs: summary.ms };
    logger.info(`[Orchestrator] 실행 완료 ok=${summary.ok} failed=${summary.failed} skipped=${summary.skipped} media=${media.length} (${summary.ms}ms)`);
    return { mode: 'executed', contextBlock: buildResultBlock(summary.results, lang), mediaMarkdowns: media.map((m) => m.markdown), plannerMs: planned.ms, execMs: summary.ms };
}

/**
 * Planner 없이 capability 1개를 **공통 실행 경계**(preflight 승인 → executor 게이트·데드라인·취소 → 사용량 계상)로 실행한다.
 * 이미지 모드 토글처럼 사용자가 명시한 단일 작업용 — Planner 만 생략하고 실행 정책은 자동 경로와 같다(Codex 검토 5).
 */
export async function runSingleCapabilityTask(input: { capability: Capability; instruction: string; userId?: string; lang: string; sessionId?: string; signal?: AbortSignal }): Promise<TaskResult> {
    const v = validatePlan({ complexity: 'multi', synthesis: false, tasks: [{ id: 't1', capability: input.capability, input: { instruction: input.instruction } }] }, new Set());
    if (!v.ok) throw new Error(`계획 검증 실패: ${v.reason}`);
    const ctx: ExecContext = { userId: input.userId, lang: input.lang, userMessage: input.instruction, attachments: new Map(), results: new Map(), signal: input.signal, sessionId: input.sessionId };
    const pre = await preflightPlan(v.plan, ctx);
    const rejected = pre.rejected.get('t1');
    if (rejected) throw new Error(rejected);
    ctx.targets = pre.targets;
    const summary = await executePlan(v.plan, ctx);
    recordUsage(input.userId, summary.results, pre.targets);
    const r = summary.results[0];
    if (!r) throw new Error('실행 결과가 없습니다');
    return r;
}
