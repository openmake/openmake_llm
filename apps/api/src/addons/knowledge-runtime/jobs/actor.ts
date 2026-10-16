/**
 * 작업 접수 주체(actor) — 큐 행의 actor_kind·actor_user_id·org_id 로 들어간다(설계 §5 C4).
 * 개인 Space 작업은 user, 조직 Space 작업은 org(조직 id 포함), 관리자 재색인·재청킹은 그 관리자의 user,
 * 정리(cleanup)·평가는 system(요청자는 기록용으로만 — 사용권을 보지 않는다).
 *
 * @module addons/knowledge-runtime/jobs/actor
 */
import type { KnowledgeScopeType } from '@openmake/shared-types';
import type { JobActorKind } from './job-schema';

export interface JobActor {
    kind: JobActorKind;
    /** 접수한 사용자 — system 이면 요청자(없으면 null) */
    userId: string | null;
    /** 조직 Space 작업의 조직 id — 그 밖에는 null */
    orgId: string | null;
}

/** Space scope 종류 → actor — scope 종류로 분기하지 않고 표로 고른다 */
const SCOPE_ACTOR: Readonly<Record<KnowledgeScopeType, (userId: string, scopeId: string) => JobActor>> = {
    user: (userId) => ({ kind: 'user', userId, orgId: null }),
    organization: (userId, scopeId) => ({ kind: 'org', userId, orgId: scopeId }),
};

/** Space 에 대한 사용자 작업(업로드·재시도) */
export function spaceJobActor(userId: string, space: { scope_type: KnowledgeScopeType; scope_id: string }): JobActor {
    return SCOPE_ACTOR[space.scope_type](userId, space.scope_id);
}

/** Space 와 무관한 사용자 작업(관리자 재색인·재청킹) */
export function userJobActor(userId: string): JobActor {
    return { kind: 'user', userId, orgId: null };
}

/** 시스템 작업 — claim 때 사용권을 보지 않는다. requestedBy 는 추적용 기록 */
export function systemJobActor(requestedBy: string | null): JobActor {
    return { kind: 'system', userId: requestedBy, orgId: null };
}
