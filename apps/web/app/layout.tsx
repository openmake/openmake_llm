import type { Metadata } from "next";
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
