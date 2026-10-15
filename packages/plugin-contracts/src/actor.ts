/**
 * 행위자(actor) — 포트가 "누구의 것을" 돌려줄지 정하는 주체.
 *
 * user  : 로그인 사용자. 대화 세션·개인 자원의 소유자다.
 * org   : 조직 단위 작업(조직 공용 자원). 사용자 세션을 소유하지 않는다.
 * system: 사용자 없이 도는 정리·색인 같은 시스템 작업. `reason` 은 감사·로그용 사유다.
 * 포트는 actor 종류에 맞지 않는 요청에 빈 결과를 돌려준다(deny by default).
 *
 * @module plugin-contracts/actor
 */
export const ACTOR_KINDS = ['user', 'org', 'system'] as const;
export type ActorKind = typeof ACTOR_KINDS[number];

export interface UserActor {
    kind: 'user';
    userId: string;
    /** 활성 조직(없으면 null 또는 생략) */
    orgId?: string | null;
}

export interface OrgActor {
    kind: 'org';
    orgId: string;
}

export interface SystemActor {
    kind: 'system';
    /** 감사·로그용 사유(예: 'knowledge.cleanup') */
    reason: string;
}

export type Actor = UserActor | OrgActor | SystemActor;
