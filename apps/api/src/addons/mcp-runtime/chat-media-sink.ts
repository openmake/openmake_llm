/** 채팅 MCP 미디어는 Base Artifact Store 포트를 통해 계정 소유 산출물로 저장한다. */
import { extname } from 'node:path';
import type { ToolRuntime } from '../../runtime-ports/tool-runtime';
import { mimeForExt, scopedArtifactStore } from '../../runtime-ports/artifact-store';
import { getToolMediaSink, type ToolMediaSink } from '../../utils/tool-media-sink';

export function chatMediaSinkFor(context?: Parameters<ToolRuntime['executeTool']>[2]): ToolMediaSink | undefined {
    const existing = getToolMediaSink();
    if (existing) return existing;
    if (!context?.userId || context.role === 'guest' || String(context.userId) === 'guest') return undefined;
    const store = scopedArtifactStore({ userId: String(context.userId), capability: 'mcp-runtime' });
    return {
        async save(relPath, bytes, media) {
            const ext = extname(relPath).slice(1);
            const mime = media?.mime ?? mimeForExt(ext);
            // SVG 는 앱 origin 에서 스크립트를 실행할 수 있어 채팅 산출물로 게시하지 않는다.
            if (mime.split(';')[0].trim().toLowerCase() === 'image/svg+xml') throw new Error('SVG 채팅 미디어는 지원하지 않습니다');
            const ref = await store.save({ kind: media?.kind ?? (mime.startsWith('audio/') ? 'audio' : 'image'), prefix: 'mcp', ext, bytes, mime });
            return ref.urlPath;
        },
    };
}
