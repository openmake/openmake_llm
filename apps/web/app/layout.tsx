import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jbm",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: "OpenMake.Ai",
    description: t("description"),
  };
}

// 실제 모바일 디바이스 반응형의 핵심 — viewport meta 가 없으면 모바일 브라우저가
// 데스크탑 너비로 렌더 후 축소해 레이아웃이 작게 뭉개진다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // 노치/홈바 safe-area 대응
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // NEXT_LOCALE 쿠키 → Accept-Language → ko (i18n/request.ts 에서 결정)
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        {/* Pretendard self-host (public/vendor/pretendard) — 벤더 배포 형태 그대로 서빙하는
            정적 자산이라 CSS 모듈 import 대상이 아님 (no-css-tags 예외) */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/vendor/pretendard/pretendard.css" />
      </head>
      <body className="min-h-dvh bg-app text-fg antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
