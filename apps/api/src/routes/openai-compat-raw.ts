/**
 * OpenAI 호환 `/api/v1/chat/completions` 의 **원본 호출 모드** (raw).
 *
 * 헤더 `X-OpenMake-Raw: 1`(또는 body.openmake.raw=true) 이면 채팅 파이프라인(에이전트 라우터·
 * 페르소나 시스템 프롬프트·내장 도구·thinking 요약·세션·로컬 폴백)을 전부 건너뛰고 요청한
 * 모델만 그대로 부른다. 벤치마크(openmake_bench)처럼 "모델 자체"를 재야 하는 클라이언트용이다.
 *
 * - 외부 provider fullId(`hasa:solar-open-100b`): 요청 사용자의 BYO 키로 provider 어댑터를 만들어 streamChat
 * - 로컬 모델(`qwen3.8-27b`, `local-llm:*`): LLMClient 로 직접 호출
 * - 요청의 messages·tools·temperature·max_tokens 만 전달하고 다른 것은 붙이지 않는다
 * - 실패해도 다른 모델로 폴백하지 않는다 (벤치는 실패를 실패로 봐야 한다)
 * - API 키 인증·rate limit 은 v1 라우터 미들웨어가 이미 적용한 상태
 *
 * @module routes/openai-compat-raw
 */

import type { Request, Response } from 'express';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { createExternalProviderInstance, buildOAuthSessionPersist } from '../providers/provider-router';
import { parseFullModelId } from '../providers/i-provider';
import { getProviderCatalogEntry } from '../config/external-providers';
import { createClient } from '../llm/client';
import type { ChatMessage, ToolDefinition, UsageMetrics } from '../llm/types';
import { OpenAICompatService, type OpenAIChatCompletionRequest, type OpenAIMessage } from '../services/OpenAICompatService';
import { createLogger } from '../utils/logger';

const log = createLogger('OpenAICompatRaw');

export const RAW_HEADER = 'x-openmake-raw';

/** raw 모드 요청인가 — 헤더 `X-OpenMake-Raw: 1|true` 또는 body.openmake.raw === true */
export function isRawRequest(req: Pick<Request, 'get'>, body: unknown): boolean {
    const h = req.get(RAW_HEADER);
    if (h && ['1', 'true', 'yes'].includes(h.trim().toLowerCase())) return true;
    const ext = (body as { openmake?: { raw?: unknown } } | null)?.openmake;
    return ext?.raw === true;
}

/** OpenAI 메시지 → 내부 ChatMessage (텍스트만. content-part 배열은 text 를 이어 붙인다) */
export function toChatMessages(messages: OpenAIMessage[]): ChatMessage[] {
    return messages.map((m) => {
        const content = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
                ? m.content.map((p) => (p as { type?: string; text?: string }).type === 'text' ? ((p as { text?: string }).text ?? '') : '').join('')
                : '';
        const out: ChatMessage = { role: m.role, content };
        if (m.tool_calls?.length) {
            out.tool_calls = m.tool_calls.map((t) => ({
                id: t.id,
                type: 'function',
                function: { name: t.function.name, arguments: safeJson(t.function.arguments) },
            })) as unknown as ChatMessage['tool_calls'];
        }
        const tcid = (m as { tool_call_id?: string }).tool_call_id;
        if (tcid) out.tool_call_id = tcid;
        return out;
    });
}

function safeJson(s: string): Record<string, unknown> {
    try { const v = JSON.parse(s) as unknown; return v && typeof v === 'object' ? v as Record<string, unknown> : {}; } catch { return {}; }
}

type OpenAIToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

interface RawResult {
    content: string;
    thinking?: string;
    toolCalls: OpenAIToolCall[];
    usage: UsageMetrics;
    finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

export interface RawTarget {
    kind: 'external' | 'local';
    providerId?: string;
    modelId: string;
}

/** 요청 모델 문자열을 호출 대상으로 해석. 알 수 없는 fullId 접두어는 로컬 이름으로 취급 */
export function resolveRawTarget(model: string): RawTarget {
    if (model.includes(':')) {
        try {
            const p = parseFullModelId(model);
            if (p.providerId === 'local-llm') return { kind: 'local', modelId: p.modelId };
            if (getProviderCatalogEntry(p.providerId)) return { kind: 'external', providerId: p.providerId, modelId: p.modelId };
        } catch { /* fullId 형식 아님 → 로컬 이름 */ }
    }
    return { kind: 'local', modelId: model };
}

/**
 * raw 호출을 수행해 OpenAI 형식으로 응답한다 (stream / non-stream 모두).
 * 호출 전 검증(model 존재·외부 키 등록)은 호출부(openai-compat.routes)가 끝낸 상태여야 한다.
 */
export async function handleRawCompletion(
    req: Request,
    res: Response,
    body: OpenAIChatCompletionRequest,
    opts: { userId: string | null; tools?: ToolDefinition[] },
): Promise<void> {
    const target = resolveRawTarget(body.model);
    const completionId = OpenAICompatService.generateCompletionId();
    const messages = toChatMessages(body.messages);
    const abort = new AbortController();
    // 클라이언트가 응답을 다 받기 전에 끊으면 upstream 도 중단. (req 'close' 는 본문 소비 직후에도 나므로 res 기준)
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const startedAt = Date.now();

    const writeChunk = (delta: { role?: string; content?: string; tool_calls?: unknown[] }, finishReason: string | null, extra?: Record<string, unknown>) => {
        const chunk = OpenAICompatService.buildStreamChunk({ id: completionId, model: body.model, delta, finishReason });
        res.write(`data: ${JSON.stringify(extra ? { ...chunk, ...extra } : chunk)}\n\n`);
    };

    if (body.stream === true) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        writeChunk({ role: 'assistant' }, null);
    }

