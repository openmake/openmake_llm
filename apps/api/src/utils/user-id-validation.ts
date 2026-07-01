/**
 * ============================================================
 * User ID Validation — sentinel 판별 헬퍼
 * ============================================================
 *
 * 코드 전반에서 인증 사용자 ID와 guest/anonymous 같은 sentinel이 섞일 수 있습니다.
 * DB 저장 경로마다 이를 인라인 검사하면 누락 시 users(id) FK 위반이 발생합니다.
 *
 * 이 헬퍼는 sentinel 정의를 한 곳에 모으고 TypeScript type guard 로
 * 호출처에서 narrowing 가능하게 합니다.
 *
 * @module utils/user-id-validation
 */

/**
 * users 테이블에 실제로 존재하는 user_id 인지 type-guard 로 판별.
 *
 * `true` 반환 시 호출처에서 `userId` 가 `string` 으로 narrowing — DB FK 안전.
 *
 * sentinel 패턴 (DB 저장 금지):
 *   - `undefined` / `null` / 빈 문자열 — 인증 정보 없음
 *   - `'guest'` — request-handler 의 비인증 fallback
 *   - `'anonymous'` — 일부 감사 로그 경로의 fallback
 *   - `'anon-*'` prefix — frontend 가 생성하는 익명 세션 ID
 *
 * @param userId 검증 대상 user id (옵셔널)
 * @returns DB 저장 가능한 인증 사용자 ID 인지 여부
 */
export function isPersistableUserId(userId: string | null | undefined): userId is string {
    if (!userId) return false;
    if (userId === 'guest' || userId === 'anonymous') return false;
    if (userId.startsWith('anon-')) return false;
    return true;
}
