/**
 * ============================================================
 * Service Bootstrap - 싱글톤 서비스 초기화 모듈
 * ============================================================
 *
 * 서버 시작 시 필요한 모든 싱글톤 서비스를 한 곳에서 초기화합니다.
 * setupRoutes()에서 분리하여 서비스 초기화와 라우트 마운트의 관심사를 분리합니다.
 *
 * @module bootstrap
 * @description 초기화되는 서비스:
 * - CacheSystem       - LRU 기반 캐시 시스템
 * - AnalyticsSystem   - 사용 패턴 분석 및 통계
 * - AlertSystem       - 시스템 이벤트 알림 및 경고
 * - AgentLearning     - RLHF 기반 에이전트 성능 추적
 * - CustomAgentBuilder - 커스텀 에이전트 생성 빌더
 *
 * @requires cache - LRU 캐시 시스템
 * @requires monitoring/analytics - 분석 시스템
 * @requires monitoring/alerts - 알림 시스템
 * @requires agents/learning - 에이전트 학습 시스템
 * @requires agents/custom-builder - 커스텀 에이전트 빌더
 */

import { getCacheSystem } from './cache';
import { getAnalyticsSystem } from './monitoring/analytics';
import { getAlertSystem } from './monitoring/alerts';
import { getAgentLearningSystem } from './agents/learning';
import { getCustomAgentBuilder } from './agents/custom-builder';
import { startDbRetention } from './data/db-retention';

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
    startDbRetention();        // DB 데이터 보존 정리 스케줄러 시작
}
