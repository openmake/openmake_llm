/**
 * MCP 도구 등급별 접근 제어
 * 
 * 사용자 tier에 따라 접근 가능한 도구를 정의합니다.
 */

import { UserTier } from '../data/user-manager';
import { MCP_NAMESPACE_SEPARATOR } from './types';

/**
 * 등급별 허용 도구 목록
 * - '*' 는 모든 도구 허용
 * - 'tool_*' 패턴은 해당 접두사로 시작하는 모든 도구 허용
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
 * 기본 tier 반환 (role 기반)
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
