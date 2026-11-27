/**
 * 확장 번들 Custom Agent 관리 설치 보완(P8, 마켓플레이스 계획 v3.7 §8-5a) 플래그.
 *
 * `EXTENSION_AGENT_BUNDLE_PROVENANCE`(기본 OFF, system_settings 실시간). 꺼져 있으면 종전 그대로.
 * 켜면:
 *  - 승인함 `GET /api/user-agents/pending` 이 확장 이름·원본 URL·ref 를 함께 싣는다(웹 카드가 출처를 표시).
 *  - 확장 제거 시 **아직 승인되지 않은**(pending) 에이전트는 soft-delete 와 함께 이름에 `-removed-<6자>` 를 붙인다 —
 *    UNIQUE(user_id, name) 이 soft-delete 행에도 걸려, 같은 확장을 다시 설치할 때 이름이 표류하던 결함의 수정.
 *    승인된 에이전트는 종전대로 이름 유지(제거 기록).
 *
 * 승인 대기 설치 자체는 별개 플래그 `EXTENSION_AGENT_APPROVAL_REQUIRED`(config/extension-security) — 이 플래그는
 * 그 위에 덧씌우는 표시·정리만 바꾼다.
 *
 * @module config/extension-agent-provenance
 */
import { getConfig } from './env';

export const EXTENSION_AGENT_PROVENANCE_FLAG = 'EXTENSION_AGENT_BUNDLE_PROVENANCE';

export function extensionAgentBundleProvenanceEnabled(): boolean {
    return getConfig().extensionAgentBundleProvenance;
}
