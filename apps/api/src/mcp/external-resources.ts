/**
 * 외부 MCP 서버의 resources/prompts 클라이언트 래퍼 (F13.2, 2026-09-17).
 *
 * 서버가 capability 를 광고하지 않으면 예외 대신 `isError` 텍스트를 돌려 모델이 다른 길을 고르게 한다.
 * 결과는 텍스트로 평탄화한다 — content 배열을 통째 stringify 하지 않는다(절단 규칙은 하류 MAX_TOOL_RESULT_CHARS).
 * 우리 `mcp/server.ts` 는 여전히 resources/prompts 를 제공하지 않는다(실체 없음).
 *
 * @module mcp/external-resources
 */
import type { ExternalMCPClient } from './external-client';
import type { MCPToolResult } from './types';
import { MCP_RESOURCE_LIMITS } from '../config/runtime-limits';

function text(t: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text: t }], isError };
}

function notSupported(client: ExternalMCPClient, what: 'resources' | 'prompts'): MCPToolResult | null {
    const caps = client.getServerCapabilities();
    if (!client.getSdkClient() || client.getStatus().status !== 'connected') return text(`서버 "${client.getStatus().serverName}" 에 연결되어 있지 않습니다.`, true);
    if (!caps || !caps[what]) return text(`서버 "${client.getStatus().serverName}" 는 ${what} 기능을 제공하지 않습니다(capability 미광고).`, true);
    return null;
}

function errText(client: ExternalMCPClient, op: string, e: unknown): MCPToolResult {
    return text(`${op} 오류 (${client.getStatus().serverName}): ${e instanceof Error ? e.message : String(e)}`, true);
}

export async function listResources(client: ExternalMCPClient): Promise<MCPToolResult> {
    const gate = notSupported(client, 'resources');
    if (gate) return gate;
    try {
        const r = await client.getSdkClient()!.listResources();
        const items = (r.resources ?? []).slice(0, MCP_RESOURCE_LIMITS.LIST_MAX).map((x) => ({
            uri: x.uri, name: x.name, ...(x.description ? { description: x.description } : {}), ...(x.mimeType ? { mimeType: x.mimeType } : {}),
        }));
        const more = (r.resources?.length ?? 0) > items.length ? `\n… 외 ${(r.resources?.length ?? 0) - items.length}개(상한 ${MCP_RESOURCE_LIMITS.LIST_MAX})` : '';
        return text(items.length === 0 ? '리소스가 없습니다.' : `리소스 ${items.length}개 — mcp_read_resource 로 uri 를 읽으세요:\n${JSON.stringify(items, null, 2)}${more}`);
    } catch (e) { return errText(client, 'resources/list', e); }
}

export async function readResource(client: ExternalMCPClient, uri: string): Promise<MCPToolResult> {
    const gate = notSupported(client, 'resources');
    if (gate) return gate;
    try {
        const r = await client.getSdkClient()!.readResource({ uri });
        const parts = (r.contents ?? []).map((c) => {
            if ('text' in c && typeof c.text === 'string') return c.text;
            if ('blob' in c && typeof c.blob === 'string') return `[binary ${c.mimeType ?? 'application/octet-stream'} ${c.blob.length} chars base64 — 본문 생략]`;
            return '';
        }).filter(Boolean);
        return text(parts.length === 0 ? '(empty resource)' : parts.join('\n'));
    } catch (e) { return errText(client, 'resources/read', e); }
}

export async function listPrompts(client: ExternalMCPClient): Promise<MCPToolResult> {
    const gate = notSupported(client, 'prompts');
    if (gate) return gate;
    try {
        const r = await client.getSdkClient()!.listPrompts();
        const items = (r.prompts ?? []).slice(0, MCP_RESOURCE_LIMITS.LIST_MAX).map((p) => ({
            name: p.name, ...(p.description ? { description: p.description } : {}),
            ...(p.arguments?.length ? { arguments: p.arguments.map((a) => ({ name: a.name, required: !!a.required, ...(a.description ? { description: a.description } : {}) })) } : {}),
        }));
        return text(items.length === 0 ? '프롬프트가 없습니다.' : `프롬프트 ${items.length}개 — mcp_get_prompt 로 name·arguments 를 넘기세요:\n${JSON.stringify(items, null, 2)}`);
    } catch (e) { return errText(client, 'prompts/list', e); }
}

export async function getPrompt(client: ExternalMCPClient, name: string, args: Record<string, string>): Promise<MCPToolResult> {
    const gate = notSupported(client, 'prompts');
    if (gate) return gate;
    try {
        const r = await client.getSdkClient()!.getPrompt({ name, arguments: args });
        const lines = (r.messages ?? []).map((m) => {
            const c = m.content as { type?: string; text?: string };
            const body = c?.type === 'text' && typeof c.text === 'string' ? c.text : `[${c?.type ?? 'unknown'} content]`;
            return `[${m.role}] ${body}`;
        });
        const head = r.description ? `${r.description}\n` : '';
        return text(head + (lines.length === 0 ? '(empty prompt)' : lines.join('\n')));
    } catch (e) { return errText(client, 'prompts/get', e); }
}
