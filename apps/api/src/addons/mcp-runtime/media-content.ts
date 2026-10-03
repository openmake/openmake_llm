/**
 * MCP 결과의 비텍스트(이미지·오디오) 블록 처리 — base64 를 도구 결과 본문에 싣지 않는다.
 *
 * 도구 결과는 모델에 텍스트로 간다. 비텍스트 블록은 JSON 으로 직렬화돼 base64 가 그대로 본문에 실렸고
 * (결과 상한을 base64 가 차지해 진짜 본문이 잘린다), 모델은 그 문자열로 아무것도 하지 못한다.
 * 작업 공간이 있으면(에이전트 작업) 파일로 저장해 경로를 적고, 없으면(채팅) 건수·종류·크기만 적는다.
 *
 * @module addons/mcp-runtime/media-content
 */
import { randomUUID } from 'crypto';
import { MCP_MEDIA } from '../../config/agent-task-browser-web';
import { getMcpMediaSavedNote, getMcpMediaOmittedNote, type McpMediaKind } from '../../prompts/agent-task-browser-web';
import { getToolMediaSink, type ToolMediaSink } from '../../utils/tool-media-sink';
import { createLogger } from '../../utils/logger';

const logger = createLogger('McpMediaContent');

interface ContentBlock {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
}

const MEDIA_KINDS: ReadonlySet<string> = new Set<McpMediaKind>(['image', 'audio']);

function isMediaBlock(b: ContentBlock): b is ContentBlock & { type: McpMediaKind; data: string } {
    return MEDIA_KINDS.has(b.type) && typeof b.data === 'string' && b.data.length > 0;
}

/** PURE: 바이트 수 → 사람이 읽는 크기. */
export function formatBytes(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 결과의 이미지·오디오 블록을 텍스트 안내로 바꾼 새 결과를 돌려준다. 미디어 블록이 없거나 꺼져 있으면 받은 결과 그대로.
 * 저장된 블록은 제자리에서 경로 안내로 바뀌고, 저장하지 못한 블록은 빠지고 끝에 종류별 생략 안내가 붙는다.
 */
export async function offloadMediaBlocks<T extends { content?: ContentBlock[] }>(
    result: T,
    toolName: string,
    sink: ToolMediaSink | undefined = getToolMediaSink(),
    opts: { enabled?: boolean; maxSaveBytes?: number } = {},
): Promise<T> {
    if (!(opts.enabled ?? MCP_MEDIA.OFFLOAD_ENABLED) || !result.content?.some(isMediaBlock)) return result;
    const maxSaveBytes = opts.maxSaveBytes ?? MCP_MEDIA.MAX_SAVE_BYTES;
    const safeTool = toolName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'tool';
    const content: ContentBlock[] = [];
    const omitted: Record<McpMediaKind, string[]> = { image: [], audio: [] };
    for (const block of result.content) {
        if (!isMediaBlock(block)) { content.push(block); continue; }
        const mime = block.mimeType || 'application/octet-stream';
        const bytes = Buffer.byteLength(block.data, 'base64');
        const label = `${mime} ${formatBytes(bytes)}`;
        if (sink && bytes <= maxSaveBytes) {
            const relPath = `${MCP_MEDIA.DIR}/${safeTool}-${randomUUID().slice(0, 8)}.${MCP_MEDIA.EXT_BY_MIME[mime] ?? 'bin'}`;
            try {
                await sink.save(relPath, Buffer.from(block.data, 'base64'));
                content.push({ type: 'text', text: getMcpMediaSavedNote(block.type, relPath, mime, formatBytes(bytes)) });
                continue;
            } catch (e) {
                logger.warn(`MCP 결과 미디어 저장 실패 → 생략 안내 (${toolName}): ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        omitted[block.type].push(label);
    }
    for (const kind of Object.keys(omitted) as McpMediaKind[]) {
        if (omitted[kind].length > 0) content.push({ type: 'text', text: getMcpMediaOmittedNote(kind, omitted[kind]) });
    }
    return { ...result, content };
}
