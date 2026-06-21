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
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` },
    ];
  },
};

export default nextConfig;
