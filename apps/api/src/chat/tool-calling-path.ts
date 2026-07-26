/**
 * ============================================================
 * §10 외부 Tool Calling 경로 — `tools` 파라미터가 제공된 요청
 * ============================================================
 *
 * OpenAI 호환 클라이언트(CLI 등)가 도구 목록을 직접 넘기는 경로. ChatService 파이프라인
 * (에이전트 라우팅·스킬·메모리·아티팩트)을 우회하고 **단일 턴** LLM 호출 후 tool_calls 를
 * 그대로 돌려준다 — 도구 실행 주체가 서버가 아니라 호출자이기 때문.
 *
 * request-handler.processChat 에서 분리(파일 크기 가드 600줄). 조기 return 하는 독립
 * 분기라 경계가 명확하다.
 *
 * @module chat/tool-calling-path
 */
import type { LLMClient } from '../llm';
import { LocalLLMProvider } from '../providers/local-llm-provider';
import { ProviderRouter } from '../providers/provider-router';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { getProviderCatalogEntry } from '../config/external-providers';
import { servedModelLabel } from '../services/chat-service/provider-gate';
import { processExternalToolCalling } from './external-tool-calling';
import { saveAssistantMessage } from './request-persistence';
import type { IProvider } from '../providers/i-provider';
import type { ChatUserContext, ChatResult } from './request-handler-types';
import type { ExecutionPlan } from './profile-resolver';

/** 하위 호출부 시그니처를 그대로 따라간다 — 별도 선언은 drift 를 만든다. */
type ToolCallingCallParams = Parameters<typeof processExternalToolCalling>[0];

/** processChat 이 이미 확보한 컨텍스트 — 이 경로가 스스로 만들지 않는 값들. */
export interface ToolCallingPathParams {
    message: string;
    history?: ToolCallingCallParams['history'];
    images?: string[];
    tools: ToolCallingCallParams['tools'];
    tool_choice?: ToolCallingCallParams['tool_choice'];
    /** 요청 모델 ID — 'chatgpt:gpt-5.5' 처럼 provider prefix 가 붙을 수 있다. */
    model?: string;
    /** 로컬 기본 클라이언트 — 외부 provider 로 해석되지 않으면 이 클라이언트가 응답한다. */
    client: LLMClient;
    userContext: ChatUserContext;
    sessionId: string;
    auditUserId: string;
    persistContent: boolean;
    plan: ExecutionPlan;
    /** processChat 이 측정을 시작한 시각 — 응답시간을 한 기준으로 재기 위해 넘겨받는다. */
    startTime: number;
    onToken: (token: string) => void;
    abortSignal?: AbortSignal;
}

/**
 * 요청 모델을 외부 provider 로 해석한다.
 *
 * 이전엔 prefix 를 무시하고 로컬 client 로 silent fallback 되어, CLI 도구 경로에서만
 * 외부 모델이 조용히 무시됐다. 해석 실패(키 미등록 등)는 ProviderError 를 그대로
 * 전파해 명시적으로 거절한다.
 */
async function resolveExternal(
    model: string | undefined,
    client: LLMClient,
    userContext: ChatUserContext,
): Promise<{ externalProvider: { provider: IProvider; modelId: string }; servedModel: string } | null> {
    const reqModel = (model || '').trim();
    const colonIdx = reqModel.indexOf(':');
    const prefix = colonIdx > 0 ? reqModel.slice(0, colonIdx) : '';
    if (!prefix || prefix === 'local-llm' || !getProviderCatalogEntry(prefix)) return null;

    const providerRouter = new ProviderRouter({
        localProvider: new LocalLLMProvider(client),
        externalKeysRepo: new ExternalKeysRepository(getPool()),
    });
    const resolved = await providerRouter.resolve(reqModel, {
        ...(userContext.authenticatedUserId ? { userId: userContext.authenticatedUserId } : {}),
        userRole: userContext.userRole,
    });
    return {
        externalProvider: { provider: resolved.provider, modelId: resolved.modelId },
        servedModel: servedModelLabel(resolved),
    };
}

/** 단일 턴 호출 → tool_calls 반환. 응답은 히스토리에도 기록한다. */
export async function handleToolCallingPath(p: ToolCallingPathParams): Promise<ChatResult> {
    const external = await resolveExternal(p.model, p.client, p.userContext);
    // 실제로 답한 모델 — 외부로 해석됐으면 그 모델, 아니면 로컬 클라이언트 모델.
    const servedModel = external?.servedModel ?? p.client.model;

    const result = await processExternalToolCalling({
        message: p.message,
        history: p.history,
        images: p.images,
        tools: p.tools,
        tool_choice: p.tool_choice,
        client: p.client,
        ...(external ? { externalProvider: external.externalProvider } : {}),
        onToken: p.onToken,
        abortSignal: p.abortSignal,
    });

    const responseTime = Date.now() - p.startTime;

    // AI 응답 저장 (tool_calls 인 경우에도 히스토리에 기록)
    await saveAssistantMessage(
        p.sessionId,
        p.auditUserId,
        result.response,
        servedModel,
        responseTime,
        p.persistContent,
    );

    return {
        response: result.response,
        sessionId: p.sessionId,
        model: servedModel,
        executionPlan: p.plan,
        responseTime,
        tool_calls: result.tool_calls,
        finish_reason: result.finish_reason,
    };
}
