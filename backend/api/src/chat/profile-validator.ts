/**
 * ============================================================
 * Profile Validator - 프로파일 유효성 검증기
 * ============================================================
 *
 * 파이프라인 프로파일 설정의 논리적 일관성을 검증합니다.
 *
 * Harness Engineering 원칙: Constrain — 논리적으로 모순되는 프로파일 설정을
 * 서버 시작 시 조기 발견하여 런타임 오류를 방지합니다.
 *
 * @module chat/profile-validator
 * @see chat/pipeline-profile.ts - 프로파일 정의
 * @see config/runtime-limits.ts - PROFILE_VALIDATION config
 */
import { createLogger } from '../utils/logger';
import { PROFILE_VALIDATION } from '../config/runtime-limits';
import type { PipelineProfile } from './pipeline-profile';

const logger = createLogger('ProfileValidator');

/** 검증 결과 단일 항목 */
export interface ProfileValidationIssue {
    /** 프로파일 ID */
    profileId: string;
    /** 심각도: error는 논리적 모순, warn은 비효율적 설정 */
    severity: 'error' | 'warn';
    /** 검증 규칙 이름 */
    rule: string;
    /** 상세 설명 */
    message: string;
}

/** 전체 검증 결과 */
export interface ProfileValidationResult {
    /** 검증 통과 여부 (error가 하나라도 있으면 false) */
    valid: boolean;
    /** 발견된 이슈 목록 */
    issues: ProfileValidationIssue[];
}

/**
 * 단일 프로파일의 논리적 일관성을 검증합니다.
 */
export function validateProfile(profile: PipelineProfile): ProfileValidationIssue[] {
    const issues: ProfileValidationIssue[] = [];
    const id = profile.id;

    // Rule 1: single 전략인데 discussion=true → 모순
    // single은 속도 최적화용이므로 토론은 비효율적
    if (profile.executionStrategy === 'single' && profile.discussion) {
        issues.push({
            profileId: id,
            severity: 'error',
            rule: 'single-no-discussion',
            message: `single 전략에서 discussion=true는 모순됩니다 (single은 속도 우선, discussion은 품질 우선)`,
        });
    }

    // Rule 2: single 전략인데 agentLoopMax > 1 → 경고
    // single은 도구 호출을 비활성화하므로 agentLoopMax가 의미 없음
    if (profile.executionStrategy === 'single' && profile.agentLoopMax > 1) {
        issues.push({
            profileId: id,
            severity: 'warn',
            rule: 'single-loop-max',
            message: `single 전략에서 agentLoopMax=${profile.agentLoopMax}는 무의미합니다 (도구 호출 비활성화)`,
        });
    }

    // Rule 3: thinking='off'인데 generate-verify → 경고
    // GV는 품질 검증용인데 thinking이 꺼져 있으면 효과 감소
    if (profile.thinking === 'off' && profile.executionStrategy === 'generate-verify') {
        issues.push({
            profileId: id,
            severity: 'warn',
            rule: 'gv-no-thinking',
            message: `generate-verify 전략에서 thinking=off는 비효율적입니다 (검증 품질 저하)`,
        });
    }

    // Rule 4: contextStrategy='lite'인데 discussion=true → 모순
    // 토론은 긴 컨텍스트가 필요
    if (profile.contextStrategy === 'lite' && profile.discussion) {
        issues.push({
            profileId: id,
            severity: 'error',
            rule: 'lite-no-discussion',
            message: `contextStrategy=lite에서 discussion=true는 모순됩니다 (토론에 충분한 컨텍스트 필요)`,
        });
    }

    // Rule 5: timeBudgetSeconds > 0인데 discussion=true → 경고
    // 토론은 시간이 오래 걸리므로 시간 예산과 충돌 가능
    if (profile.timeBudgetSeconds > 0 && profile.discussion) {
        issues.push({
            profileId: id,
            severity: 'warn',
            rule: 'time-budget-discussion',
            message: `timeBudget=${profile.timeBudgetSeconds}s에서 discussion=true는 시간 초과 위험이 있습니다`,
        });
    }

    // Rule 6: engineModel이 비어있으면 → 에러
    if (!profile.engineModel || profile.engineModel.trim().length === 0) {
        issues.push({
            profileId: id,
            severity: 'error',
            rule: 'empty-engine',
            message: `engineModel이 비어있습니다`,
        });
    }

    return issues;
}

/**
 * 모든 프로파일을 검증합니다.
 *
 * @param profiles - 프로파일 딕셔너리
 * @returns 전체 검증 결과
 */
export function validateAllProfiles(
    profiles: Record<string, PipelineProfile>,
): ProfileValidationResult {
    if (!PROFILE_VALIDATION.ENABLED) {
        return { valid: true, issues: [] };
    }

    const allIssues: ProfileValidationIssue[] = [];

    for (const profile of Object.values(profiles)) {
        const issues = validateProfile(profile);
        allIssues.push(...issues);
    }

    const hasErrors = allIssues.some(i => i.severity === 'error');

    // 로깅
    for (const issue of allIssues) {
        if (issue.severity === 'error') {
            logger.error(`❌ 프로파일 검증 실패 [${issue.profileId}] ${issue.rule}: ${issue.message}`);
        } else {
            logger.warn(`⚠️ 프로파일 검증 경고 [${issue.profileId}] ${issue.rule}: ${issue.message}`);
        }
    }

    if (allIssues.length === 0) {
        logger.info(`✅ 프로파일 검증 통과: ${Object.keys(profiles).length}개 프로파일`);
    } else {
        logger.info(
            `프로파일 검증 완료: ${allIssues.filter(i => i.severity === 'error').length}개 오류, ` +
            `${allIssues.filter(i => i.severity === 'warn').length}개 경고`,
        );
    }

    return {
        valid: !hasErrors,
        issues: allIssues,
    };
}
