/**
 * @module services/chat-service/generated-link-guard
 * @description 최종 답변 속 `/generated/<file>` 참조 중 **이번 턴 도구가 만든 것도 아니고 디스크에도 없는**
 * 링크를 제거한다 — 모델이 "기존 이미지를 수정해 달라" 는 요청에 도구를 부르지 않고 파일명을 지어내
 * (`…_east_asian.png`) 답한 라이브 사례(2026-09-12, nvidia gemma-4-31b-it) 차단. 결정적 후처리(LLM 없음).
 * 이전 턴 파일(디스크 존재)은 그대로 둔다.
 */
import { resolveGeneratedPath } from '../../mcp/generated-media';

const GENERATED_LINK_RE = /!?\[([^\]]*)\]\((\/generated\/[A-Za-z0-9._-]+)\)/g;

export interface StripResult { content: string; removed: string[] }

export function stripMissingGeneratedLinks(
    content: string,
    producedThisTurn: ReadonlySet<string>,
    exists: (urlPath: string) => boolean = (p) => resolveGeneratedPath(p) !== null,
    lang = 'ko',
): StripResult {
    const removed: string[] = [];
    const out = content.replace(GENERATED_LINK_RE, (whole, _alt: string, path: string) => {
        if (producedThisTurn.has(path) || exists(path)) return whole;
        removed.push(path);
        return lang === 'ko'
            ? '*(생성되지 않은 파일 링크를 제거했습니다 — 이미지가 필요하면 다시 요청해 주세요)*'
            : '*(removed a link to a file that was never generated — ask again to create it)*';
    });
    return { content: out, removed };
}

/** 스트림 원문엔 있던 /generated 링크가 최종본에서 사라졌는가 — WS done.cleanedContent 교체 판정용 */
export function generatedLinkWasCleaned(streamed: string, final: string): boolean {
    const links = [...streamed.matchAll(GENERATED_LINK_RE)].map((m) => m[2]);
    return links.some((p) => !final.includes(p));
}
