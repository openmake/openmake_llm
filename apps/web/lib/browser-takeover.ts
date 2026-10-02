/**
 * 브라우저 넘겨받기(Take control) 입력 변환 — 화면에 보이는 스크린샷 위의 클릭·키 입력을 세션 명령으로 바꾼다.
 * 순수 함수 — 전송은 components/agent-tasks/browser-takeover 가 한다. 백엔드 browserSessionInputSchema 와 짝.
 */

export type TakeoverKeyInput = { op: "type"; text: string } | { op: "key"; key: string };

/** 그대로 전달하는 특수 키(Playwright 키 이름과 같다). */
const SPECIAL_KEYS: ReadonlySet<string> = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
]);

/** 줄여서 보여 준 스크린샷 위의 클릭 위치 → 원래 화면(스크린샷 원본 크기) 좌표. 화면이 아직 없으면 null. */
export function toViewportPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || natural.width <= 0 || natural.height <= 0) return null;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  return {
    x: clamp(((clientX - rect.left) / rect.width) * natural.width, natural.width),
    y: clamp(((clientY - rect.top) / rect.height) * natural.height, natural.height),
  };
}

/**
 * 키 입력 → 세션 명령. 보내지 않을 것은 null — 한글 등 조합 중인 입력(조합이 끝난 글은 텍스트 입력란으로 보낸다),
 * 수식 키 단독, 목록에 없는 키.
 */
export function keyToInput(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }): TakeoverKeyInput | null {
  if (e.isComposing || e.key === "Process") return null;
  if (SPECIAL_KEYS.has(e.key)) return { op: "key", key: e.key };
  if (e.key.length !== 1) return null;
  if (e.ctrlKey || e.metaKey) {
    // 세션은 리눅스 브라우저다 — Cmd 도 Control 로 보낸다. 조합은 영숫자만.
    return /^[A-Za-z0-9]$/.test(e.key) ? { op: "key", key: `Control+${e.key.toLowerCase()}` } : null;
  }
  return { op: "type", text: e.key };
}
