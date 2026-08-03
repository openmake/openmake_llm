"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const measurementIds = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function GoogleAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (measurementIds.length === 0 || !window.gtag) return;

    const query = searchParams.toString();
    const pagePath = query ? `${pathname}?${query}` : pathname;
    for (const measurementId of measurementIds) {
      window.gtag("config", measurementId, { page_path: pagePath });
    }
  }, [pathname, searchParams]);

  if (measurementIds.length === 0) return null;

  const primaryMeasurementId = measurementIds[0];

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryMeasurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          window.gtag = function(){window.dataLayer.push(arguments);};
          window.gtag('js', new Date());
          ${measurementIds
            .map((measurementId) => `window.gtag('config', '${measurementId}', { send_page_view: false });`)
            .join("\n          ")}
        `}
      </Script>
    </>
  );
}
