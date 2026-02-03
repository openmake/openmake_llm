/**
 * Service Bootstrap
 * 싱글톤 서비스 초기화를 한 곳에서 관리
 * 
 * setupRoutes()에서 분리하여 서비스 초기화와 라우트 마운트의 관심사를 분리합니다.
 */

import { getCacheSystem } from './cache';
import { getAnalyticsSystem } from './monitoring/analytics';
import { getAlertSystem } from './monitoring/alerts';
import { getAgentLearningSystem } from './agents/learning';
import { getCustomAgentBuilder } from './agents/custom-builder';

/**
 * 모든 싱글톤 서비스를 초기화합니다.
 * 서버 시작 시 한 번만 호출되어야 합니다.
 */
export function bootstrapServices(): void {
    getCacheSystem();          // 캐시 시스템 시작
    getAnalyticsSystem();      // 분석 시스템 시작
    getAlertSystem();          // 알림 시스템 시작
    getAgentLearningSystem();  // 에이전트 학습 시스템 시작
    getCustomAgentBuilder();   // 커스텀 에이전트 빌더 시작
}
