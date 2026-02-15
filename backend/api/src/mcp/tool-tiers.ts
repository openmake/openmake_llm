/**
 * ============================================================
 * Tool Tiers - MCP 도구 등급별 접근 제어
 * ============================================================
 *
 * 사용자 등급(UserTier)에 따라 접근 가능한 MCP 도구를 제어합니다.
 * ToolRouter에서 도구 목록 필터링 및 실행 권한 검증에 사용됩니다.
 *
 * @module mcp/tool-tiers
 * @description
 * - 등급별 허용 도구 목록 (TOOL_TIERS) 정의
 * - 와일드카드 패턴 매칭 지원 ('*' = 전체, 'prefix_*' = 접두사)
 * - 외부 도구(:: 네임스페이스) 등급별 접근 정책
 * - 역할(role) → 등급(tier) 기본 매핑
 *
 * 접근 제어 규칙:
 * 1. enterprise: 모든 도구 접근 가능 ('*')
 * 2. pro: 지정된 도구 + 와일드카드 매칭 + 모든 외부 도구
 * 3. free: 지정된 기본 도구만 (외부 도구 접근 불가)
 */

import { UserTier } from '../data/user-manager';
import { MCP_NAMESPACE_SEPARATOR } from './types';

/**
 * 등급별 허용 도구 목록
 *
 * 각 UserTier에 대해 접근 가능한 도구 이름 패턴을 정의합니다.
 * - '*': 모든 도구 허용 (enterprise 등급)
 * - 'prefix_*': 해당 접두사로 시작하는 모든 도구 허용 (예: 'firecrawl_*')
 * - 정확한 이름: 해당 도구만 허용 (예: 'web_search')
 *
 * @example
 * ```typescript
 * // free 등급 사용자는 web_search, vision_ocr, analyze_image만 사용 가능
 * // enterprise 등급 사용자는 모든 도구 사용 가능
 * ```
 */
export const TOOL_TIERS: Record<UserTier, string[]> = {
    free: [
        'web_search',           // 웹 검색
        'vision_ocr',           // 이미지 OCR
        'analyze_image',        // 이미지 분석
    ],
    pro: [
        'web_search',
        'vision_ocr',
        'analyze_image',
        'run_command',          // 명령어 실행
        'firecrawl_*',          // Firecrawl 관련 모든 도구
        'sequential_thinking',  // Sequential Thinking
    ],
    enterprise: [
        '*',                    // 모든 도구 허용
    ]
};

/**
 * 특정 tier가 특정 도구에 접근 가능한지 확인
 *
 * 접근 제어 알고리즘:
 * 1. TOOL_TIERS[tier]에 '*' 포함 → 모든 도구 허용
 * 2. 외부 도구(:: 포함) → free 거부, pro는 기본 허용, 와일드카드/정확 매칭 우선
 * 3. 정확한 이름 매칭 확인
 * 4. 와일드카드 패턴 매칭 확인 (예: 'firecrawl_*' → 'firecrawl_scrape' 허용)
 *
 * @param tier - 사용자 등급
 * @param toolName - 확인할 도구 이름 (네임스페이스 포함 가능)
 * @returns 접근 가능하면 true
 */
export function canUseTool(tier: UserTier, toolName: string): boolean {
    const allowedTools = TOOL_TIERS[tier];

    // 모든 도구 허용
    if (allowedTools.includes('*')) {
        return true;
    }

    // 외부 도구 (:: 네임스페이스) — free 등급에서는 접근 불가
    if (toolName.includes(MCP_NAMESPACE_SEPARATOR)) {
        if (tier === 'free') {
            return false;
        }
        // pro/enterprise: 와일드카드 패턴으로 서버 단위 접근 제어 가능
        // 예: TOOL_TIERS.pro에 "postgres::*" 추가 가능
        for (const pattern of allowedTools) {
            if (pattern.endsWith('*')) {
                const prefix = pattern.slice(0, -1);
                if (toolName.startsWith(prefix)) {
                    return true;
                }
            }
            if (pattern === toolName) {
                return true;
            }
        }
        // pro 등급: 기본적으로 모든 외부 도구 허용
        if (tier === 'pro') {
            return true;
        }
        return false;
    }

    // 정확한 매칭
    if (allowedTools.includes(toolName)) {
        return true;
    }

    // 와일드카드 패턴 매칭 (예: 'firecrawl_*')
    for (const pattern of allowedTools) {
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            if (toolName.startsWith(prefix)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * 특정 tier가 접근 가능한 도구 목록 반환
 *
 * 전체 도구 이름 목록에서 해당 tier가 사용 가능한 도구만 필터링합니다.
 *
 * @param tier - 사용자 등급
 * @param allTools - 전체 도구 이름 배열
 * @returns 해당 등급에서 사용 가능한 도구 이름 배열
 */
export function getToolsForTier(tier: UserTier, allTools: string[]): string[] {
    const allowedTools = TOOL_TIERS[tier];

    // 모든 도구 허용
    if (allowedTools.includes('*')) {
        return allTools;
    }

    return allTools.filter(toolName => canUseTool(tier, toolName));
}

/**
 * 역할(role)에 대한 기본 tier 반환
 *
 * 사용자 역할을 도구 접근 등급으로 매핑합니다:
 * - admin → enterprise (모든 도구 접근)
 * - user → free (기본 도구만)
 * - guest → free (기본 도구만)
 *
 * @param role - 사용자 역할
 * @returns 해당 역할의 기본 UserTier
 */
export function getDefaultTierForRole(role: 'admin' | 'user' | 'guest'): UserTier {
    switch (role) {
        case 'admin':
            return 'enterprise';
        case 'user':
            return 'free';
        case 'guest':
            return 'free';
        default:
            return 'free';
    }
}
