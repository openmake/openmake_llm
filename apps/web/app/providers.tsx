"use client";

import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ApiSuccess, MePayload } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { CLIENT_TIMING } from "@/lib/config";

/**
 * 앱 마운트 시 /api/auth/me 로 현재 로그인 사용자를 store 에 동기화.
 * 실패(401=비로그인)면 게스트 유지. 사이드바·인증 의존 UI 가 이 상태를 구독한다.
 */
function AuthSync() {
  const setAuth = useAppStore((s) => s.setAuth);
  useEffect(() => {
    ApiClient.get<ApiSuccess<MePayload>>("/api/auth/me")
      .then((res) => {
        const u = res?.data?.user;
        if (u) {
          setAuth({
            currentUser: {
              id: String(u.id),
              email: u.email,
              name: u.username,
              role: u.role ?? "user",
            },
            isGuestMode: false,
          });
        }
      })
      .catch(() => {
        /* 비로그인 — 게스트 유지 */
      });
  }, [setAuth]);
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
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        <AuthSync />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
