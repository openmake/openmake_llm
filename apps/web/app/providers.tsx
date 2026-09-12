"use client";

import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { syncAuthFromServer } from "@/lib/auth-sync";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { CLIENT_TIMING } from "@/lib/config";

/**
 * 앱 마운트 시 /api/auth/me 로 현재 로그인 사용자를 store 에 동기화.
 * 실패(401=비로그인)면 게스트 유지. 사이드바·인증 의존 UI 가 이 상태를 구독한다.
 * 동기화 본체는 lib/auth-sync (login 페이지와 공유).
 *
 * 로그인 상태에서는 선제 토큰 갱신 인터벌을 돌린다 (2026-07-04):
 * 액세스 토큰(기본 15분)은 REST 401 인터셉트로 갱신되지만, WS 채팅만 쓰는
 * 세션은 REST 호출이 없어 쿠키가 만료된 채 재연결/재방문 시 로그아웃으로
 * 체감됐다. 만료 전 주기 갱신으로 세션을 리프레시 토큰 수명(7일)까지 유지.
 */
function AuthSync() {
  const isLoggedIn = useAppStore((s) => !!s.auth.currentUser);
  useEffect(() => {
    void syncAuthFromServer();
  }, []);
  useEffect(() => {
    if (!isLoggedIn) return;
    const timer = setInterval(() => {
      void ApiClient.post("/api/auth/refresh", undefined, { redirectOnUnauthorized: false }).catch(() => {
        // refresh 실패(세션 수명 종료) — 서버 판정으로 store 를 갱신한다(게스트면 currentUser 해제 →
        // 배지 폴링 등 로그인 전제 타이머가 멈춘다). 종전엔 무시해 만료 탭이 영원히 폴링했다.
        void syncAuthFromServer();
      });
    }, CLIENT_TIMING.TOKEN_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isLoggedIn]);
  return null;
}

/**
 * 웹 푸시 서비스 워커 등록 (public/sw.js).
 *
 * 등록된 워커가 없으면 설정 → 알림의 구독 토글이 `serviceWorker.ready` 에서 영원히 멈춰
 * "서비스 워커가 등록되지 않아 푸시 알림을 사용할 수 없습니다" 만 보였다(2026-09-13).
 * 실패는 무시한다 — 푸시는 부가 기능이고, 비보안 컨텍스트·브라우저 미지원에서 앱이
 * 깨지면 안 된다.
 */
function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // 로컬 http 개발 환경(localhost 제외)은 등록 자체가 불가 — 조용히 건너뛴다
    if (!window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 등록 실패 — 푸시만 비활성, 앱 동작에는 영향 없음 */
    });
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: CLIENT_TIMING.QUERY_STALE_MS, retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        <AuthSync />
      <ServiceWorkerRegistrar />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
