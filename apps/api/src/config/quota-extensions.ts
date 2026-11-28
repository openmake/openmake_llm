/**
 * 비용·쿼터 F25 잔여 — opt-in 플래그 4종(기본 OFF, system_settings 실시간 — getConfig 가 overlay 를 반영).
 *
 * - `QUOTA_USER_OVERRIDES_ENABLED`: 사용자별 한도 덮어쓰기(`user_quota_overrides`) — 시간·주 토큰 한도, 월 비용 예산.
 *   OFF 면 모든 사용자가 전역 `LLM_HOURLY/WEEKLY_TOKEN_LIMIT`·`USER_MONTHLY_COST_BUDGET_MICROS` 를 쓴다(종전).
 * - `QUOTA_ORG_GRANTS_ENABLED`: 조직 grant·비용(micros) grant — 조직 월 예산·사용자 월 비용 예산에 grants 합을 더한다.
 *   OFF 면 grants 는 사용자 토큰(시간·주)만(종전). 관리자 API 의 `subjectType:'org'`·`dimension:'cost_micros'` 는 400.
 * - `QUOTA_ORG_BUCKET_ENABLED`: 조직 자체 월 버킷 — 사용량을 **청구 대상 조직**(활성 조직, 없으면 예산 있는 소속 조직 전부)의
 *   버킷에 쌓고 조직 예산을 그 버킷으로 판정한다. 탈퇴해도 조직 사용분이 남고, 활성 조직이 있으면 다른 조직에 중복 집계되지 않는다.
 *   OFF 면 조직 예산 = 멤버 월 버킷 합(종전).
 * - `STORAGE_GENERATED_DAILY_SNAPSHOT_ENABLED`: `/generated` 파일 소유 기록(`generated_media_files`) + 하루 1회 보관량(GB·일) 계상.
 *   ON 이면 저장 시점 "1 GB·일" 근사 기록은 하지 않는다. OFF 면 종전 근사(저장 시 1회).
 *
 * @module config/quota-extensions
 */
import { getConfig } from './env';

export const QUOTA_EXTENSION_FLAGS = {
    USER_OVERRIDES: 'QUOTA_USER_OVERRIDES_ENABLED',
    ORG_GRANTS: 'QUOTA_ORG_GRANTS_ENABLED',
    ORG_BUCKET: 'QUOTA_ORG_BUCKET_ENABLED',
    STORAGE_DAILY_SNAPSHOT: 'STORAGE_GENERATED_DAILY_SNAPSHOT_ENABLED',
} as const;

export function quotaUserOverridesEnabled(): boolean { return getConfig().quotaUserOverridesEnabled; }
export function quotaOrgGrantsEnabled(): boolean { return getConfig().quotaOrgGrantsEnabled; }
export function quotaOrgBucketEnabled(): boolean { return getConfig().quotaOrgBucketEnabled; }
export function storageGeneratedDailySnapshotEnabled(): boolean { return getConfig().storageGeneratedDailySnapshotEnabled; }
