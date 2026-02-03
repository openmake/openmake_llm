/**
 * Authentication Zod Schemas
 */
import { z } from 'zod';

export const loginSchema = z.object({
    email: z.string().email('유효한 이메일 주소를 입력하세요'),
    password: z.string().min(1, '비밀번호를 입력하세요')
});

export const registerSchema = z.object({
    username: z.string().min(3, '사용자명은 3자 이상이어야 합니다').max(50),
    email: z.string().email('유효한 이메일 주소를 입력하세요'),
    password: z.string().min(8, '새 비밀번호는 8자 이상이어야 합니다'),
    role: z.enum(['admin', 'user', 'guest']).optional().default('user')
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요'),
    newPassword: z.string().min(8, '새 비밀번호는 8자 이상이어야 합니다')
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
