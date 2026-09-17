/**
 * 인용 [N] 전처리 (F19.4) — 본문의 `[N]`(1 ≤ N ≤ 출처 수)을 `[N](#cite-N)` 마크다운 링크로 바꿔 Markdown 의 a override 가
 * 인용 칩으로 렌더하게 한다. 원시 HTML 을 만들지 않는다(rehype-raw 금지 유지).
 *
 * - 코드펜스(```…```)·인라인 코드(`…`) 안은 건드리지 않는다
 * - 이미 링크인 `[N](…)` 와 참조형 링크 `[텍스트][N]` 는 그대로 둔다(연속 인용 `[1][2]` 는 둘 다 변환)
 * - 출처가 없으면 원문 그대로
 */

export const CITE_HREF_PREFIX = "#cite-";

const CODE_SPLIT_RE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
const CITE_RE = /\[(\d{1,2})\](?!\()/g;

function transformText(text: string, max: number): string {
  return text.replace(CITE_RE, (match, num: string, offset: number) => {
    const n = Number(num);
    if (n < 1 || n > max) return match;
    if (offset > 0 && text[offset - 1] === "]") {
      // 참조형 링크 `[텍스트][N]` 는 두고, 앞도 숫자 인용이면(연속 인용) 변환
      const open = text.lastIndexOf("[", offset - 1);
      const prev = open >= 0 ? text.slice(open + 1, offset - 1) : "";
      if (!/^\d{1,2}$/.test(prev)) return match;
    }
    return `[${n}](${CITE_HREF_PREFIX}${n})`;
  });
}

export function linkCitations(content: string, sourceCount: number): string {
  if (!content || sourceCount <= 0) return content;
  return content
    .split(CODE_SPLIT_RE)
    .map((part, i) => (i % 2 === 1 ? part : transformText(part, sourceCount)))
    .join("");
}

/** `#cite-N` → N (아니면 null) */
export function citationNumber(href: string | undefined): number | null {
  if (!href || !href.startsWith(CITE_HREF_PREFIX)) return null;
  const n = Number(href.slice(CITE_HREF_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 표시용 도메인 — source 우선, 없으면 URL 호스트 */
export function sourceDomain(source: { url: string; source?: string }): string {
  if (source.source) return source.source;
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}
