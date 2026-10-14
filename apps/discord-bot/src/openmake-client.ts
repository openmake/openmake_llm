/**
 * openmake_llm 백엔드 호출 — OpenAI 호환 REST (POST /api/v1/chat/completions).
 * API Key 인증, 비스트리밍 (Discord 는 deferred reply 패턴이라 스트리밍 불필요).
 */
import { config } from './config';
import { ChatTurn } from './session-store';
import { ResponseArtifact } from './attachments';
import type { InboundAttachments } from './inbound-attachments';
import type { AgentTaskRef } from './delegated-watch';

interface ModelListResponse {
    data?: Array<{ id: string }>;
}

interface ChatCompletionResponse {
    /** agent_tasks — OpenMake 확장: 이번 턴에 모델이 위임한 백그라운드 작업 */
    choices?: Array<{ message?: { content?: string; artifacts?: ResponseArtifact[]; agent_tasks?: unknown[] } }>;
    error?: { message?: string };
}

interface ChatAnswer {
    content: string;
    artifacts: ResponseArtifact[];
    /** 이번 턴에 위임한 백그라운드 작업 — 봇이 지켜보다 결과를 채널에 올린다(없으면 빈 배열) */
    agentTasks: AgentTaskRef[];
}

/** 형식이 맞는 항목만 남긴다 — 서버가 다른 모양을 보내도 봇이 죽지 않게 */
function parseAgentTasks(raw: unknown[] | undefined): AgentTaskRef[] {
    const out: AgentTaskRef[] = [];
    for (const t of raw ?? []) {
        if (!t || typeof t !== 'object') continue;
        const { id, goal, status } = t as Record<string, unknown>;
        if (typeof id !== 'string' || !id || (status !== 'created' && status !== 'duplicate')) continue;
        out.push({ id, goal: typeof goal === 'string' ? goal : '', status });
    }
    return out;
}

/**
 * 요청 제한 시간(DISCORD_BOT_REQUEST_TIMEOUT_MS) 초과 — fetch 의 영어 abort 문구 대신
 * 사용자에게 그대로 보여 줄 안내를 담는다 (2026-10-14 운영: 로컬 모델의 긴 HTML 생성이 5분을 넘김).
 */
export class RequestTimeoutError extends Error {
    constructor(readonly timeoutMs: number) {
        super(
            `응답 제한 시간(${timeoutMs / 1000}초)을 넘겨 요청을 중단했습니다. 긴 문서·HTML 생성은 시간이 더 걸릴 수 있습니다 — `
            + '요청을 나누거나 관리자에게 제한 시간(DISCORD_BOT_REQUEST_TIMEOUT_MS) 상향을 요청하세요.',
        );
        this.name = 'RequestTimeoutError';
    }
}

let resolvedModel = config.model;

/** DISCORD_BOT_MODEL 미설정 시 백엔드 모델 목록의 첫 항목으로 결정 */
export async function resolveModel(): Promise<string> {
    if (resolvedModel) return resolvedModel;
    const res = await fetch(`${config.apiBaseUrl}/api/v1/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) {
        throw new Error(`모델 목록 조회 실패: HTTP ${res.status}`);
    }
    const body = (await res.json()) as ModelListResponse;
    const first = body.data?.[0]?.id;
    if (!first) {
        throw new Error('백엔드 모델 목록이 비어 있습니다 (GET /api/v1/models).');
    }
    resolvedModel = first;
    return resolvedModel;
}

/**
 * 첨부(attachments)는 이번 턴의 마지막 user 메시지에만 싣는다 — 히스토리(ChatTurn)는 텍스트만 (웹 화면과 같은 규칙).
 * 이미지는 content-part 배열(text + image_url), 문서는 OpenMake 확장 files[].
 */
export async function requestChatCompletion(
    history: ChatTurn[],
    userContent: string,
    attachments?: Pick<InboundAttachments, 'imageParts' | 'files'>,
): Promise<ChatAnswer> {
    const model = await resolveModel();
    const imageParts = attachments?.imageParts ?? [];
    const files = attachments?.files ?? [];
    const lastUserContent = imageParts.length > 0
        ? [{ type: 'text', text: userContent }, ...imageParts]
        : userContent;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
        const res = await fetch(`${config.apiBaseUrl}/api/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [...history, { role: 'user', content: lastUserContent }],
                // OpenMake 확장: 아티팩트를 공유 뷰어에 link 발행해 shareUrl 포함
                publish_artifacts: true,
                // OpenMake 확장: 문서 첨부(base64) — 백엔드가 텍스트로 추출해 주입
                ...(files.length > 0 ? { files } : {}),
            }),
            signal: controller.signal,
        });
        const body = (await res.json()) as ChatCompletionResponse;
        if (!res.ok) {
            throw new Error(body.error?.message || `백엔드 오류: HTTP ${res.status}`);
        }
        const message = body.choices?.[0]?.message;
        const artifacts = message?.artifacts ?? [];
        const content = message?.content;
        if (!content && artifacts.length === 0) {
            throw new Error('백엔드 응답에 content 가 없습니다.');
        }
        return { content: content ?? '', artifacts, agentTasks: parseAgentTasks(message?.agent_tasks) };
    } catch (err) {
        // 우리 타이머가 abort 했을 때만 전용 오류로 바꾼다 — 일반 네트워크 오류는 그대로
        if (controller.signal.aborted) throw new RequestTimeoutError(config.requestTimeoutMs);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
