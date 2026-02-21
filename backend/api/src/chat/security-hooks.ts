/**
 * ============================================================
 * Security Hooks - Chat 파이프라인 보안 검사 모듈
 * ============================================================
 *
 * Pre-request: Jailbreak 탐지 + PII 감지
 * Post-response: 시스템 프롬프트 누출 감지
 *
 * ChatService 파이프라인에 통합되어 LLM 특화 보안 위협을 차단합니다.
 * XSS/SQL 인젝션은 input-sanitizer.ts가 담당하며, 이 모듈은 독립적으로 동작합니다.
 *
 * @module chat/security-hooks
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('SecurityHooks');

// ============================================================
// Types
// ============================================================

/**
 * 보안 위반 유형
 * - jailbreak: 탈옥 시도 (제한 우회, 역할 변경 등)
 * - pii: 개인식별정보 포함 (주민번호, 카드번호, 전화번호 등)
 * - system_prompt_leak: 시스템 프롬프트 누출 (LLM 응답에서 감지)
 */
export type ViolationType = 'jailbreak' | 'pii' | 'system_prompt_leak';

/**
 * 보안 위반 심각도
 * - block: 요청 차단 (즉시 거부)
 * - warn: 경고 로깅 (처리는 계속)
 * - redact: 마스킹 처리 후 계속
 */
export type ViolationSeverity = 'block' | 'warn' | 'redact';

/**
 * 개별 보안 위반 항목
 */
export interface SecurityViolation {
    /** 위반 유형 */
    type: ViolationType;
    /** 심각도 */
    severity: ViolationSeverity;
    /** 위반 상세 설명 */
    detail: string;
    /** 매칭된 패턴 문자열 (디버깅용) */
    matchedPattern?: string;
}

/**
 * 보안 검사 결과
 */
export interface SecurityCheckResult {
    /** 검사 통과 여부 (위반 없으면 true) */
    passed: boolean;
    /** 감지된 위반 목록 */
    violations: SecurityViolation[];
}

// ============================================================
// Patterns
// ============================================================

/**
 * Jailbreak 탐지 패턴 (대소문자 무시)
 *
 * LLM의 안전 제한을 우회하려는 시도를 탐지합니다.
 * DAN 모드, 개발자 모드, 제한 해제 요청 등을 포함합니다.
 */
const JAILBREAK_PATTERNS: RegExp[] = [
    /\bDAN\s*mode\b/i,
    /\bdeveloper\s*mode\b/i,
    /\bunlimited\s*mode\b/i,
    /\bjailbreak\b/i,
    /\bact\s+as\s+if\s+you\s+have\s+no\s+restrictions\b/i,
    /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|guidelines)\b/i,
    /\bpretend\s+you\s+(are|have)\s+no\s+(rules|restrictions|limits|boundaries)\b/i,
    /\byou\s+are\s+now\s+(free|unrestricted|unfiltered)\b/i,
    /\b(bypass|override|disable)\s+(your\s+)?(safety|content|ethical)\s*(filter|guard|restrictions?)\b/i,
    /\bsystem\s*prompt\s*(is|:)/i,
];

/**
 * PII(개인식별정보) 탐지 패턴
 *
 * 한국 특화 패턴 + 범용 패턴을 포함합니다.
 * 감지 시 warn 수준으로 처리하며, redactPII()로 마스킹 가능합니다.
 */
const PII_PATTERNS: { pattern: RegExp; label: string }[] = [
    { pattern: /\d{6}-[1-4]\d{6}/, label: 'Korean resident registration number' },
    { pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/, label: 'Credit card number' },
    { pattern: /010-?\d{4}-?\d{4}/, label: 'Korean phone number' },
    { pattern: /\d{3}-\d{2}-\d{5}/, label: 'SSN-like pattern' },
    {
        // 3개 이상의 이메일 주소가 쉼표/세미콜론/줄바꿈으로 구분된 경우 탐지
        // 마지막 이메일은 구분자 없이 끝날 수 있음
        pattern: /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*[,;\n]\s*){2,}[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
        label: 'Bulk email addresses',
    },
];

/**
 * 시스템 프롬프트 누출 탐지 패턴 (LLM 응답에서 감지)
 *
 * LLM이 내부 시스템 프롬프트를 사용자에게 노출하는 경우를 탐지합니다.
 */
const LEAK_PATTERNS: RegExp[] = [
    /my\s+(system\s+)?prompt\s+(is|says|instructs)/i,
    /my\s+instructions\s+(are|say|tell)/i,
    /I\s+was\s+(told|instructed|programmed)\s+to/i,
    /here\s+(is|are)\s+my\s+(system\s+)?(prompt|instructions)/i,
];

// ============================================================
// Functions
// ============================================================

/**
 * Pre-request 보안 검사: Jailbreak 탐지 + PII 감지
 *
 * 사용자 메시지를 LLM에 전달하기 전에 실행합니다.
 * - Jailbreak 패턴 감지 시 severity='block' (요청 차단 권장)
 * - PII 패턴 감지 시 severity='warn' (로깅 후 처리 계속)
 *
 * @param userMessage - 검사할 사용자 입력 메시지
 * @returns 검사 결과 (passed: 위반 없음, violations: 감지된 위반 목록)
 *
 * @example
 * const result = preRequestCheck('DAN mode enabled');
 * if (!result.passed) {
 *   // 차단 처리
 * }
 */
