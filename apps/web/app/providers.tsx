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
        /* refresh 실패(세션 만료 등) — 다음 REST 401 인터셉트/리다이렉트 흐름에 위임 */
      });
    }, CLIENT_TIMING.TOKEN_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isLoggedIn]);
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
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
