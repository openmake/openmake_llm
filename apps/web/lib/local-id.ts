/**
 * UUID v4 생성 — 보안 컨텍스트가 아니어도 동작한다.
 *
 * `crypto.randomUUID` 는 보안 컨텍스트(https·localhost)에서만 있다. http 로 접속한 화면
 * (예: tailscale `http://<host>:3010`)에서는 함수 자체가 없어 두 가지가 깨졌다(2026-10-03):
 *   - 파일을 첨부하는 순간 "crypto.randomUUID is not a function"
 *   - 익명 세션 id 가 UUID 가 아닌 형식으로 만들어져, 로그인 후 세션 이관(claim)이 400 으로 거절
 * `crypto.getRandomValues` 는 보안 컨텍스트가 아니어도 있으므로 그것으로 v4 를 만든다.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 서버가 받는 익명 세션 id 형식(UUID v4) — `controllers/session.controller.ts` 의 claim 검증과 같다 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_V4.test(value);
}