export function preRequestCheck(userMessage: string): SecurityCheckResult {
    const violations: SecurityViolation[] = [];

    // Jailbreak 패턴 검사
    for (const pattern of JAILBREAK_PATTERNS) {
        const match = pattern.exec(userMessage);
        if (match) {
            const violation: SecurityViolation = {
                type: 'jailbreak',
                severity: 'block',
                detail: `Jailbreak attempt detected`,
                matchedPattern: match[0],
            };
            violations.push(violation);
            logger.warn(`Jailbreak attempt detected: "${match[0]}"`, { pattern: pattern.source });
            break; // 첫 번째 매칭으로 충분 (중복 위반 방지)
        }
    }

    // PII 패턴 검사 (jailbreak와 독립적으로 실행)
    for (const { pattern, label } of PII_PATTERNS) {
        const match = pattern.exec(userMessage);
        if (match) {
            const violation: SecurityViolation = {
                type: 'pii',
                severity: 'warn',
                detail: `PII detected: ${label}`,
                matchedPattern: match[0].substring(0, 20) + (match[0].length > 20 ? '...' : ''),
            };
            violations.push(violation);
            logger.warn(`PII detected in user message: ${label}`);
        }
    }

    return {
        passed: violations.length === 0,
        violations,
    };
}

/**
 * Post-response 보안 검사: 시스템 프롬프트 누출 감지
 *
 * LLM 응답을 사용자에게 전달하기 전에 실행합니다.
 * - 누출 패턴 감지 시 severity='warn'
 * - systemPromptFragments 제공 시 verbatim 포함 여부도 검사 (30자 이상 프래그먼트만)
 *
 * @param response - 검사할 LLM 응답 텍스트
 * @param systemPromptFragments - 시스템 프롬프트 조각 목록 (선택적, verbatim 검사용)
 * @returns 검사 결과
 *
 * @example
 * const result = postResponseCheck(llmResponse, ['You are a helpful assistant...']);
 * if (!result.passed) {
 *   logger.warn('System prompt leak detected');
 * }
 */
export function postResponseCheck(
    response: string,
    systemPromptFragments?: string[]
): SecurityCheckResult {
    const violations: SecurityViolation[] = [];

    // 누출 패턴 검사
    for (const pattern of LEAK_PATTERNS) {
        const match = pattern.exec(response);
        if (match) {
            const violation: SecurityViolation = {
                type: 'system_prompt_leak',
                severity: 'warn',
                detail: `Potential system prompt leak detected in response`,
                matchedPattern: match[0],
            };
            violations.push(violation);
            logger.warn(`System prompt leak pattern detected: "${match[0]}"`, {
                pattern: pattern.source,
            });
            break; // 첫 번째 매칭으로 충분
        }
    }

    // Verbatim 시스템 프롬프트 포함 여부 검사 (30자 이상 프래그먼트만)
    if (systemPromptFragments && systemPromptFragments.length > 0) {
        for (const fragment of systemPromptFragments) {
            if (fragment.length >= 30 && response.includes(fragment)) {
                const violation: SecurityViolation = {
                    type: 'system_prompt_leak',
                    severity: 'warn',
                    detail: `Verbatim system prompt fragment found in response`,
                    matchedPattern: fragment.substring(0, 40) + (fragment.length > 40 ? '...' : ''),
                };
                violations.push(violation);
                logger.warn(`Verbatim system prompt fragment leaked in response`, {
                    fragmentLength: fragment.length,
                });
                break; // 첫 번째 매칭으로 충분
            }
        }
    }

    return {
        passed: violations.length === 0,
        violations,
    };
}

/**
 * PII 마스킹 처리 (로깅 목적 전용)
 *
 * 텍스트에서 개인식별정보를 마스킹 문자열로 대체합니다.
 * 실제 데이터 저장/전송이 아닌 로그 기록 시 사용하세요.
 *
 * 마스킹 대상:
 * - 한국 주민등록번호 → [주민번호 마스킹]
 * - 신용카드 번호 → [카드번호 마스킹]
 * - 한국 휴대폰 번호 → [전화번호 마스킹]
 *
 * @param text - 마스킹할 원본 텍스트
 * @returns PII가 마스킹된 텍스트
 *
 * @example
 * const safe = redactPII('주민번호 880101-1234567');
 * // → '주민번호 [주민번호 마스킹]'
 */
export function redactPII(text: string): string {
    let redacted = text;

    // 한국 주민등록번호 마스킹
    redacted = redacted.replace(/\d{6}-[1-4]\d{6}/g, '[주민번호 마스킹]');

    // 신용카드 번호 마스킹
    redacted = redacted.replace(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, '[카드번호 마스킹]');

    // 한국 휴대폰 번호 마스킹
    redacted = redacted.replace(/010-?\d{4}-?\d{4}/g, '[전화번호 마스킹]');

    return redacted;
}
