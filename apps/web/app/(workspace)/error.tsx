"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { House, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/primitives";

// 렌더 크래시 폴백이라 번역 훅(useTranslations)에 의존하지 않는다 —
// next-intl provider 자체가 크래시 원인일 수 있으므로 문구를 최소 하드코딩한다.
export default function WorkspaceError({
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
    <div className="grid min-h-0 flex-1 place-items-center bg-app px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-danger-soft text-danger">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-fg">
          Something went wrong
          <span className="mt-0.5 block text-sm font-medium text-muted">
            문제가 발생했습니다
          </span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          An unexpected error occurred while rendering this page. / 페이지를 표시하는
          중 예기치 못한 오류가 발생했습니다.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-faint">ref: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={() => reset()}>
            <RotateCw className="h-4 w-4" />
            Try again
          </Button>
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-fg transition hover:bg-surface-2"
          >
            <House className="h-4 w-4" />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
