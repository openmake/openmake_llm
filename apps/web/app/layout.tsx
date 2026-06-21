import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jbm",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenMake.Ai",
  description: "AI 기반 지능형 채팅 어시스턴트",
};

// 실제 모바일 디바이스 반응형의 핵심 — viewport meta 가 없으면 모바일 브라우저가
// 데스크탑 너비로 렌더 후 축소해 레이아웃이 작게 뭉개진다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // 노치/홈바 safe-area 대응
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        {/* Pretendard self-host (public/vendor/pretendard) */}
        <link rel="stylesheet" href="/vendor/pretendard/pretendard.css" />
      </head>
      <body className="min-h-dvh bg-app text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
