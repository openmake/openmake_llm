/**
 * ============================================================
 * Auth Schema - 인증 요청 Zod 검증 스키마
 * ============================================================
 *
 * 로그인, 회원가입, 비밀번호 변경 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/auth.schema
 */
import { z } from 'zod';
import { secureTextSchema } from './security.schema';

/**
 * 로그인 요청 스키마
 * @property {string} email - 이메일 주소 (유효한 이메일 형식, 필수)
 * @property {string} password - 비밀번호 (1자 이상, 필수)
 */
export const loginSchema = z.object({
    email: z.string().trim().email('유효한 이메일 주소를 입력하세요'),
    password: z.string().min(1, '비밀번호를 입력하세요')
});

/**
 * 회원가입 요청 스키마
 * @property {string} username - 사용자명 (3~50자, 필수)
 * @property {string} email - 이메일 주소 (유효한 이메일 형식, 필수)
 * @property {string} password - 비밀번호 (8자 이상, 필수)
 * (role 은 클라이언트가 지정 불가 — 서버가 ADMIN_EMAILS allowlist 로만 결정)
 */
export const registerSchema = z.object({
    username: secureTextSchema({ minLength: 3, maxLength: 50, fieldName: '사용자명', allowNewLines: false }),
    email: z.string().trim().email('유효한 이메일 주소를 입력하세요'),
    password: z.string().min(8, '새 비밀번호는 8자 이상이어야 합니다'),
    // 보안: role 은 클라이언트가 지정할 수 없다 (권한 상승 방지). 서버가 ADMIN_EMAILS allowlist 로만 결정.
    // GDPR Phase A Fix 4 — Article 7 affirmative consent. literal(true) 강제 — false/누락 시 validation fail.
    agreedToTerms: z.literal(true, { message: '이용약관에 동의해야 합니다' }),
    agreedToPrivacy: z.literal(true, { message: '개인정보 처리방침에 동의해야 합니다' }),
    // 동의 시점의 사용자 locale (consent_logs 저장용). 미지정 시 'ko' 폴백.
    consentLocale: z.string().min(2).max(10).optional().default('ko'),
    // GDPR Phase D — 14세 미만 셀프 동의 흐름. 필수.
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '생년월일은 YYYY-MM-DD 형식이어야 합니다'),
    // 14세 미만 시 server-side enforce — locale 별 임계값 미달 시 필수.
    guardianEmail: z.string().email().optional(),
});

/**
 * 비밀번호 변경 요청 스키마
 * @property {string} currentPassword - 현재 비밀번호 (1자 이상, 필수)
 * @property {string} newPassword - 새 비밀번호 (8자 이상, 필수)
 */
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요'),
    newPassword: z.string().min(8, '새 비밀번호는 8자 이상이어야 합니다')
});

/**
 * 등급 변경 요청 스키마
 * @property {string} tier - 변경할 등급 (free/pro/enterprise)
 */
export const tierChangeSchema = z.object({
    tier: z.enum(['free', 'pro', 'enterprise'], '유효한 등급을 선택하세요 (free, pro, enterprise)')
});

/** 로그인 요청 TypeScript 타입 */
export type LoginInput = z.infer<typeof loginSchema>;
/** 회원가입 요청 TypeScript 타입 */
export type RegisterInput = z.infer<typeof registerSchema>;
/** 비밀번호 변경 요청 TypeScript 타입 */
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** 등급 변경 요청 TypeScript 타입 */
export type TierChangeInput = z.infer<typeof tierChangeSchema>;