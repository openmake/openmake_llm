/**
 * Add-on 의 모델 요구(`requires.model`) 판정 (2026-09-19, S3).
 *
 * 판정은 **정적**이다 — 모델 프로필(`config/model-profiles.ts`)·카탈로그의 컨텍스트 길이와 대조할 뿐,
 * 턴마다 LLM 에게 "이 모델로 되나" 를 묻지 않는다(CLAUDE.md 의 A형 앞단 판단 금지).
 *
 * 미충족이면 **조용히 외부 모델로 바꾸지 않는다** — 충족 후보를 돌려주고, 후보가 없으면 없다고 말한다.
 * 실제 전환은 사용자·관리자의 배정이고, 외부 모델은 `EXTERNAL_MODEL_POLICY` 와 조직 정책을 통과해야 한다.
 *
 * @module services/addon/model-requirements
 */
import type { ModelCapabilities } from '../../config/model-profiles';

export interface AddonModelRequirement {
    minContext?: number;
    tools?: boolean;
    vision?: boolean;
}

export interface ModelFacts {
    id: string;
    contextLength?: number;
    capabilities?: Partial<ModelCapabilities>;
}

export interface ModelRequirementVerdict {
    ok: boolean;
    /** 요구를 충족하는 모델 id — 비어 있으면 쓸 수 있는 모델이 없다 */
    satisfiedBy: string[];
    /** 사람이 읽는 미충족 사유(충족 시 undefined) */
    reason?: string;
}

/** PURE: 모델 하나가 요구를 충족하는가. 모르는 값(undefined)은 **충족으로 보지 않는다**(조용한 통과 금지). */
export function modelSatisfies(req: AddonModelRequirement, model: ModelFacts): boolean {
    if (req.minContext !== undefined && (model.contextLength ?? 0) < req.minContext) return false;
    if (req.tools === true && model.capabilities?.toolCalling !== true) return false;
    if (req.vision === true && model.capabilities?.vision !== true) return false;
    return true;
}

/** PURE: 후보 모델 목록으로 요구를 판정한다. */
export function checkModelRequirement(req: AddonModelRequirement | undefined, models: readonly ModelFacts[]): ModelRequirementVerdict {
    if (!req || Object.keys(req).length === 0) return { ok: true, satisfiedBy: models.map(m => m.id) };
    const satisfiedBy = models.filter(m => modelSatisfies(req, m)).map(m => m.id);
    if (satisfiedBy.length > 0) return { ok: true, satisfiedBy };
    const parts: string[] = [];
    if (req.minContext !== undefined) parts.push(`컨텍스트 ${req.minContext.toLocaleString()} 토큰 이상`);
    if (req.tools) parts.push('도구 호출');
    if (req.vision) parts.push('비전');
    return {
        ok: false,
        satisfiedBy: [],
        reason: `요구(${parts.join(' · ')})를 충족하는 모델이 없습니다. 충족 모델을 배정하거나 add-on 을 끄십시오.`,
    };
}

/**
 * 지금 쓸 수 있는 로컬 채팅 모델의 사실(프로필 + 카탈로그)을 모은다.
 * 외부 provider 모델은 사용자 BYOK·정책에 달려 있어 여기 후보로 세지 않는다 —
 * 폐쇄망에서 "외부로 조용히 넘어가는" 안내를 만들지 않기 위해서다.
 */
export async function availableChatModelFacts(): Promise<ModelFacts[]> {
    const { getLocalChatModels } = await import('../../config/local-models');
    const { resolveModelProfile } = await import('../../config/model-profiles');
    return getLocalChatModels().map(m => {
        const profile = resolveModelProfile(m.id);
        return {
            id: m.id,
            contextLength: m.contextLength,
            capabilities: {
                ...(profile.capabilities ?? {}),
                // 부팅 프로브 실측이 있으면 프로필보다 우선(프로필에 없는 모델로 교체해도 정확)
                ...(m.probedCapabilities?.toolCalling !== undefined ? { toolCalling: m.probedCapabilities.toolCalling } : {}),
            },
        };
    });
}
