/**
 * ============================================================
 * Audit Actions - 감사 action 레지스트리 (단일 출처)
 * ============================================================
 *
 * 서버가 audit_logs.action 에 기록하는 문자열 전부와, 그 action 이 알림(AlertSystem)을
 * 내보낼 때의 심각도를 한곳에 모은다.
 *
 * - 새 action 은 여기 등록해야 logAudit 에 넘길 수 있다(AuditAction union — 오타·미등록은 tsc 가 잡는다).
 * - **기존 문자열은 이름을 바꾸지 않는다.** DB 에 쌓인 기록과 감사 화면의 action 필터가 이 값에 의존한다.
 * - 심각도 null = 감사 기록만 남기고 알림은 보내지 않는다.
 *   'info' 는 console 만, 'warning' 이상은 webhook 등 전체 채널(AuditService.sendAlertForAction).
 *
 * @module config/audit-actions
 */

export type AuditSeverity = 'info' | 'warning' | 'critical';

export const AUDIT_ACTION_SEVERITY = {
    // ── 사용자·계정 ──
    // GDPR Article 17 (right to erasure) — admin 의 사용자 삭제
    'user.deleted': 'critical',
    // 권한 변화 — admin 승격/박탈
    'user.role_changed': 'critical',
    'user.register': 'info',
    // GDPR Phase D — 14세 미만 가입 대기 (operator 의 guardian verify 필요)
    'minor_pending_registered': 'warning',
    // 보안 변화
    'password.changed': 'warning',
    'login.failed': 'info',
    'auth.mobile_exchange': null,
    'auth.mobile_exchange_failed': null,
    // 첫 실행 셋업 마법사 완료 (routes/first-run-setup) — 첫 관리자 생성은 보안 이벤트
    'setup.completed': 'warning',

    // ── GDPR ──
    // Article 7(3) — 동의 철회
    'consent.withdrawn': 'warning',
    'consent.granted': 'info',
    // Article 20 — 데이터 export 요청 (operator 인지용)
    'export.requested': 'warning',

    // ── API 키 ── ApiKeyService.audit() 가 emit 하는 문자열 (api_key.<create|update|delete|rotate>).
    // 키 삭제·회전은 보안 이벤트라 warning 채널(webhook 알림), 생성·수정은 audit 만.
    'api_key.create': 'info',
    'api_key.update': 'info',
    'api_key.delete': 'warning',
    'api_key.rotate': 'warning',

    // ── 운영 설정 ──
    // 조직 정책 변경(129) — 외부 모델 차단·승인 하한·MCP 허용 목록
    'org.policy_changed': 'warning',
    // 운영 구성 내보내기/가져오기 (F22 Phase E)
    'config.exported': 'warning',
    'config.imported': 'critical',
    // admin 시스템 설정 변경 (routes/admin-system-settings) — 운영 설정 변조 감지용
    'system_settings.updated': 'warning',
    'system_settings.reset': 'warning',
    // 쿼터 초과 승인·수동 부여 (F25 PR-3b)
    'quota.overage_decided': 'warning',
    'quota.grant_manual': 'warning',
    'cost_rate.changed': null,
    'addon.state_changed': null,
    'alert.acknowledged': null,
    'tool_circuit_reset': null,

    // ── 모델 배정 ──
    'user_model_assignment_set': null,
    'user_model_assignment_unset': null,
    'user_model_role_set': null,
    'user_model_role_unset': null,
    'user_capability_model_set': null,
    'user_capability_model_unset': null,
    'admin_global_model_assignment_set': null,
    'admin_global_model_assignment_unset': null,
    'admin_global_model_role_set': null,
    'admin_global_model_role_unset': null,
    'admin_global_capability_model_set': null,
    'admin_global_capability_model_unset': null,
    'admin_server_external_key_set': null,
    'admin_server_external_key_delete': null,
    'model_role_fallback': null,

    // ── 채팅·도구 ──
    // context_overflow 는 사용자 입력 검증 에러(>262K) — 2026-06-15 1M 제거로 흔해져
    // webhook noise 방지 위해 warning→info 강등 (audit 추적 + console 만 유지)
    'chat.context_overflow': 'info',
    'create_plan': null,
    'code_review': null,
    'security_review': null,
    'mcp_tool_call': null,

    // ── 메모리 ──
    'memory.created': null,
    'memory.deleted': null,
    'memory.deleted_all': null,
    'memory.auto_created': null,
    'memory.backfilled': null,
    'memory.agent_task_created': null,

    // ── 에이전트 작업 ──
    'agent_task_local_create': null,
    'agent_task_browser_takeover': null,
    'agent_task_browser_release': null,
    'agent_task.internal_only_enforced': null,
    'agent_task.retention_purged': null,
    'agent_suggestion_status': null,

    // ── 아티팩트·마켓플레이스 ──
    'artifact_comment': null,
    'artifact_execute': null,
    'artifact_export': null,
    'artifact_publish': null,
    'artifact_unpublish': null,
    'marketplace.publish': null,

    // ── 로컬 브리지 ──
    'local_bridge.device_disconnect': null,
    'local_bridge.browser_policy_block': null,

    // ── 애드온(MCP·Discord) — 문자열만 등록, Base 가 addons 를 import 하지는 않는다 ──
    'mcp_catalog.oauth_client_changed': null,
    'mcp_server_env_update': null,
    'mcp_server_rename': null,
    'discord_runtime_config_fetch': null,
} as const satisfies Record<string, AuditSeverity | null>;

/** 서버가 기록할 수 있는 감사 action. */
export type AuditAction = keyof typeof AUDIT_ACTION_SEVERITY;

/** 등록된 action 전체 (정렬). 감사 화면 action 필터 목록의 바탕. */
export const AUDIT_ACTIONS: readonly AuditAction[] = (Object.keys(AUDIT_ACTION_SEVERITY) as AuditAction[]).sort();

/**
 * 알림 대상 whitelist — audit_logs INSERT 시 자동 AlertSystem 호출 대상.
 * 레지스트리에서 심각도가 있는 action 만 뽑은 것.
 */
export const CRITICAL_ACTIONS: Readonly<Partial<Record<AuditAction, AuditSeverity>>> = Object.fromEntries(
    Object.entries(AUDIT_ACTION_SEVERITY).filter(([, severity]) => severity !== null),
);

export function isAuditAction(value: unknown): value is AuditAction {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUDIT_ACTION_SEVERITY, value);
}
