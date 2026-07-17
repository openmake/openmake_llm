/**
 * openmake_llm 백엔드 호출 — OpenAI 호환 REST (POST /api/v1/chat/completions).
 * API Key 인증, 비스트리밍 (Discord 는 deferred reply 패턴이라 스트리밍 불필요).
 */
import { config } from './config';
import { ChatTurn } from './session-store';
import { ResponseArtifact } from './attachments';

interface ModelListResponse {
    data?: Array<{ id: string }>;
}

interface ChatCompletionResponse {
    choices?: Array<{ message?: { content?: string; artifacts?: ResponseArtifact[] } }>;
    error?: { message?: string };
}

export interface ChatAnswer {
    content: string;
    artifacts: ResponseArtifact[];
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

export async function requestChatCompletion(history: ChatTurn[], userContent: string): Promise<ChatAnswer> {
    const model = await resolveModel();
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
                messages: [...history, { role: 'user', content: userContent }],
                // OpenMake 확장: 아티팩트를 공유 뷰어에 link 발행해 shareUrl 포함
                publish_artifacts: true,
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
        return { content: content ?? '', artifacts };
    } finally {
        clearTimeout(timer);
    }
}
