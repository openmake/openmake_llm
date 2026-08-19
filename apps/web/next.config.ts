import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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
  // 기술 스택 식별 헤더(X-Powered-By: Next.js) 제거 — 백엔드 helmet 은 이미 숨기지만
  // Next 가 서빙하는 HTML 응답엔 기본 노출된다(정보 노출, CWE-200).
  poweredByHeader: false,
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
          // HSTS — Next 가 서빙하는 HTML 경로엔 백엔드 helmet 의 HSTS 가 닿지 않아 누락됐다.
          // 백엔드 HSTS_POLICY(2년·includeSubDomains, preload 미포함=롤백 여지)와 값을 맞춘다.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      // manifest 는 항상 재검증시킨다(기본 max-age=14400 이면 아이콘 목록 교체가 4시간 늦게 반영).
      // ⚠️ favicon.ico·icon.svg·apple-icon.png 에는 이 헤더가 먹지 않는다 — metadata **이미지**
      // 라우트는 Next 가 응답에 Cache-Control 을 직접 실어 config 헤더가 덮어쓰지 못한다(실측).
      // 다만 HTML 의 <link> 에는 파일 해시 쿼리가 붙으므로, 페이지를 새로 받으면 새 URL 로
      // 즉시 갱신된다. 4시간이 걸리는 건 규약 경로(/favicon.ico)로 직접 받는 경우뿐이다.
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

// i18n — 요청 설정은 i18n/request.ts (플러그인 기본 경로), locale SoT 는 NEXT_LOCALE 쿠키.
const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
