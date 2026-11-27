/**
 * 확장 행의 공개 응답 모양과 요청자 조직 조회 — Base 확장 라우트와 확장 공유 포트(`runtime-ports/extension-sharing`)가 함께 쓴다.
 *
 * @module services/extensions/public-view
 */
import type { UserExtensionRow } from '../../data/repositories/user-extension-repository';
import { membershipsFor } from '../org/membership-cache';

/**
 * 응답에서 내부 필드(source_hash, user_id, 승인자 id) 제외. 조직 소유(212) 열은 싣지 않고 — 사람 소유 행의 응답 모양은
 * 마이그레이션 전과 같다 — 조직 소유 행만 `orgOwned: true` 를 붙인다(설치자 id 는 싣지 않는다).
 */
export function toPublicExtension(row: UserExtensionRow) {
    const { source_hash: _hash, user_id: _uid, permissions_reviewed_by: _reviewer, ...rest } = row as UserExtensionRow & { owner_org_id?: string | null; installed_by_user_id?: string | null };
    const { owner_org_id: ownerOrg, installed_by_user_id: _installer, ...base } = rest;
    return ownerOrg ? { ...base, orgOwned: true } : base;
}

/** 요청자가 멤버인 조직 id — 조직에 공개된 확장의 갤러리 노출·설치 판정에 쓴다 (조회 실패는 빈 목록 = 조직 공개분만 안 보인다) */
export async function memberOrgIds(userId: string): Promise<string[]> {
    try {
        return (await membershipsFor(userId)).map((m) => m.orgId);
    } catch {
        return [];
    }
}

/** 인증 미들웨어가 채운 요청 사용자 id (`userId` 우선, 없으면 `id`) — HTTP 를 모르게 `req.user` 모양만 본다 */
export function requestUserId(req: { user?: unknown }): string | null {
    const user = req.user;
    if (!user || typeof user !== 'object') return null;
    if ('userId' in user && typeof (user as { userId?: unknown }).userId === 'string') {
        return (user as { userId: string }).userId;
    }
    if ('id' in user) return String((user as { id: unknown }).id);
    return null;
}
