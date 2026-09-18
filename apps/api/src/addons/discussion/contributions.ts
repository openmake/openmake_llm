/**
 * discussion add-on 이 Base 레지스트리에 기여하는 선언 (순수 데이터).
 *
 * @module addons/discussion/contributions
 */
import type { AddonContribution } from '../../addon-host/contributions';

export const discussionContribution: AddonContribution = {
    // 인라인 토론 도구는 파일·네트워크를 직접 건드리지 않는 제어 도구다 — 승인 정책 all 에서만 승인 대상
    toolRisk: { start_discussion: 'control' },
};
