import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { asyncHandler } from '../utils/error-handler';
import { ChatRequestError, ChatRequestHandler, ChatUserContext } from '../chat/request-handler';
import { ToolDefinition } from '../llm';
import {
    OpenAIChatCompletionRequest,
    OpenAICompatService,
} from '../services/OpenAICompatService';
import { listAvailableModels } from '../chat/profile-resolver';
import { parseFullModelId, normalizeProviderId } from '../providers/i-provider';

const openaiCompatRouter = Router();
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

/** API Key rate_limit_tier → ChatUserContext userTier 변환 */
function mapApiKeyTierToUserTier(rateLimitTier?: string): 'free' | 'pro' | 'enterprise' {
    switch (rateLimitTier) {
        case 'enterprise': return 'enterprise';
        case 'standard': return 'pro';
        case 'starter': return 'pro';
        default: return 'free';
    }
}

function buildUserContext(req: Request): ChatUserContext {
    return {
        authenticatedUserId: req.apiKeyRecord?.user_id?.toString() || null,
        userRole: 'user',
        userTier: mapApiKeyTierToUserTier(req.apiKeyRecord?.rate_limit_tier),
        userId: req.apiKeyRecord?.user_id?.toString() || `apikey_${req.apiKeyId}`,
    };
}

function openaiError(res: Response, status: number, message: string): void {
    res.status(status).json({
        error: {
            message,
            type: 'invalid_request_error',
        },
    });
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
    // 호환: 'local-llm:<model>' / 'ollama:<model>' (legacy normalize) 둘 다 허용.
    {
        const available = new Set(listAvailableModels().map((m) => m.id));
        const requested = body.model;
        let resolvedModelId: string = requested;
        if (requested.includes(':')) {
            try {
                const parsed = parseFullModelId(requested);
                if (normalizeProviderId(parsed.providerId) === 'local-llm') {
                    resolvedModelId = parsed.modelId;
                }
            } catch { /* invalid fullId 형식 — 그대로 검증 */ }
        }
        if (!available.has(requested) && !available.has(resolvedModelId)) {
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

            if (!aborted && result.tool_calls && result.tool_calls.length > 0) {
                res.write(`data: ${JSON.stringify(OpenAICompatService.buildStreamChunk({
                    id: completionId,
                    model: resultModel,
                    delta: { tool_calls: result.tool_calls },
                    finishReason: null,
                }))}\n\n`);
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
            tools,
            tool_choice: body.tool_choice,
            userContext,
            apiKeyId: req.apiKeyId,
            clusterManager,
            onToken: () => {
                // non-streaming endpoint intentionally ignores token events
            },
        });

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

        const response = OpenAICompatService.buildResponse({
            id: completionId,
            model: result.model || body.model,
            content: result.response,
            finishReason: result.finish_reason || 'stop',
            promptTokens,
            completionTokens,
            toolCalls: result.tool_calls,
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
