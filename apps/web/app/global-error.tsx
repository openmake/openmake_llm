"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
// global-error 는 root layout 을 대체하므로 전역 스타일을 직접 가져와야 토큰이 적용된다.
import "./globals.css";

// root layout 자체가 크래시하면 next-intl provider·폰트가 모두 사라진 상태로 렌더된다.
// 따라서 번역 훅·디자인 컴포넌트에 의존하지 않고 최소 하드코딩 문구로만 구성한다.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    // global-error 는 자체 <html>/<body> 를 포함해야 한다 (Next 규약).
    <html lang="en">
      <body className="min-h-dvh bg-app text-fg antialiased">
        <div className="grid min-h-dvh place-items-center px-4">
          <div className="w-full max-w-sm text-center">
            <h1 className="text-lg font-bold text-fg">
              Something went wrong
              <span className="mt-0.5 block text-sm font-medium text-muted">
                문제가 발생했습니다
              </span>
            </h1>
            <p className="mt-2 text-sm text-muted">
              The application failed to load. Please try again. / 애플리케이션을
              불러오지 못했습니다. 다시 시도해 주세요.
            </p>
            {error.digest && (
              <p className="mt-2 font-mono text-xs text-faint">ref: {error.digest}</p>
            )}
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg shadow-2 transition hover:bg-accent-hover active:bg-accent-press"
              >
                Try again
              </button>
              <a
                href="/"
                className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-fg transition hover:bg-surface-2"
              >
                Home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
