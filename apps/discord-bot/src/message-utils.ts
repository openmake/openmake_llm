import { DISCORD_CHUNK_LIMIT } from './config';

/**
 * Discord 2000자 제한 대응 분할 — 줄바꿈 경계 우선, 초과 시 하드 분할.
 */
export function splitForDiscord(content: string, limit: number = DISCORD_CHUNK_LIMIT): string[] {
    if (content.length <= limit) return [content];
    const chunks: string[] = [];
    let remaining = content;
    while (remaining.length > limit) {
        let cut = remaining.lastIndexOf('\n', limit);
        if (cut <= 0) cut = limit;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).replace(/^\n/, '');
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}
