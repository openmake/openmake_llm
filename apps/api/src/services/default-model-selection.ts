/**
 * @module services/default-model-selection
 * @description 저장된 기본 모델(사용자 선호 defaultModel)을 지금 쓸 수 있는지 판정하는 순수 함수.
 *
 * 못 쓰면 저장값은 그대로 두고 effective 를 'default'(자동)로 내린다 — 키를 다시 켜면 판정이 ok 로 돌아와
 * 저장한 모델로 복귀한다. 키가 켜져 있으면 provider 목록에 없어도 내리지 않는다(목록 조회의 일시 실패·fallback
 * 목록 때문에 잠깐 빠질 수 있다). 실행 시점 거절(provider-router API_KEY_DISABLED)은 이 판정과 무관하게 유지된다.
 */
import type { DefaultModelSelection } from '@openmake/shared-types';

export interface DefaultModelSelectionInput {
    /** 선호 defaultModel 원문(형식 미검증) */
    saved: unknown;
    /** 로컬 카탈로그 id(접두어 없이, available:false 포함) */
    localModelIds: readonly string[];
    /** 사용자 키 행 — 꺼진 것 포함, 삭제된 것 제외 */
    keys: ReadonlyArray<{ providerId: string; enabled: boolean }>;
    /** 실사용 불가 모델 `${providerId}:${modelId}` */
    unusable: ReadonlySet<string>;
}

const LOCAL_PREFIX = 'local-llm:';

export function judgeDefaultModelSelection(input: DefaultModelSelectionInput): DefaultModelSelection {
    const saved = typeof input.saved === 'string' ? input.saved : null;
    const fallback = (status: DefaultModelSelection['status']): DefaultModelSelection => ({ saved, effective: 'default', status });
    if (saved === null || saved === '' || saved === 'default') return fallback('auto');

    const ok: DefaultModelSelection = { saved, effective: saved, status: 'ok' };
    if (saved.startsWith(LOCAL_PREFIX)) {
        return input.localModelIds.includes(saved.slice(LOCAL_PREFIX.length)) ? ok : fallback('not_listed');
    }
    const sep = saved.indexOf(':');
    if (sep <= 0 || sep === saved.length - 1) return fallback('not_listed');

    const providerId = saved.slice(0, sep);
    const key = input.keys.find((k) => k.providerId === providerId);
    if (!key) return fallback('key_missing');
    if (!key.enabled) return fallback('key_disabled');
    if (input.unusable.has(saved)) return fallback('unusable');
    return ok;
}
