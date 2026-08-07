import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { ClusterManager } from '../cluster/manager';
import { asyncHandler } from '../utils/error-handler';
import { ChatRequestError, ChatRequestHandler, ChatUserContext } from '../chat/request-handler';
import { ToolDefinition } from '../llm';
import {
    OpenAIChatCompletionRequest,
    OpenAICompatArtifact,
    OpenAICompatService,
} from '../services/OpenAICompatService';
import { listAvailableModels } from '../chat/profile-resolver';
import { parseFullModelId } from '../providers/i-provider';
import { getProviderCatalogEntry } from '../config/external-providers';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { OpenAICompatSessionRepository } from '../data/repositories/oaicompat-session-repo';
import { getPool } from '../data/models/unified-database';
import { OPENAI_COMPAT_SESSION } from '../config/openai-compat';
import { createLogger } from '../utils/logger';

const openaiCompatRouter = Router();
const log = createLogger('OpenAICompatRoute');
let clusterManager: ClusterManager;

export function setClusterManager(cluster: ClusterManager): void {
    clusterManager = cluster;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function normalizeToolParameters(parameters: Record<string, unknown>): ToolDefinition['function']['parameters'] {
    const rawProperties = isRecord(parameters.properties) ? parameters.properties : {};
    const normalizedProperties: ToolDefinition['function']['parameters']['properties'] = {};

    for (const [key, value] of Object.entries(rawProperties)) {
        if (!isRecord(value)) {
            normalizedProperties[key] = { type: 'string' };
            continue;
        }

        const type = typeof value.type === 'string' ? value.type : 'string';
        const description = typeof value.description === 'string' ? value.description : undefined;
        const enumValues = Array.isArray(value.enum)
            ? value.enum.filter((item): item is string => typeof item === 'string')
            : undefined;

        normalizedProperties[key] = {
            type,
            ...(description ? { description } : {}),
            ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
        };
    }

    const required = Array.isArray(parameters.required)
        ? parameters.required.filter((item): item is string => typeof item === 'string')
        : undefined;

    return {
        type: 'object',
        properties: normalizedProperties,
        ...(required && required.length > 0 ? { required } : {}),
    };
}

function convertTools(request: OpenAIChatCompletionRequest): ToolDefinition[] | undefined {
    if (!request.tools || request.tools.length === 0) {
        return undefined;
    }

    return request.tools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: normalizeToolParameters(tool.function.parameters),
        },
    }));
}

function buildUserContext(req: Request): ChatUserContext {
    return {
        authenticatedUserId: req.apiKeyRecord?.user_id?.toString() || null,
        userRole: 'user',
        userId: req.apiKeyRecord?.user_id?.toString() || `apikey_${req.apiKeyId}`,
    };
}

/**
 * OpenAI 호환 요청으로부터 결정적(deterministic) 세션 키를 유도한다.
 *
 * 같은 (owner, requestUser, UTC 날짜) 조합은 항상 같은 키를 반환하므로 동일 클라이언트의
 * 연속 호출이 하나의 세션에 누적된다. 세션 키에 UTC 날짜(YYYYMMDD)를 포함해 하루 단위로
 * 새 세션이 되도록 하여, 세션이 영원히 한 줄로 이어져 무한히 길어지는 것을 막는다
 * (일자 파편화 vs 무한 세션 트레이드오프).
 *
 * @param owner       계정 스코프 식별자 — 인증된 user id, 없으면 API key 스코프 문자열
 * @param requestUser OpenAI 요청 body 의 `user` 필드 (없으면 'default')
 * @param date        키 유도 기준 시각 (기본 현재) — UTC 날짜만 사용
 */
export function deriveOpenAICompatSessionKey(
    owner: string,
    requestUser: string | undefined,
    date: Date = new Date(),
): string {
    const utcDate = date.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD (UTC)
    const material = `${owner}:${requestUser || 'default'}:${utcDate}`;
    const hex = createHash('sha256')
        .update(material)
        .digest('hex')
        .slice(0, OPENAI_COMPAT_SESSION.HASH_HEX_LENGTH);
    return `${OPENAI_COMPAT_SESSION.KEY_PREFIX}${hex}`;
}

