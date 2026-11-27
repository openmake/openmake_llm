/**
 * ExtensionSourceBlockedError — 확장 원본 정책(M2)이 설치·업데이트·동기화를 거절했을 때. HTTP 403 `EXTENSION_SOURCE_BLOCKED`.
 * 메시지는 코드로 시작한다 — 채팅 도구 결과·기존 400 경로의 문자열 판정이 같은 접두어로 알아본다.
 * @module errors/extension-source-blocked.error
 */
import { AppError } from '../utils/error-handler';
import { EXTENSION_SOURCE_BLOCKED_CODE } from '../config/extension-source-policy';

export { EXTENSION_SOURCE_BLOCKED_CODE };

export interface ExtensionSourceBlockDetail {
    /** DENIED(차단 규칙 일치) · NOT_ALLOWED(허용 목록 밖) · POLICY_INVALID(저장 값 깨짐) · POLICY_UNAVAILABLE(조회 실패) · CATALOG_ONLY(등록 원본만) */
    reason: 'DENIED' | 'NOT_ALLOWED' | 'POLICY_INVALID' | 'POLICY_UNAVAILABLE' | 'CATALOG_ONLY';
    /** 정책 층 */
    scope?: 'global' | 'organization';
    /** 일치한 규칙(DENIED) */
    rule?: unknown;
    /** 검사한 원본(정규화) */
    source: string;
}

const REASON_TEXT: Record<ExtensionSourceBlockDetail['reason'], string> = {
    DENIED: '차단 규칙에 걸린 원본입니다',
    NOT_ALLOWED: '허용 목록에 없는 원본입니다',
    POLICY_INVALID: '원본 정책 값이 올바르지 않아 모든 원본을 막았습니다',
    POLICY_UNAVAILABLE: '원본 정책을 확인하지 못해 막았습니다',
    CATALOG_ONLY: '등록된 카탈로그 원본만 설치할 수 있습니다',
};

export class ExtensionSourceBlockedError extends AppError {
    constructor(public readonly detail: ExtensionSourceBlockDetail) {
        const rule = detail.rule !== undefined ? `, 규칙 ${JSON.stringify(detail.rule)}` : '';
        const scope = detail.scope ? `, ${detail.scope === 'global' ? '전역' : '조직'} 정책` : '';
        super(`${EXTENSION_SOURCE_BLOCKED_CODE}: ${REASON_TEXT[detail.reason]} (원본 ${detail.source}${scope}${rule})`, 403, true, EXTENSION_SOURCE_BLOCKED_CODE);
        this.name = 'ExtensionSourceBlockedError';
    }
}
