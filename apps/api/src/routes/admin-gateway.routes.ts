/**
 * 게이트웨이 모델 상태 (UX·게이트웨이 PR-14). 관리자 전용.
 *   GET /api/admin/gateway/models — LiteLLM `/model/info` 의 라우트 목록 + 로컬 카탈로그 가용성 + 기본 모델.
 * 게이트웨이 조회 실패는 502 가 아니라 200 `{ ok:false, reason }` — 카드가 사유를 그대로 보여 준다.
 * @module routes/admin-gateway
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getConfig } from '../config';
import { LLM_TIMEOUTS } from '../config/timeouts';
import { fetchGatewayModelInfo, type GatewayModelInfoEntry } from '../config/local-models-discovery';
import { getLocalModels, type LocalModelEntry } from '../config/local-models';

export interface GatewayModelStatus {
    name: string;
    /** litellm_params.model — 업스트림 모델(`hosted_vllm/…`, `openrouter/*` 등) */
    upstream: string | null;
    mode: string | null;
    /** provider prefix 없는 이름 = 로컬(DGX vLLM) 라우트 */
    local: boolean;
    /** 로컬 카탈로그 프로브 결과 — 카탈로그에 없으면 null */
    available: boolean | null;
    unavailableReason: string | null;
    isDefault: boolean;
}

/** PURE: `/model/info` 항목 + 로컬 카탈로그 → 카드 행(로컬 먼저, 이름순) */
export function summarizeGatewayModels(
    data: ReadonlyArray<GatewayModelInfoEntry>,
    catalog: ReadonlyArray<LocalModelEntry>,
    defaultModel: string,
): GatewayModelStatus[] {
    return data
        .filter((e) => !!e.model_name)
        .map((e) => {
            const local = !e.model_name.includes('/');
            const entry = local ? catalog.find((m) => m.id === e.model_name) : undefined;
            return {
                name: e.model_name,
                upstream: e.litellm_params?.model ?? null,
                mode: e.model_info?.mode ?? null,
                local,
                available: entry ? entry.available !== false : null,
                unavailableReason: entry?.unavailableReason ?? null,
                isDefault: e.model_name === defaultModel,
            };
        })
        .sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
}

export const adminGatewayRouter = Router();
adminGatewayRouter.use('/gateway', requireAuth, requireAdmin);

adminGatewayRouter.get('/gateway/models', asyncHandler(async (_req: Request, res: Response) => {
    const cfg = getConfig();
    const r = await fetchGatewayModelInfo(cfg.llmBaseUrl, cfg.llmApiKey, LLM_TIMEOUTS.GATEWAY_MODEL_STATUS_TIMEOUT_MS);
    if (!r.ok) {
        res.json(success({ ok: false, reason: r.reason, defaultModel: cfg.llmDefaultModel, models: [] }));
        return;
    }
    res.json(success({
        ok: true, defaultModel: cfg.llmDefaultModel,
        models: summarizeGatewayModels(r.data, getLocalModels(), cfg.llmDefaultModel),
    }));
}));
