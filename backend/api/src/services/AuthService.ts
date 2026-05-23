/**
 * ============================================================
 * Auth Service
 * ============================================================
 * 인증 관련 비즈니스 로직
 */

import crypto from 'node:crypto';
import { getUserManager, PublicUser, USER_ROLES } from '../data/user-manager';
import { generateToken } from '../auth';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config/env';
import { PASSWORD_POLICY } from '../config/runtime-limits';
import { getPool } from '../data/models/unified-database';

const log = createLogger('AuthService');

/**
 * 현재 정책 버전 — 정책 markdown frontmatter 와 동기 유지.
 * 신규 정책 publish 시 bump (Phase B 의 재동의 prompt 와 연동 예정).
 */
const CURRENT_POLICY_VERSION = '1.0';

/**
 * GDPR Phase A Fix 4 helper — 회원가입 시 privacy_policy + terms_of_service
 * 동의 이력 2 row INSERT (consent_logs).
 */
async function recordConsents(
    userId: string,
    locale: string,
    ip?: string,
    userAgent?: string,
): Promise<void> {
    const pool = getPool();
    await pool.query(
        `INSERT INTO consent_logs (user_id, consent_type, consent_version, consent_locale, granted, ip_address, user_agent)
         VALUES ($1, 'privacy_policy', $2, $3, TRUE, $4, $5),
                ($1, 'terms_of_service', $2, $3, TRUE, $4, $5)`,
        [userId, CURRENT_POLICY_VERSION, locale, ip || null, userAgent || null],
    );
}

export interface RegisterRequest {
    username?: string;
    email: string;
    password: string;
    role?: 'admin' | 'user' | 'guest';
    // GDPR Phase A Fix 4 — controller 가 zod schema 검증 후 전달
    agreedToTerms?: boolean;
    agreedToPrivacy?: boolean;
    consentLocale?: string;
    // controller 가 req.ip / req.headers['user-agent'] 캡처 후 전달 (consent_logs 저장)
    consentIp?: string;
    consentUserAgent?: string;
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

    if (password.length < PASSWORD_POLICY.MIN_LENGTH) {
        errors.push(`비밀번호는 ${PASSWORD_POLICY.MIN_LENGTH}자 이상이어야 합니다`);
    }
    if (!PASSWORD_POLICY.UPPERCASE.test(password)) {
        errors.push('대문자를 1개 이상 포함해야 합니다');
    }
    if (!PASSWORD_POLICY.LOWERCASE.test(password)) {
        errors.push('소문자를 1개 이상 포함해야 합니다');
    }
    if (!PASSWORD_POLICY.DIGIT.test(password)) {
        errors.push('숫자를 1개 이상 포함해야 합니다');
    }
    if (!PASSWORD_POLICY.SPECIAL.test(password)) {
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
        const { username, email, password, role } = data;

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

        const user = await this.userManager.createUser({ username, email, password, role });

        if (!user) {
            return { success: false, error: '이미 등록된 이메일입니다' };
        }

        // GDPR Phase A Fix 4 — consent_logs INSERT.
        // controller 가 zod schema (agreedToTerms/agreedToPrivacy literal(true)) 검증 후 호출하므로
        // 본 service 진입 시점에 두 값은 true 보장. defensive 로 확인 후 INSERT.
        if (data.agreedToTerms && data.agreedToPrivacy) {
            try {
                await recordConsents(
                    user.id,
                    data.consentLocale || 'ko',
                    data.consentIp,
                    data.consentUserAgent,
                );
            } catch (consentErr) {
                // consent 기록 실패는 회원가입 자체를 막지 않음 (사용자 영향 최소화).
                // 단 audit/모니터링 위해 error 로깅 — 운영자가 인지하면 후속 보정 가능.
                log.error(`[GDPR] consent_logs INSERT 실패 (user_id=${user.id}):`, consentErr);
            }
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
        const user = await this.userManager.getUserByEmail(email);
        let publicUser = user ? await this.userManager.getUserById(user.id) : null;

        if (!publicUser) {
            // OAuth 사용자는 암호학적으로 안전한 랜덤 비밀번호로 생성
            const randomPassword = crypto.randomBytes(32).toString('base64url');

            // 관리자 이메일 목록 확인
            const adminEmails = getConfig().adminEmails
                .split(',')
                .map(e => e.toLowerCase().trim())
                .filter(e => e);
            const role = adminEmails.includes(email.toLowerCase()) ? USER_ROLES.ADMIN : USER_ROLES.USER;

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

            if (adminEmails.includes(email.toLowerCase()) && publicUser.role !== USER_ROLES.ADMIN) {
                await this.userManager.changeRole(publicUser.id, USER_ROLES.ADMIN);
                publicUser.role = USER_ROLES.ADMIN;
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
