/**
 * 자매 서비스 외부 링크 — 사이드바 계정 메뉴·로그인 화면에서 공용.
 *
 * bench 는 웹 SSO 클라이언트(백엔드 `SSO_CLIENTS.bench`)라 로그인 사용자는 직접 이동 대신
 * `/api/auth/sso/authorize?client=bench` 로 보내 로그인된 상태로 도착하게 한다.
 * 비로그인(로그인 화면)에서는 bench 주소로 직접 링크한다.
 */
// 주소는 설치마다 다르다 — 빌드 시 NEXT_PUBLIC_* 로 받고, 비어 있으면 화면이 링크를 숨긴다.
export const EXTERNAL_LINKS = {
  homepage: process.env.NEXT_PUBLIC_HOMEPAGE_URL ?? "",
  bench: process.env.NEXT_PUBLIC_BENCH_URL ?? "",
  /** 로그인 사용자용 — 서버 화이트리스트에 등록된 bench redirect URI 로 exchange code 와 함께 이동 */
  benchSso: "/api/auth/sso/authorize?client=bench",
} as const;