    let result: RawResult;
    try {
        result = await callTarget(target, messages, body, opts, abort.signal, (token) => {
            if (body.stream === true && !abort.signal.aborted) writeChunk({ content: token }, null);
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`raw 호출 실패 (${body.model}): ${message}`);
        if (body.stream === true) {
            if (!abort.signal.aborted) {
                res.write(`data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`);
                res.write(OpenAICompatService.buildDoneEvent());
            }
            res.end();
        } else {
            res.status(502).json({ error: { message, type: 'upstream_error', code: 'raw_upstream_failed' } });
        }
        return;
    }

    const promptTokens = result.usage.prompt_tokens ?? OpenAICompatService.estimateTokens(messages.map((m) => m.content).join('\n'));
    const completionTokens = result.usage.completion_tokens ?? OpenAICompatService.estimateTokens(result.content);
    const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
    const finish = result.toolCalls.length > 0 ? 'tool_calls' : result.finishReason === 'length' ? 'length' : 'stop';
    log.info(`raw ${target.kind} ${body.model} ${Date.now() - startedAt}ms in=${promptTokens} out=${completionTokens} finish=${finish}`);

    if (body.stream === true) {
        if (abort.signal.aborted) { res.end(); return; }
        if (result.toolCalls.length > 0) writeChunk({ tool_calls: result.toolCalls }, null);
        // 마지막 청크에 usage 동봉 (stream_options.include_usage 와 같은 위치) — 벤치가 정확 토큰 수를 읽는다
        writeChunk({}, finish, { usage });
        res.write(OpenAICompatService.buildDoneEvent());
        res.end();
        return;
    }

    const response = OpenAICompatService.buildResponse({
        id: completionId,
        model: body.model,
        content: result.content,
        finishReason: finish === 'tool_calls' ? 'tool_calls' : 'stop',
        promptTokens,
        completionTokens,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
    });
    res.json(finish === 'length' ? { ...response, choices: response.choices.map((c) => ({ ...c, finish_reason: 'length' })) } : response);
}

async function callTarget(
    target: RawTarget,
    messages: ChatMessage[],
    body: OpenAIChatCompletionRequest,
    opts: { userId: string | null; tools?: ToolDefinition[] },
    signal: AbortSignal,
    onToken: (token: string) => void,
): Promise<RawResult> {
    if (target.kind === 'external') {
        if (!opts.userId) throw new Error('external provider requires an API-key user');
        const repo = new ExternalKeysRepository(getPool());
        const keyRow = await repo.getByUserAndProvider(opts.userId, target.providerId!);
        if (!keyRow) throw new Error(`no '${target.providerId}' key registered for this account`);
        const plaintextKey = await repo.decryptKey(opts.userId, target.providerId!);
        if (!plaintextKey) throw new Error(`cannot decrypt '${target.providerId}' key`);
        const provider = createExternalProviderInstance(
            keyRow,
            plaintextKey,
            keyRow.authMethod === 'oauth' ? buildOAuthSessionPersist(repo, opts.userId, target.providerId!) : undefined,
        );
        let thinking = '';
        const r = await provider.streamChat(
            {
                messages,
                modelId: target.modelId,
                temperature: body.temperature,
                maxTokens: body.max_tokens,
                tools: opts.tools,
                tool_choice: body.tool_choice,
                abortSignal: signal,
            },
            { onToken, onThinking: (t) => { thinking += t; } },
        );
        return {
            content: r.content,
            thinking: r.thinking ?? (thinking || undefined),
            toolCalls: (r.toolCalls ?? []).map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) } })),
            usage: r.usage ?? {},
            finishReason: r.finishReason === 'length' ? 'length' : r.finishReason === 'tool_calls' ? 'tool_calls' : r.finishReason === 'error' ? 'error' : 'stop',
        };
    }

    // 로컬 (vLLM/LiteLLM) — 모델을 명시했으므로 ModelPool 자동 라우팅은 우회된다 (client.ts: manual)
    const client = createClient({ model: target.modelId, userId: opts.userId ?? undefined });
    const r = await client.chat(
        messages,
        { temperature: body.temperature, num_predict: body.max_tokens, top_p: body.top_p, stop: body.stop },
        (token) => { if (token) onToken(token); },
        { tools: opts.tools, tool_choice: body.tool_choice, signal },
    );
    const toolCalls: OpenAIToolCall[] = (r.tool_calls ?? []).map((t, i) => {
        const tc = t as unknown as { id?: string; function?: { name?: string; arguments?: unknown } };
        const args = tc.function?.arguments;
        return {
            id: tc.id ?? `call_${i}`,
            type: 'function',
            function: { name: tc.function?.name ?? '', arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
        };
    });
    const fr = r.metrics?.finish_reason;
    return {
        content: r.content ?? '',
        thinking: r.thinking,
        toolCalls,
        usage: r.metrics ?? {},
        finishReason: fr === 'length' ? 'length' : toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
}
