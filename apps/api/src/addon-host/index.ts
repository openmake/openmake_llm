/**
 * Add-on Host — Base 가 아는 유일한 확장 지점 (Add-on 전환 P1 1차, 2026-09-18).
 *
 * 지금은 내장 콘텐츠(산업 에이전트 스킬·유틸리티 스킬) 시드의 부팅 진입점만 맡는다. server.ts 가
 * 시더를 직접 부르던 것을 여기로 모았고 동작은 같다(비차단·fail-open). 이후 단계에서 manifest
 * 해석·설치 범위(system/organization/user)·내장 번들 로더가 이 모듈 아래로 들어온다.
 * 경계 규칙은 `config/addon-boundary.ts`.
 *
 * @module addon-host
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('AddonHost');

/** 내장 콘텐츠 시드 — 서버 기동을 막지 않는다(각 시더는 백그라운드로 돌고 실패는 로그만). */
export async function startAddonHost(): Promise<void> {
    try {
        const { seedAgentSkills } = await import('../agents/skill-seeder');
        seedAgentSkills().catch((err: unknown) => logger.error('스킬 시딩 실패:', err));
    } catch (err) {
        logger.error('스킬 시더 로드 실패:', err);
    }

    try {
        const { seedUtilitySkills } = await import('../agents/utility-skills-seeder');
        seedUtilitySkills().catch((err: unknown) => logger.error('유틸리티 스킬 시딩 실패:', err));
    } catch (err) {
        logger.error('유틸리티 스킬 시더 로드 실패:', err);
    }
}
