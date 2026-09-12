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
import { ORCHESTRATOR, CAPABILITY_LABELS_KO, type Capability } from '../../config/capabilities';
import { getPool } from '../../data/models/unified-database';
import { OrchestratorRunsRepository } from '../../data/repositories/orchestrator-runs-repo';
import type { ChatMessageRequest } from '../chat-service-types';
import { planRequest } from './planner';
import { executePlan } from './executor';
import { preflightPlan } from './preflight';
import { OrchestratorJobsRepository } from '../../data/repositories/orchestrator-jobs-repo';
import { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
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
async function collectPendingJobs(userId: string | undefined, map: Map<string, OrchestratorAttachment>): Promise<void> {
    if (!userId) return;
    try {
        const rows = await new OrchestratorJobsRepository(getPool()).listRecent(userId, ORCHESTRATOR.JOB_LOOKBACK_HOURS, ORCHESTRATOR.JOB_MAX_LISTED);
        rows.forEach((r, i) => {
            const id = `j${i + 1}`;
            const done = r.status === 'completed' && !!r.resultPath;
            const state = done ? '완료·저장됨' : '진행 중';
            map.set(id, {
                id, kind: 'job', mime: '',
                name: `${r.capability} ${state} (${r.providerId} ${r.jobId}, ${r.createdAt.toISOString().slice(11, 16)}Z)`,
                ...(done && r.resultPath ? { urlPath: r.resultPath } : {}),
                job: { capability: r.capability as Capability, providerId: r.providerId, jobId: r.jobId, resultPath: done ? r.resultPath : null },
            });
        });
    } catch (err) {
        logger.debug(`pending job 조회 실패(무시): ${err instanceof Error ? err.message : String(err)}`);
    }
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
function recordUsage(userId: string | undefined, results: TaskResult[]): void {
    if (!userId) return;
    const now = Date.now();
    let localTokens = 0;
    for (const r of results) {
        const u = r.usage;
        if (!u || !r.model || (u.promptTokens === undefined && u.completionTokens === undefined)) continue;
        if (isExternalFullId(r.model)) {
            const idx = r.model.indexOf(':');
            void new ExternalKeysRepository(getPool()).recordUsage({
                userId, providerId: r.model.slice(0, idx), modelId: r.model.slice(idx + 1),
                inputTokens: u.promptTokens ?? 0, outputTokens: u.completionTokens ?? 0, durationMs: r.ms,
            }).catch(() => undefined);
        } else {
            localTokens += (u.promptTokens ?? 0) + (u.completionTokens ?? 0);
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
    await collectPendingJobs(userId, attachments);
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
    const plan = planned.plan;
    onProgress?.({ type: 'orchestrator_plan', complexity: plan.complexity, tasks: plan.tasks.map((t) => ({ id: t.id, capability: t.capability, instruction: t.instruction.slice(0, 160) })) });

    if (plan.complexity === 'simple') {
        onProgress?.({ type: 'orchestrator_status', phase: 'done', detail: 'simple' });
        record({ requestId: input.requestId, userId, plannerModel: planned.model, plannerMs: planned.ms, plannerOk: true, complexity: 'simple', plan, taskCount: 1, outcome: 'simple' });
        return { mode: 'simple', mediaMarkdowns: [], plannerMs: planned.ms };
    }

    onProgress?.({ type: 'orchestrator_status', phase: 'executing' });
    const ctx: ExecContext = { userId, lang, userMessage: req.message ?? '', attachments, results: new Map(), signal: input.signal, onProgress };
    // 실행 승인 경계 — 배정·키·어댑터·입력 종류·로컬 쿼터를 실행 전에 확정(거절 작업은 호출·과금 없음)
    const pre = await preflightPlan(plan, ctx);
    for (const [id, reason] of pre.rejected) {
        const t = plan.tasks.find((x) => x.id === id)!;
        ctx.results.set(id, { taskId: id, capability: t.capability, ok: false, status: 'failed', text: reason, media: [], ms: 0, error: reason });
    }
    const summary = await executePlan(plan, ctx);
    const media: TaskMedia[] = summary.results.filter((r) => r.ok).flatMap((r) => r.media);
    recordUsage(userId, summary.results);
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
