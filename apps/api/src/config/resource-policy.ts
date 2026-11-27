/**
 * 리소스 접근 정책표 (F22 Phase A-2, 2026-09-17) — "리소스 종류 × 행위 → 허용 주체" 룩업 맵.
 *
 * 판정 로직은 security/authorize.ts 한 곳이고, 이 파일은 규칙(L2)만 둔다. 주체(Subject)는
 * 요청자와 리소스의 관계로 도출된다:
 *   admin       시스템 관리자(UserRole 'admin')
 *   owner       리소스 소유자(user_id)
 *   org_owner / org_admin / org_member  리소스가 조직에 공유(org_id)돼 있고 요청자의 활성 조직이 같을 때의 조직 역할
 *   shared      인스턴스 전체 공유(visibility 'shared', 080) — 읽기 전용
 *
 * 종류별 예외가 필요하면 RESOURCE_POLICY 에 그 종류를 추가한다(없는 종류는 DEFAULT).
 * ⚠️ 표를 바꾸면 security/__tests__/authorize.test.ts 판정 매트릭스가 먼저 깨진다.
 *
 * @module config/resource-policy
 */
export type ResourceKind =
    | 'generic'
    | 'user_agent'
    | 'skill'
    | 'mcp_server'
    | 'agent_task_template'
    | 'artifact'
    | 'agent_task'
    | 'org_extension'
    | 'org_extension_deployment';

export type ResourceAction = 'read' | 'write' | 'delete';

export type AccessSubject = 'admin' | 'owner' | 'org_owner' | 'org_admin' | 'org_member' | 'shared';

export type ActionPolicy = Record<ResourceAction, readonly AccessSubject[]>;

const DEFAULT_POLICY: ActionPolicy = {
    read: ['admin', 'owner', 'org_owner', 'org_admin', 'org_member', 'shared'],
    write: ['admin', 'owner', 'org_owner', 'org_admin'],
    delete: ['admin', 'owner', 'org_owner'],
};

/** 조직 공유 개념이 없는 개인 자원(에이전트 작업) — 소유자·관리자만. */
const PRIVATE_POLICY: ActionPolicy = {
    read: ['admin', 'owner'],
    write: ['admin', 'owner'],
    delete: ['admin', 'owner'],
};

/**
 * 조직 소유 확장(212, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED) — 소유자가 사람이 아니라 조직(ownerId 없음).
 * 설치(=그 조직에 대한 write)·수정·업데이트·제거는 그 조직의 관리자(owner·admin) 누구나, 멤버는 읽기만.
 * 설치한 사람의 개인 권한은 없다(owner 주체가 생기지 않는다 — 조직을 떠나면 권한도 없다).
 */
const ORG_OWNED_POLICY: ActionPolicy = {
    read: ['admin', 'org_owner', 'org_admin', 'org_member'],
    write: ['admin', 'org_owner', 'org_admin'],
    delete: ['admin', 'org_owner', 'org_admin'],
};

/**
 * 조직 관리 자원(확장 배포 모드·그룹, §8-1) — 소유자 축이 없고(ownerId null) 조직 owner/admin·시스템 admin 만 읽고 바꾼다.
 * 일반 멤버는 자기에게 적용된 결과만 갤러리·설치 목록에서 본다(이 정책의 read 가 아니다).
 */
const ORG_ADMIN_POLICY: ActionPolicy = {
    read: ['admin', 'org_owner', 'org_admin'],
    write: ['admin', 'org_owner', 'org_admin'],
    delete: ['admin', 'org_owner', 'org_admin'],
};

export const RESOURCE_POLICY: Partial<Record<ResourceKind, ActionPolicy>> = {
    generic: PRIVATE_POLICY,
    agent_task: PRIVATE_POLICY,
    org_extension: ORG_OWNED_POLICY,
    org_extension_deployment: ORG_ADMIN_POLICY,
};

/** 종류별 정책 — 미등록 종류는 DEFAULT_POLICY. */
export function policyFor(kind: ResourceKind): ActionPolicy {
    return RESOURCE_POLICY[kind] ?? DEFAULT_POLICY;
}
