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
 *   - ConsentController.POST / — 재동의 INSERT
 *
 * ⚠️ 정책 Markdown 서빙은 폐기됨 — 정책 본문 .md 파일(구 `frontend/web/public/policies/`)과
 * 이를 서빙하던 `policies.routes.ts` 는 제거됐다(파일: 6d99860 모노레포 재편 / 라우트: 15becc4 deadcode 정리).
 * 현재 앱에는 정책 본문을 표시하는 UI 가 없고, 이 상수만 consent_logs 의 동의 version SoT 로 남는다.
 * 정책 변경 시: 본 상수 bump → PM2 reload (기존 사용자 다음 로그인 시 재동의 prompt 자동 표시).
 *
 * @module config/policy
 */

/**
 * 현재 운영 중인 Privacy Policy + Terms of Service 의 동의 version (consent_logs SoT).
 */
export const CURRENT_POLICY_VERSION = '1.0';
