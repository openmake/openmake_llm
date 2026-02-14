/**
 * ============================================================
 * Auth Service
 * ============================================================
 * 인증 관련 비즈니스 로직
 */

import crypto from 'node:crypto';
import { getUserManager, PublicUser } from '../data/user-manager';
import { generateToken } from '../auth';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config/env';

const log = createLogger('AuthService');

export interface RegisterRequest {
    email: string;
    password: string;
    role?: 'admin' | 'user' | 'guest';
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface ChangePasswordRequest {
    userId: string;
    currentEmail: string;
    currentPassword: string;
    newPassword: string;
}

export interface AuthResult {
    success: boolean;
    error?: string;
    user?: PublicUser;
    token?: string;
}

/**
 * Validate password complexity requirements
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter  
 * - At least one number
 * - At least one special character
 */
function validatePasswordComplexity(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
        errors.push('비밀번호는 8자 이상이어야 합니다');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('대문자를 1개 이상 포함해야 합니다');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('소문자를 1개 이상 포함해야 합니다');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('숫자를 1개 이상 포함해야 합니다');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('특수문자를 1개 이상 포함해야 합니다');
    }
    
    return { valid: errors.length === 0, errors };
}

export class AuthService {
    private userManager = getUserManager();

    /**
     * 회원가입
     */
    async register(data: RegisterRequest): Promise<AuthResult> {
        const { email, password, role } = data;

        // 유효성 검사
        if (!email || !password) {
            return { success: false, error: '이메일과 비밀번호를 입력하세요' };
        }

        const passwordValidation = validatePasswordComplexity(password);
        if (!passwordValidation.valid) {
            return { success: false, error: passwordValidation.errors.join(', ') };
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { success: false, error: '유효한 이메일 주소를 입력하세요' };
        }

        const user = await this.userManager.createUser({ email, password, role });

        if (!user) {
            return { success: false, error: '이미 등록된 이메일입니다' };
        }

        log.info(`회원가입 완료: ${email}`);
        return { success: true, user };
    }

    /**
     * 로그인
     */
    async login(data: LoginRequest): Promise<AuthResult> {
        const { email, password } = data;

        if (!email || !password) {
            return { success: false, error: '이메일과 비밀번호를 입력하세요' };
        }

        const user = await this.userManager.authenticate(email, password);

        if (!user) {
            return { success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다' };
        }

        const token = generateToken(user);
        log.info(`로그인 성공: ${email}`);

        return { success: true, token, user };
    }

    /**
     * 비밀번호 변경
     */
    async changePassword(data: ChangePasswordRequest): Promise<AuthResult> {
        const { userId, currentEmail, currentPassword, newPassword } = data;

        if (!currentPassword || !newPassword) {
            return { success: false, error: '현재 비밀번호와 새 비밀번호를 입력하세요' };
        }

        const passwordValidation = validatePasswordComplexity(newPassword);
        if (!passwordValidation.valid) {
            return { success: false, error: passwordValidation.errors.join(', ') };
        }

        // 현재 비밀번호 확인
        const user = await this.userManager.authenticate(currentEmail, currentPassword);
        if (!user) {
            return { success: false, error: '현재 비밀번호가 올바르지 않습니다' };
        }

        const success = await this.userManager.changePassword(userId, newPassword);
        return { success };
    }

    /**
     * OAuth 사용자 생성 또는 반환
     */
    async findOrCreateOAuthUser(email: string, provider: 'google' | 'github'): Promise<AuthResult> {
        let user = await this.userManager.getUserByEmail(email);
        let publicUser = user ? await this.userManager.getUserById(user.id) : null;

        if (!publicUser) {
            // OAuth 사용자는 암호학적으로 안전한 랜덤 비밀번호로 생성
            const randomPassword = crypto.randomBytes(32).toString('base64url');

            // 관리자 이메일 목록 확인
            const adminEmails = getConfig().adminEmails
                .split(',')
                .map(e => e.toLowerCase().trim())
                .filter(e => e);
            const role = adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';

            publicUser = await this.userManager.createUser({
                email,
                password: randomPassword,
                role
            });

            if (!publicUser) {
                return { success: false, error: '사용자 생성 실패' };
            }

            log.info(`[OAuth] ${provider} 신규 사용자 생성: ${email}`);
        } else {
            // 기존 계정 관리자 승격 체크
            const adminEmails = getConfig().adminEmails
                .split(',')
                .map(e => e.toLowerCase().trim())
                .filter(e => e);

            if (adminEmails.includes(email.toLowerCase()) && publicUser.role !== 'admin') {
                await this.userManager.changeRole(publicUser.id, 'admin');
                publicUser.role = 'admin';
            }
        }

        const token = generateToken(publicUser);
        log.info(`[OAuth] ${provider} 로그인 성공: ${email}`);

        return { success: true, token, user: publicUser };
    }

    /**
     * 사용 가능한 OAuth 프로바이더 목록
     */
    getAvailableProviders(): string[] {
        const providers: string[] = [];

        const config = getConfig();
        if (config.googleClientId && config.googleClientSecret) {
            providers.push('google');
        }
        if (config.githubClientId && config.githubClientSecret) {
            providers.push('github');
        }

        return providers;
    }
}

// 싱글톤 인스턴스
let authService: AuthService | null = null;

export function getAuthService(): AuthService {
    if (!authService) {
        authService = new AuthService();
    }
    return authService;
}