interface SessionContinuity {
    /** 재사용할 기존 세션 ID (없으면 새 세션이 생성됨) */
    reuseSessionId: string | undefined;
    /** 유도된 세션 키 — 새 세션 생성 후 metadata 태깅에 사용 */
    sessionKey: string;
}

/**
 * 결정적 세션 키로 기존 conversation 세션을 조회한다.
 *
 * 인증 사용자는 user_id 로, 비인증(API key 에 user 없음)은 anon_session_id(=세션 키)로
 * 소유권을 스코프한다. 비인증 경로는 재사용 세션이 ensureSession 의 익명 소유권 검증을
 * 통과하도록 userContext.anonSessionId 를 세션 키로 채운다.
 */
async function resolveSessionContinuity(
    body: OpenAIChatCompletionRequest,
    userContext: ChatUserContext,
    apiKeyId: string | undefined,
): Promise<SessionContinuity> {
    const authUserId = userContext.authenticatedUserId;
    const owner = authUserId ?? `apikey:${apiKeyId ?? 'unknown'}`;
    const sessionKey = deriveOpenAICompatSessionKey(owner, body.user);

    // 비인증 경로: 재사용 세션이 ensureSession 익명 소유권 검증을 통과하도록 anon id 를 세션 키로 고정.
    if (!authUserId) {
        userContext.anonSessionId = sessionKey;
    }

    // 연속성 조회 실패는 fail-open — 세션 재사용만 포기하고 새 세션으로 정상 진행.
    // (조회가 processChat 앞단에 있어, 여기서 throw 하면 DB 순단이 응답 전체를 500 으로 만든다.)
    let reuseSessionId: string | undefined;
    try {
        const repo = new OpenAICompatSessionRepository(getPool());
        reuseSessionId = authUserId
            ? await repo.findByKeyForUser(sessionKey, authUserId)
            : await repo.findByKeyForAnon(sessionKey);
    } catch (e) {
        log.warn(`세션 연속성 조회 실패 (새 세션으로 진행): ${e instanceof Error ? e.message : e}`);
    }

    return { reuseSessionId, sessionKey };
}

/**
 * 새로 생성된 세션에 세션 키를 metadata 로 태깅한다 (다음 호출의 조회 대상).
 * 태깅 실패는 세션 연속성만 잃을 뿐 응답을 막지 않으므로 warn 후 무시(fail-open).
 */
async function tagSessionKey(sessionId: string, sessionKey: string): Promise<void> {
    try {
        await new OpenAICompatSessionRepository(getPool()).tagKey(sessionId, sessionKey);
    } catch (e) {
        log.warn(`세션 키 태깅 실패 (연속성 유실, 응답은 정상): ${e instanceof Error ? e.message : e}`);
    }
}

function openaiError(res: Response, status: number, message: string): void {
    res.status(status).json({
        error: {
            message,
            type: 'invalid_request_error',
        },
    });
}

/**
 * OpenMake 확장: 추출된 artifacts 를 응답에 동봉 (본문엔 [[artifact:id]] placeholder 만 남음).
 * publish_artifacts=true(옵트인) 면 link 발행 후 shareUrl 포함 — Discord gateway 등 비 WS 클라이언트용.
 * 발행은 아티팩트별 독립이라 병렬 수행.
 */
async function buildArtifactsOut(
    result: { artifacts?: Array<{ id: string; kind: string; title: string; lang: string | null; version: number; content: string }>; sessionId: string },
    body: OpenAIChatCompletionRequest,
    userContext: ChatUserContext,
): Promise<OpenAICompatArtifact[] | undefined> {
    if (!result.artifacts || result.artifacts.length === 0) return undefined;
    const artifactsOut: OpenAICompatArtifact[] = result.artifacts.map((a) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        language: a.lang,
        version: a.version,
        content: a.content,
    }));
    if (body.publish_artifacts === true) {
        const { publishArtifactAsLink } = await import('../services/artifact-viewer-service');
        await Promise.all(artifactsOut.map(async (a) => {
            const shareUrl = await publishArtifactAsLink(
                result.sessionId,
                a.id,
                userContext.authenticatedUserId ?? null,
            );
            if (shareUrl) a.shareUrl = shareUrl;
        }));
    }
    return artifactsOut;
}

