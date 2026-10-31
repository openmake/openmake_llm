import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
// Instrument 서체 3종 (기준: OpenMake Color & Type Pairings) — 라틴/제목 Space Grotesk,
// 한글 본문 Noto Sans KR(다크에서 300 사용), 수치·경로 IBM Plex Mono.
// npm 패키지로 자체 호스팅한다 — 빌드가 Google Fonts 응답에 의존하지 않게(변수 정의는 globals.css).
import "@fontsource-variable/noto-sans-kr";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { GoogleAnalytics } from "@/components/google-analytics";
import { Providers } from "./providers";

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
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh bg-app text-fg antialiased">
        <GoogleAnalytics />
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
