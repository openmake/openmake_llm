/**
 * 확장 출처 표시 — 원본 URL 의 호스트+경로(끝 `.git`·`/` 제거)와 커밋 앞 7자리. 승인함 카드가 쓴다.
 * URL 이 아니면(`internal://…` 도 URL 로 해석된다) 문자열 그대로, 원본이 없으면 null.
 */
export function formatExtensionOrigin(source: string | null | undefined, ref: string | null | undefined): string | null {
  if (!source) return null;
  let label = source;
  try {
    const u = new URL(source);
    label = `${u.host}${u.pathname}`.replace(/\.git$/, "").replace(/\/$/, "");
  } catch {
    /* URL 이 아니면 그대로 */
  }
  return ref ? `${label}@${ref.slice(0, 7)}` : label;
}
