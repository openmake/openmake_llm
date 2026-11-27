/**
 * extension-marketplace 가 Base 레지스트리에 기여하는 선언 — 운영 설정 키·감사 action.
 * 순수 데이터다(다른 앱 모듈을 import 하지 않는다 — 설정·감사 레지스트리가 부팅 초기에 읽는다).
 *
 * @module addons/extension-marketplace/contributions
 */
import type { AddonContribution } from '../../addon-host/contributions';

/** 레지스트리 항목 큐레이션(승인·숨김·보류) — audit_logs 에 쌓이는 값이라 이름을 바꾸지 않는다 */
export const REGISTRY_CURATED_AUDIT_ACTION = 'extension_marketplace.registry_curated';
/** 레지스트리 항목을 MCP 카탈로그 초안으로 올림 */
export const REGISTRY_PROMOTED_AUDIT_ACTION = 'extension_marketplace.registry_promoted';

declare module '../../config/audit-actions' {
    interface AddonAuditActions {
        [REGISTRY_CURATED_AUDIT_ACTION]: null;
        [REGISTRY_PROMOTED_AUDIT_ACTION]: null;
    }
}

export const extensionMarketplaceContributions: AddonContribution = {
    settings: [
        // M7 MCP Registry 동기화(기본 OFF) — 켜면 공식 레지스트리를 주기적으로 증분 수신한다. 꺼져 있으면 외부 요청 0.
        { key: 'EXT_MARKET_MCP_REGISTRY_SYNC', group: 'agent', secret: false, requiresRestart: false, validate: 'boolean' },
    ],
    auditActions: { [REGISTRY_CURATED_AUDIT_ACTION]: null, [REGISTRY_PROMOTED_AUDIT_ACTION]: null },
};
