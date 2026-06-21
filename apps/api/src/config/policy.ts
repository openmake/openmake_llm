/**
 * ============================================================
 * Policy version SSoT — GDPR Phase B follow-up
 * ============================================================
 *
 * Privacy Policy / Terms of Service 의 현재 운영 버전.
 *
 * 사용처:
 *   - AuthService.recordConsents() — 회원가입 시 consent_logs INSERT
 *   - ConsentController.GET /status — 사용자 latest 동의 version vs 현재 비교
 *   - ConsentController.POST / — 재동의 INSERT (frontend 가 정책 file frontmatter
 *     version 을 직접 보내지만, server 검증 또는 default 로 사용 가능)
 *
 * Markdown 파일의 frontmatter `version: "1.0"` 과 **동기 유지 필수**.
 * 신규 정책 publish 시:
 *   1. `apps/legacy-web/public/policies/{type}.{locale}.md` frontmatter version bump
 *   2. 본 상수 bump
 *   3. PM2 reload — 기존 사용자가 다음 로그인 시 재동의 prompt 자동 표시 (Phase B Fix 7)
 *
 * @module config/policy
 */

/**
 * 현재 운영 중인 Privacy Policy + Terms of Service 의 버전.
 * Markdown frontmatter 와 동기 유지 (`apps/legacy-web/public/policies/*.md`).
 */
export const CURRENT_POLICY_VERSION = '1.0';
