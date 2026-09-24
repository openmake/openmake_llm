/**
 * @module services/model-assignment-cache
 * @description 전역 슬롯 배정 캐시 무효화 진입점.
 *
 * 역할(model-role-resolver)과 기능(capability-resolver)이 슬롯을 공유하므로(code ← review/text.code,
 * reasoning ← research/text.reason) 어느 경로로 전역 배정을 바꾸든 두 캐시를 함께 비워야 한다.
 * 전역 배정을 쓰는 모든 경로(관리자 역할·기능 라우트, 통합 배정 라우트, 구성 가져오기)가 이 하나를 호출한다.
 */
import { clearGlobalRolesCache } from './model-role-resolver';
import { clearGlobalCapabilityCache } from './orchestrator/capability-resolver';

/** 전역(scope='__global__') 배정 변경 후 role·capability 해석 캐시를 모두 무효화한다 */
export function invalidateGlobalAssignmentCaches(): void {
    clearGlobalRolesCache();
    clearGlobalCapabilityCache();
}