openaiCompatRouter.post('/chat/completions', asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as OpenAIChatCompletionRequest;

    if (!body?.model || typeof body.model !== 'string') {
        openaiError(res, 400, 'model is required');
        return;
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        openaiError(res, 400, 'messages must be a non-empty array');
        return;
    }

    // body.model 검증 (2026-05-19): 이전엔 임의 문자열도 buildExecutionPlan() 가 기본 모델로
    // silent override → 운영자/외부 클라이언트가 *잘못된 모델 이름* 을 보내도 알 길 없음.
    // vLLM/OpenAI spec 준수 위해 listAvailableModels() 에 없는 model id 는 404 로 거절.
    // 호환: 'local-llm:<model>' fullId 형식 허용.
    // 외부 provider 개방 (2026-07-26 Phase 2): 카탈로그 등록 provider 의 fullId
    // ('openrouter:*', 'chatgpt:*' 등)는 요청 사용자의 BYO 키/OAuth 세션이 등록돼
    // 있으면 통과 — CLI/서드파티 OpenAI 호환 클라이언트에서 외부 모델 사용 가능.
    // 다운스트림 dispatch 는 채팅 단일 경로의 provider gate 가 동일하게 처리한다.
    // 그 외 알 수 없는 prefix 는 아래 available 검증에서 404 로 명시 거절.
    {
        const available = new Set(listAvailableModels().map((m) => m.id));
        const requested = body.model;
        let resolvedModelId: string = requested;
        let externalAllowed = false;
        if (requested.includes(':')) {
            try {
                const parsed = parseFullModelId(requested);
                if (parsed.providerId === 'local-llm') {
                    resolvedModelId = parsed.modelId;
                } else if (getProviderCatalogEntry(parsed.providerId)) {
                    const apiUserId = req.apiKeyRecord?.user_id?.toString() || null;
                    if (apiUserId) {
                        const keyRow = await new ExternalKeysRepository(getPool())
                            .getByUserAndProvider(apiUserId, parsed.providerId);
                        externalAllowed = !!keyRow;
                    }
                    if (!externalAllowed) {
                        openaiError(
                            res,
                            403,
                            `Model '${requested}' requires a registered '${parsed.providerId}' key for this account. ` +
                            `Register it in Settings → 외부 LLM 연동.`,
                        );
                        return;
                    }
                }
            } catch { /* invalid fullId 형식 — 그대로 검증 */ }
        }
        if (!externalAllowed && !available.has(requested) && !available.has(resolvedModelId)) {
            openaiError(
                res,
                404,
                `Model '${requested}' not found. Available: ${[...available].join(', ')}`,
            );
            return;
        }
    }

    if (!clusterManager) {
        openaiError(res, 503, 'Cluster manager not initialized');
        return;
    }

    const completionId = OpenAICompatService.generateCompletionId();
    const converted = OpenAICompatService.convertMessages(body.messages);
    const userContext = buildUserContext(req);
    const tools = convertTools(body);

    // 세션 연속성: OpenAI 호환 클라이언트의 연속 호출을 결정적 세션 키로 하나의 세션에 누적.
    // 매 호출마다 새 세션이 파편 생성되던 문제 해소 (createSession 이 클라이언트 id 를 받지 않아
    // metadata lookup 방식 채택 — 기존 세션이 있으면 그 실제 id 를 재사용, 없으면 생성 후 태깅).
    const { reuseSessionId, sessionKey } = await resolveSessionContinuity(body, userContext, req.apiKeyId);

    if (body.stream === true) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        let aborted = false;
        const abortController = new AbortController();

        req.on('close', () => {
            aborted = true;
            abortController.abort();
        });

        res.write(`data: ${JSON.stringify(OpenAICompatService.buildStreamChunk({
            id: completionId,
            model: body.model,
            delta: { role: 'assistant' },
            finishReason: null,
        }))}\n\n`);

        try {
            const result = await ChatRequestHandler.processChat({
                message: converted.message,
                model: body.model,
                history: converted.history,
                sessionId: reuseSessionId,
                ...(converted.images && converted.images.length > 0 ? { images: converted.images } : {}),
                tools,
                tool_choice: body.tool_choice,
                userContext,
                apiKeyId: req.apiKeyId,
                clusterManager,
                abortSignal: abortController.signal,
                onToken: (token: string) => {
                    if (aborted) {
                        return;
                    }
                    res.write(`data: ${JSON.stringify(OpenAICompatService.buildStreamChunk({
                        id: completionId,
                        model: body.model,
                        delta: { content: token },
                        finishReason: null,
                    }))}\n\n`);
                },
            });

            const resultModel = result.model || body.model;

            // 새로 생성된 세션이면 세션 키를 태깅 — 다음 호출이 이 세션을 재사용하도록.
            if (!reuseSessionId && result.sessionId) {
                await tagSessionKey(result.sessionId, sessionKey);
            }

            if (!aborted && result.tool_calls && result.tool_calls.length > 0) {
                res.write(`data: ${JSON.stringify(OpenAICompatService.buildStreamChunk({
                    id: completionId,
                    model: resultModel,
                    delta: { tool_calls: result.tool_calls },
                    finishReason: null,
                }))}\n\n`);
            }

            // OpenMake 확장: 스트리밍에서도 artifacts 를 마지막 delta 로 동봉 — 비스트리밍과 대칭.
            if (!aborted) {
                const artifactsOut = await buildArtifactsOut(result, body, userContext);
                if (artifactsOut) {
                    res.write(`data: ${JSON.stringify(OpenAICompatService.buildStreamChunk({
                        id: completionId,
                        model: resultModel,
                        delta: { artifacts: artifactsOut },
                        finishReason: null,
                    }))}\n\n`);
                }
            }

            if (!aborted) {
                res.write(`data: ${JSON.stringify(OpenAICompatService.buildStreamChunk({
                    id: completionId,
                    model: resultModel,
                    delta: {},
                    finishReason: result.finish_reason || 'stop',
                }))}\n\n`);
                res.write(OpenAICompatService.buildDoneEvent());
            }
            res.end();
            return;
        } catch (error) {
            if (!aborted) {
                const message = error instanceof Error ? error.message : 'streaming error';
                res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
                res.write(OpenAICompatService.buildDoneEvent());
            }
            res.end();
            return;
        }
    }

    try {
        const result = await ChatRequestHandler.processChat({
            message: converted.message,
            model: body.model,
            history: converted.history,
            sessionId: reuseSessionId,
            ...(converted.images && converted.images.length > 0 ? { images: converted.images } : {}),
            tools,
            tool_choice: body.tool_choice,
            userContext,
            apiKeyId: req.apiKeyId,
            clusterManager,
            onToken: () => {
                // non-streaming endpoint intentionally ignores token events
            },
        });

        // 새로 생성된 세션이면 세션 키를 태깅 — 다음 호출이 이 세션을 재사용하도록.
        if (!reuseSessionId && result.sessionId) {
            await tagSessionKey(result.sessionId, sessionKey);
        }

        // content array 가 섞여 있어도 안전하게 텍스트만 추출 — string 인 경우만 join, 배열인 경우 text 블록 합산
        const promptTextParts: string[] = [];
        for (const m of body.messages) {
            if (typeof m.content === 'string') promptTextParts.push(m.content);
            else if (Array.isArray(m.content)) {
                for (const p of m.content) if (p.type === 'text') promptTextParts.push(p.text);
            }
        }
        const promptTokens = OpenAICompatService.estimateTokens(promptTextParts.join(' '));
        const completionTokens = OpenAICompatService.estimateTokens(result.response);

        const artifactsOut = await buildArtifactsOut(result, body, userContext);

        const response = OpenAICompatService.buildResponse({
            id: completionId,
            model: result.model || body.model,
            content: result.response,
            finishReason: result.finish_reason || 'stop',
            promptTokens,
            completionTokens,
            toolCalls: result.tool_calls,
            artifacts: artifactsOut,
        });

        res.json(response);
    } catch (error) {
        if (error instanceof ChatRequestError) {
            openaiError(res, error.statusCode, error.message);
            return;
        }

        const message = error instanceof Error ? error.message : 'Request failed';
        openaiError(res, 500, message);
    }
}));

export default openaiCompatRouter;
