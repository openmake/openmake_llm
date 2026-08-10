"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { GA_MEASUREMENT_IDS } from "@/lib/analytics";

// gtag 명령 큐 부트스트랩('js'→'config')은 lib/analytics.ts 모듈 로드 시점에 수행된다 —
// 여기서는 SPA 라우트 전환 page_view 전송과 gtag.js 로더 삽입만 담당.
export function GoogleAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (GA_MEASUREMENT_IDS.length === 0 || !window.gtag) return;

    const query = searchParams.toString();
    const pagePath = query ? `${pathname}?${query}` : pathname;
    // config({page_path}) 재호출 방식은 첫 로드에서 부트스트랩 config(send_page_view:false)와
    // 큐에서 병합돼 랜딩 page_view 가 억제된다(2026-08-10 외부 경로 실측) — 명시적 page_view
    // 이벤트로 전송한다. send_to 미지정이라 구성된 두 측정 ID 모두에 전달된다.
    window.gtag("event", "page_view", {
      page_location: window.location.origin + pagePath,
      page_path: pagePath,
      page_title: document.title,
    });
  }, [pathname, searchParams]);

  if (GA_MEASUREMENT_IDS.length === 0) return null;

  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_IDS[0]}`}
      strategy="afterInteractive"
    />
  );
}
