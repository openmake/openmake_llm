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

/**
 * 로그인 요청 스키마
 * @property {string} email - 이메일 주소 (유효한 이메일 형식, 필수)
 * @property {string} password - 비밀번호 (1자 이상, 필수)
 */
export const loginSchema = z.object({
    email: z.string().email('유효한 이메일 주소를 입력하세요'),
    password: z.string().min(1, '비밀번호를 입력하세요')
});

/**
 * 회원가입 요청 스키마
 * @property {string} username - 사용자명 (3~50자, 필수)
 * @property {string} email - 이메일 주소 (유효한 이메일 형식, 필수)
 * @property {string} password - 비밀번호 (8자 이상, 필수)
 * @property {string} [role] - 사용자 역할 (admin/user/guest, 기본값: user)
 */
export const registerSchema = z.object({
    username: z.string().min(3, '사용자명은 3자 이상이어야 합니다').max(50),
    email: z.string().email('유효한 이메일 주소를 입력하세요'),
    password: z.string().min(8, '새 비밀번호는 8자 이상이어야 합니다'),
    role: z.enum(['admin', 'user', 'guest']).optional().default('user')
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

/** 로그인 요청 TypeScript 타입 */
export type LoginInput = z.infer<typeof loginSchema>;
/** 회원가입 요청 TypeScript 타입 */
export type RegisterInput = z.infer<typeof registerSchema>;
/** 비밀번호 변경 요청 TypeScript 타입 */
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
