"use client";

/**
 * 기본 모델 판정 적용 — `GET /api/models` 의 `defaultModelSelection`(서버 판정)만 store `selectedModel` 에 쓴다.
 *
 * 종전엔 auth-sync(선호)·설정 화면(편집 중 값)·컴포저(목록 비교 보정) 세 곳이 이 한 칸을 써서, 기본 모델의 키를
 * 끄면 조용히 구체 로컬 모델로 바뀌고 새로 고침 때 응답 도착 순서에 따라 결과가 갈렸다(2026-11-18).
 * 이제 판정을 적용하는 이 한 곳만 쓴다. 판정이 없으면(null·구 API) store 를 건드리지 않는다 — 모르면 유지.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DefaultModelStatus } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { ModelsPayload } from "@/lib/models-api";

type Payload = Pick<ModelsPayload, "defaultModelSelection"> | undefined;

/** 적용할 값 — 변경이 없거나 판정이 없으면 null */
export function nextSelectedModel(payload: Payload, current: string): string | null {
  const sel = payload?.defaultModelSelection;
  if (!sel) return null;
  return sel.effective === current ? null : sel.effective;
}

/**
 * 저장 안 된 기존 선택 넘기기 — 종전엔 저장 버튼 없이 고른 모델이 localStorage 에 남아 계속 쓰였다.
 * 서버에 저장값이 없고(saved=null) store 에 구체 모델이 있으면 판정 적용 전에 그 값을 한 번 저장한다.
 */
export function needsCarryOver(payload: Payload, current: string): boolean {
  const sel = payload?.defaultModelSelection;
  return !!sel && sel.saved === null && !!current && current !== "default";
}

/** 저장한 모델을 못 써 자동으로 답하는 상태인가 (auto·ok 가 아닌 것) */
export function isFallbackStatus(status: DefaultModelStatus | undefined): status is Exclude<DefaultModelStatus, "auto" | "ok"> {
  return !!status && status !== "auto" && status !== "ok";
}

/**
 * 모델 목록이 올 때마다 서버 판정을 store 에 적용한다. `active` 는 인증 확정 + 로그인 사용자의 목록일 때만 true —
 * 게스트/미확정 목록으로 저장된 선택을 덮지 않는다(2026-09-08 가드).
 */
export function useDefaultModelSync(modelsData: ModelsPayload | undefined, active: boolean): void {
  const queryClient = useQueryClient();
  const carrying = useRef(false);
  useEffect(() => {
    if (!active || !modelsData) return;
    const current = useAppStore.getState().selectedModel;
    if (needsCarryOver(modelsData, current)) {
      if (carrying.current) return;
      carrying.current = true;
      // 실패하면 store 를 건드리지 않고 다음 로드에 다시 시도한다
      void ApiClient.put("/api/users/me/preferences", { defaultModel: current })
        .then(() => queryClient.invalidateQueries({ queryKey: ["models"] }))
        .catch(() => {})
        .finally(() => { carrying.current = false; });
      return;
    }
    const next = nextSelectedModel(modelsData, current);
    if (next !== null) useAppStore.getState().setSelectedModel(next);
  }, [modelsData, active, queryClient]);
}
