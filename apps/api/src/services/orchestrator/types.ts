/**
 * @module services/orchestrator/types
 * @description 오케스트레이터 실행 계약 — executor 입력/출력, 첨부, 진행 이벤트.
 */
import type { Capability } from '../../config/capabilities';
import type { PlanTask } from './plan-schema';

export type AttachmentKind = 'image' | 'audio' | 'video' | 'document' | 'other' | 'job';

/** Planner·executor 가 보는 첨부 하나 — 사용자 첨부(a*) 또는 직전 턴 생성 미디어(m*) */
export interface OrchestratorAttachment {
    id: string;
    kind: AttachmentKind;
    name: string;
    mime: string;
    /** base64 원본(이미지 dataURL 포함) — 사용자 첨부 */
    base64?: string;
    /** `/generated/<file>` — 직전 턴 생성 미디어 */
    urlPath?: string;
    /** 텍스트 문서면 추출 텍스트 */
    text?: string;
    /** kind=job: 진행 중이던 비동기 작업(영상) — 재조회용 */
    job?: { capability: Capability; providerId: string; jobId: string; /** 이미 받아둔 산출물(/generated/..) — 있으면 재조회·재다운로드 없이 그대로 반환 */ resultPath?: string | null; /** 이 턴과 같은 대화에서 만든 job 인지 — 결정적 보정은 같은 대화만 */ sameConversation?: boolean };
}

export interface TaskMedia {
    kind: 'image' | 'audio' | 'video';
    urlPath: string;
    /** 답변에 그대로 넣을 마크다운 (`![alt](/generated/..)` · `[🔊 듣기](..)`) */
    markdown: string;
}

export type TaskStatus = 'completed' | 'pending' | 'failed' | 'skipped';

export interface TaskResult {
    taskId: string;
    capability: Capability;
    /** ok = completed 만. pending(제출됐지만 미완료)·failed·skipped 는 false — 자식 실행 금지·성공 집계 제외 */
    ok: boolean;
    status: TaskStatus;
    /** 종합 모델에 넘길 텍스트 결과(관찰 기록·전사·검색 요약·오류 사유) */
    text: string;
    media: TaskMedia[];
    /** 실행 모델 fullId(관측) */
    model?: string;
    ms: number;
    error?: string;
    /** provider 가 돌려준 사용량 — 없으면 undefined(0 으로 간주하지 않는다). 비용은 provider 가 주지 않으면 unknown */
    usage?: TaskUsage;
}

export interface TaskUsage {
    promptTokens?: number;
    completionTokens?: number;
    /** 비토큰 출력 단위(이미지 수·합성 글자 수·오디오 바이트·영상 초) */
    units?: { kind: 'images' | 'chars' | 'audio_bytes' | 'video_seconds'; count: number };
}

export interface ExecContext {
    userId?: string;
    lang: string;
    /** 사용자 원문 — text.* 작업이 instruction 과 함께 본다 */
    userMessage: string;
    attachments: Map<string, OrchestratorAttachment>;
    /** 앞선 작업 결과(refs 해석) */
    results: Map<string, TaskResult>;
    signal?: AbortSignal;
    /** 이 턴의 대화 id — job 을 대화에 귀속(같은 대화의 job 만 보정 대상) */
    sessionId?: string;
    /** preflight 가 승인한 작업별 실행 대상 — executor 는 재해석하지 않고 이것을 쓴다(승인 대상 = 실행 대상) */
    targets?: Map<string, import('./capability-resolver').CapabilityTarget>;
    /** 진행 이벤트(WS) — 없으면 무시 */
    onProgress?: (event: OrchestratorProgressEvent) => void;
}

export type OrchestratorProgressEvent =
    | { type: 'orchestrator_status'; phase: 'planning' | 'executing' | 'synthesizing' | 'done' | 'skipped'; detail?: string }
    | { type: 'orchestrator_plan'; complexity: 'simple' | 'multi'; tasks: Array<{ id: string; capability: Capability; instruction: string }> }
    | { type: 'orchestrator_task'; id: string; capability: Capability; status: 'running' | 'ok' | 'pending' | 'failed'; summary?: string; ms?: number };

export type ExecutorOutput = Omit<TaskResult, 'taskId' | 'capability' | 'ms' | 'status'> & { status?: TaskStatus; job?: { providerId: string; jobId: string } };
export type CapabilityExecutor = (task: PlanTask, ctx: ExecContext) => Promise<ExecutorOutput>;

/** refs 로 지정된 앞 작업 결과 텍스트를 이어 붙인다(종합용 컨텍스트) */
export function refsText(task: PlanTask, ctx: ExecContext, maxChars: number): string {
    const parts: string[] = [];
    for (const r of task.refs) {
        const res = ctx.results.get(r);
        if (!res) continue;
        parts.push(`[${r} ${res.capability}] ${res.text}`);
    }
    const joined = parts.join('\n\n');
    return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n…(절단)` : joined;
}

/** refs 의 결과 **본문만**(메타 라벨 없이) 이어 붙인다 — 낭독·생성 입력용 */
export function refsRawText(task: PlanTask, ctx: ExecContext, maxChars: number): string {
    const parts = task.refs.map((r) => ctx.results.get(r)).filter((r): r is TaskResult => !!r && r.ok).map((r) => r.text);
    const joined = parts.join('\n\n');
    return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

/** task.attachments → 첨부 객체(없는 id 는 건너뜀). refs 의 미디어 산출물도 같은 종류면 첨부로 취급 */
export function resolveTaskAttachments(task: PlanTask, ctx: ExecContext, kinds?: ReadonlySet<AttachmentKind>): OrchestratorAttachment[] {
    const out: OrchestratorAttachment[] = [];
    for (const id of task.attachments) {
        const a = ctx.attachments.get(id);
        if (a && (!kinds || kinds.has(a.kind))) out.push(a);
    }
    for (const r of task.refs) {
        const res = ctx.results.get(r);
        for (const m of res?.media ?? []) {
            if (!kinds || kinds.has(m.kind)) {
                out.push({ id: `${r}:${m.urlPath}`, kind: m.kind, name: m.urlPath.split('/').pop() ?? m.kind, mime: '', urlPath: m.urlPath });
            }
        }
    }
    return out;
}
