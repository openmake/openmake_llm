import type { NextConfig } from "next";

/**
 * 백엔드(Express + WS, 기본 :52416)와의 연동.
 *
 * - REST(`/api/*`): dev 에서 Next.js rewrites 로 same-origin 프록시 → 브라우저는 localhost:3000 으로 호출,
 *   쿠키(SameSite=Lax)·CSRF 가 그대로 동작한다. 운영은 Nginx 가 `/api` 를 Express 로 프록시.
 * - WS(`/ws` 또는 채팅 소켓): rewrites 는 WebSocket 을 프록시하지 못하므로 dev 는 클라이언트가
 *   `NEXT_PUBLIC_WS_URL`(예: ws://localhost:52416)로 직접 연결한다. localhost 는 포트가 달라도
 *   same-site 라 SameSite=Lax 쿠키가 전송되고, origin(localhost:3000)은 백엔드 CORS_ORIGINS 에 등록돼 있다.
 *   운영은 same-origin(location.host)로 연결 → Nginx 가 업그레이드 프록시.
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || "http://localhost:52416";

const nextConfig: NextConfig = {
  // 워크스페이스 공통 패키지(.ts 소스)를 Next 가 트랜스파일하도록 지정.
  transpilePackages: [
    "@openmake/shared-types",
    "@openmake/api-client",
    "@openmake/config",
  ],
  // Next 16 dev: 외부 origin(rasplay) 에서 /_next/* (HMR 등) 접근을 기본 차단 → HMR WS 실패로
  // 클라이언트 hydration 이 죽어 게스트로 표시됨. 외부 공개 dev 접속을 허용한다.
  // (운영은 next build + next start 권장 — production 은 HMR 자체가 없어 이 문제 무관.)
  allowedDevOrigins: ["rasplay.tplinkdns.com", "localhost", "127.0.0.1"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` },
      // 생성 이미지(generate_image 도구 출력) — 백엔드가 /generated/* 로 서빙한다.
      // 채팅 마크다운이 root-relative `/generated/...` 를 참조하므로, Next origin 에서
      // 백엔드로 프록시해 외부 프록시(Caddy) 라우팅에 의존하지 않고 이미지가 도달하게 한다.
      { source: "/generated/:path*", destination: `${API_PROXY_TARGET}/generated/:path*` },
    ];
  },
  // 보안 헤더 (전역). 아티팩트 라이브 렌더는 sandbox iframe(null-origin)이 1차 경계이고,
  // 여기 헤더는 앱 자체 보호(클릭재킹·MIME 스니핑·레퍼러). 전체 script-src CSP 는 Next 의
  // 인라인 hydration 때문에 nonce 배선이 필요해 별도 하드닝 단계로 분리한다.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
