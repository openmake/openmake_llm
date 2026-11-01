"use client";

/**
 * 임베딩 관련 서버 오류 안내 — 서버가 준 code(EMBEDDING_KEY_MISSING·REINDEX_NOT_NEEDED …)로 i18n 문구를 고르고,
 * 키·배정 문제면 "설정 열기" 링크를 함께 보인다. 미등록 코드는 서버 메시지를 그대로 보인다(화면은 판정하지 않는다).
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { embeddingErrorKey, needsEmbeddingSettings } from "../helpers";

/** 호출부가 잡은 오류 — api.ts 의 withCode 가 status·code 를 단다 */
export interface CodedError {
  message: string;
  code?: string;
  status?: number;
}

export function toCodedError(e: unknown, fallback: string): CodedError {
  if (e instanceof Error) {
    const coded = e as Error & { code?: string; status?: number };
    return { message: coded.message || fallback, code: coded.code, status: coded.status };
  }
  return { message: fallback };
}

export function EmbeddingSettingsLink() {
  const t = useTranslations("knowledge");
  return (
    <Link href="/settings" className="ml-1 font-medium text-accent underline-offset-2 hover:underline">
      {t("embedding.openSettings")}
    </Link>
  );
}

export function EmbeddingErrorText({ error, className }: { error: CodedError; className?: string }) {
  const t = useTranslations("knowledge");
  const key = embeddingErrorKey(error.code);
  return (
    <p className={className ?? "text-xs text-danger"}>
      {key ? t(key) : error.message}
      {needsEmbeddingSettings(error.code) && <EmbeddingSettingsLink />}
    </p>
  );
}
