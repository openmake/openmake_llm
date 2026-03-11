/**
 * AuthService 단위 테스트
 *
 * 테스트 범위:
 * - register: 유효성 검사, 이메일 형식, 비밀번호 복잡도, 중복 이메일, 성공
 * - login: 빈 필드 검증, 인증 실패, 성공 (토큰 반환)
 * - changePassword: 빈 필드, 새 비밀번호 복잡도, 현재 비밀번호 틀림, 성공
 * - findOrCreateOAuthUser: 신규 생성, 기존 조회, 어드민 승격, 생성 실패
 * - getAvailableProviders: 설정 기반 프로바이더 목록
 * - getAuthService: 싱글톤 반환
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockCreateUser = jest.fn();
const mockAuthenticate = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockGetUserById = jest.fn();
const mockChangePassword = jest.fn();
const mockChangeRole = jest.fn();
const mockGenerateToken = jest.fn();

jest.mock('../data/user-manager', () => ({
    getUserManager: jest.fn().mockReturnValue({
        createUser: jest.fn(),
        authenticate: jest.fn(),
        getUserByEmail: jest.fn(),
        getUserById: jest.fn(),
        changePassword: jest.fn(),
        changeRole: jest.fn(),
    }),
}));

jest.mock('../auth', () => ({
    generateToken: jest.fn().mockReturnValue('jwt-token-abc'),
}));

jest.mock('../config/env', () => ({
    getConfig: jest.fn().mockReturnValue({
        adminEmails: 'admin@example.com',
        googleClientId: '',
        googleClientSecret: '',
        githubClientId: '',
        githubClientSecret: '',
    }),
}));

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { AuthService, getAuthService } from '../auth/AuthService';
import { getUserManager } from '../data/user-manager';
import { generateToken } from '../auth';
import { getConfig } from '../config/env';
import type { PublicUser } from '../data/user-manager';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makePublicUser(overrides: Partial<PublicUser> = {}): PublicUser {
    return {
        id: 'user-001',
        email: 'user@example.com',
        role: 'user',
        created_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    } as PublicUser;
}

const VALID_PASSWORD = 'Secure@123';

// ─────────────────────────────────────────────
// beforeEach
// ─────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();

    (getUserManager as jest.Mock).mockReturnValue({
        createUser: mockCreateUser,
        authenticate: mockAuthenticate,
        getUserByEmail: mockGetUserByEmail,
        getUserById: mockGetUserById,
        changePassword: mockChangePassword,
        changeRole: mockChangeRole,
    });

    (generateToken as jest.Mock).mockReturnValue('jwt-token-abc');

    (getConfig as jest.Mock).mockReturnValue({
        adminEmails: 'admin@example.com',
        googleClientId: '',
        googleClientSecret: '',
        githubClientId: '',
        githubClientSecret: '',
    });

    mockCreateUser.mockResolvedValue(null);
    mockAuthenticate.mockResolvedValue(null);
    mockGetUserByEmail.mockResolvedValue(null);
    mockGetUserById.mockResolvedValue(null);
    mockChangePassword.mockResolvedValue(false);
    mockChangeRole.mockResolvedValue(null);
});

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('AuthService', () => {
    let service: AuthService;

    beforeEach(() => {
        service = new AuthService();
    });

    // ─────────────────────────────────────────
    // register
    // ─────────────────────────────────────────
    describe('register', () => {
        test('이메일이 없으면 실패를 반환한다', async () => {
            const result = await service.register({ email: '', password: VALID_PASSWORD });
            expect(result.success).toBe(false);
            expect(result.error).toContain('이메일과 비밀번호를 입력하세요');
        });

        test('비밀번호가 없으면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'user@example.com', password: '' });
            expect(result.success).toBe(false);
        });

        test('비밀번호가 8자 미만이면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'user@example.com', password: 'Ab1@' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('8자 이상');
        });

        test('대문자가 없으면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'user@example.com', password: 'secure@123' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('대문자');
        });

        test('소문자가 없으면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'user@example.com', password: 'SECURE@123' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('소문자');
        });

        test('숫자가 없으면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'user@example.com', password: 'Secure@abc' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('숫자');
        });

        test('특수문자가 없으면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'user@example.com', password: 'Secure1234' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('특수문자');
        });

        test('이메일 형식이 올바르지 않으면 실패를 반환한다', async () => {
            const result = await service.register({ email: 'not-an-email', password: VALID_PASSWORD });
            expect(result.success).toBe(false);
            expect(result.error).toContain('유효한 이메일');
        });

        test('이미 등록된 이메일이면 실패를 반환한다', async () => {
            mockCreateUser.mockResolvedValue(null);
            const result = await service.register({ email: 'user@example.com', password: VALID_PASSWORD });
            expect(result.success).toBe(false);
            expect(result.error).toContain('이미 등록된 이메일');
        });

        test('성공 시 success=true와 user를 반환한다', async () => {
            mockCreateUser.mockResolvedValue(makePublicUser());
            const result = await service.register({ email: 'user@example.com', password: VALID_PASSWORD });
            expect(result.success).toBe(true);
            expect(result.user).toBeDefined();
        });

        test('성공 시 token이 포함되지 않는다', async () => {
            mockCreateUser.mockResolvedValue(makePublicUser());
            const result = await service.register({ email: 'user@example.com', password: VALID_PASSWORD });
            expect(result.token).toBeUndefined();
        });

        test('role을 전달하면 createUser에 role이 전달된다', async () => {
            mockCreateUser.mockResolvedValue(makePublicUser({ role: 'admin' }));
            await service.register({ email: 'admin@example.com', password: VALID_PASSWORD, role: 'admin' });
            expect(mockCreateUser).toHaveBeenCalledWith(
                expect.objectContaining({ role: 'admin' })
            );
        });
    });

    // ─────────────────────────────────────────
    // login
    // ─────────────────────────────────────────
    describe('login', () => {
        test('이메일이 없으면 실패를 반환한다', async () => {
            const result = await service.login({ email: '', password: VALID_PASSWORD });
            expect(result.success).toBe(false);
        });

        test('비밀번호가 없으면 실패를 반환한다', async () => {
            const result = await service.login({ email: 'user@example.com', password: '' });
            expect(result.success).toBe(false);
        });

        test('인증 실패 시 실패를 반환한다', async () => {
            mockAuthenticate.mockResolvedValue(null);
            const result = await service.login({ email: 'user@example.com', password: 'wrongpass' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('이메일 또는 비밀번호');
        });

        test('성공 시 success=true, token, user를 반환한다', async () => {
            mockAuthenticate.mockResolvedValue(makePublicUser());
            const result = await service.login({ email: 'user@example.com', password: VALID_PASSWORD });
            expect(result.success).toBe(true);
            expect(result.token).toBe('jwt-token-abc');
            expect(result.user).toBeDefined();
        });

        test('성공 시 generateToken이 user와 함께 호출된다', async () => {
            const user = makePublicUser();
            mockAuthenticate.mockResolvedValue(user);
            await service.login({ email: 'user@example.com', password: VALID_PASSWORD });
            expect(generateToken).toHaveBeenCalledWith(user);
        });
    });

    // ─────────────────────────────────────────
    // changePassword
    // ─────────────────────────────────────────
    describe('changePassword', () => {
        const baseData = {
            userId: 'user-001',
            currentEmail: 'user@example.com',
            currentPassword: VALID_PASSWORD,
            newPassword: 'NewSecure@456',
        };

        test('현재 비밀번호가 없으면 실패를 반환한다', async () => {
            const result = await service.changePassword({ ...baseData, currentPassword: '' });
            expect(result.success).toBe(false);
        });

        test('새 비밀번호가 없으면 실패를 반환한다', async () => {
            const result = await service.changePassword({ ...baseData, newPassword: '' });
            expect(result.success).toBe(false);
        });

        test('새 비밀번호가 복잡도 미충족이면 실패를 반환한다', async () => {
            const result = await service.changePassword({ ...baseData, newPassword: 'simple' });
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        test('현재 비밀번호 인증 실패 시 실패를 반환한다', async () => {
            mockAuthenticate.mockResolvedValue(null);
            const result = await service.changePassword(baseData);
            expect(result.success).toBe(false);
            expect(result.error).toContain('현재 비밀번호가 올바르지 않습니다');
        });

        test('성공 시 success를 반환한다', async () => {
            mockAuthenticate.mockResolvedValue(makePublicUser());
            mockChangePassword.mockResolvedValue(true);
            const result = await service.changePassword(baseData);
            expect(result.success).toBe(true);
        });

        test('userManager.changePassword에 userId와 새 비밀번호를 전달한다', async () => {
            mockAuthenticate.mockResolvedValue(makePublicUser());
            mockChangePassword.mockResolvedValue(true);
            await service.changePassword(baseData);
            expect(mockChangePassword).toHaveBeenCalledWith('user-001', 'NewSecure@456');
        });
    });

    // ─────────────────────────────────────────
    // findOrCreateOAuthUser
    // ─────────────────────────────────────────
    describe('findOrCreateOAuthUser', () => {
        test('기존 사용자가 있으면 신규 생성하지 않는다', async () => {
            const existingUser = makePublicUser({ email: 'user@example.com', role: 'user' });
            mockGetUserByEmail.mockResolvedValue({ id: 'user-001', email: 'user@example.com', password: 'hash', role: 'user' });
            mockGetUserById.mockResolvedValue(existingUser);

            const result = await service.findOrCreateOAuthUser('user@example.com', 'google');

            expect(result.success).toBe(true);
            expect(mockCreateUser).not.toHaveBeenCalled();
        });

        test('기존 사용자이면 token이 생성된다', async () => {
            mockGetUserByEmail.mockResolvedValue({ id: 'user-001', email: 'user@example.com', password: 'hash', role: 'user' });
            mockGetUserById.mockResolvedValue(makePublicUser());

            const result = await service.findOrCreateOAuthUser('user@example.com', 'google');
            expect(result.token).toBe('jwt-token-abc');
        });

        test('신규 사용자이면 createUser가 호출된다', async () => {
            mockGetUserByEmail.mockResolvedValue(null);
            mockGetUserById.mockResolvedValue(null);
            mockCreateUser.mockResolvedValue(makePublicUser());

            await service.findOrCreateOAuthUser('newuser@example.com', 'github');

            expect(mockCreateUser).toHaveBeenCalledTimes(1);
        });

        test('신규 사용자 생성 시 랜덤 비밀번호로 생성된다', async () => {
            mockGetUserByEmail.mockResolvedValue(null);
            mockGetUserById.mockResolvedValue(null);
            mockCreateUser.mockResolvedValue(makePublicUser());

            await service.findOrCreateOAuthUser('newuser@example.com', 'google');

            const callArg = mockCreateUser.mock.calls[0][0];
            expect(typeof callArg.password).toBe('string');
            expect(callArg.password.length).toBeGreaterThan(0);
        });

        test('어드민 이메일이면 admin role로 생성된다', async () => {
            mockGetUserByEmail.mockResolvedValue(null);
            mockGetUserById.mockResolvedValue(null);
            mockCreateUser.mockResolvedValue(makePublicUser({ role: 'admin' }));

            await service.findOrCreateOAuthUser('admin@example.com', 'google');

            expect(mockCreateUser).toHaveBeenCalledWith(
                expect.objectContaining({ role: 'admin' })
            );
        });

        test('일반 이메일이면 user role로 생성된다', async () => {
            mockGetUserByEmail.mockResolvedValue(null);
            mockGetUserById.mockResolvedValue(null);
            mockCreateUser.mockResolvedValue(makePublicUser({ role: 'user' }));

            await service.findOrCreateOAuthUser('regular@example.com', 'google');

            expect(mockCreateUser).toHaveBeenCalledWith(
                expect.objectContaining({ role: 'user' })
            );
        });

        test('createUser 실패 시 실패를 반환한다', async () => {
            mockGetUserByEmail.mockResolvedValue(null);
            mockGetUserById.mockResolvedValue(null);
            mockCreateUser.mockResolvedValue(null);

            const result = await service.findOrCreateOAuthUser('newuser@example.com', 'google');

            expect(result.success).toBe(false);
            expect(result.error).toContain('사용자 생성 실패');
        });

        test('기존 사용자가 어드민 이메일이고 user 역할이면 어드민으로 승격된다', async () => {
            const existingUser = makePublicUser({ email: 'admin@example.com', role: 'user' });
            mockGetUserByEmail.mockResolvedValue({ id: 'user-001', email: 'admin@example.com', password: 'hash', role: 'user' });
            mockGetUserById.mockResolvedValue(existingUser);
            mockChangeRole.mockResolvedValue(makePublicUser({ role: 'admin' }));

            await service.findOrCreateOAuthUser('admin@example.com', 'google');

            expect(mockChangeRole).toHaveBeenCalledWith('user-001', 'admin');
        });

        test('기존 사용자가 이미 어드민이면 승격 호출 안 함', async () => {
            const existingUser = makePublicUser({ email: 'admin@example.com', role: 'admin' });
            mockGetUserByEmail.mockResolvedValue({ id: 'user-001', email: 'admin@example.com', password: 'hash', role: 'admin' });
            mockGetUserById.mockResolvedValue(existingUser);

            await service.findOrCreateOAuthUser('admin@example.com', 'google');

            expect(mockChangeRole).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────
    // getAvailableProviders
    // ─────────────────────────────────────────
    describe('getAvailableProviders', () => {
        test('설정이 없으면 빈 배열을 반환한다', () => {
            (getConfig as jest.Mock).mockReturnValue({
                adminEmails: '',
                googleClientId: '',
                googleClientSecret: '',
                githubClientId: '',
                githubClientSecret: '',
            });
            const providers = service.getAvailableProviders();
            expect(providers).toEqual([]);
        });

        test('Google 설정이 있으면 google이 포함된다', () => {
            (getConfig as jest.Mock).mockReturnValue({
                adminEmails: '',
                googleClientId: 'gid',
                googleClientSecret: 'gsecret',
                githubClientId: '',
                githubClientSecret: '',
            });
            const providers = service.getAvailableProviders();
            expect(providers).toContain('google');
        });

        test('GitHub 설정이 있으면 github이 포함된다', () => {
            (getConfig as jest.Mock).mockReturnValue({
                adminEmails: '',
                googleClientId: '',
                googleClientSecret: '',
                githubClientId: 'ghid',
                githubClientSecret: 'ghsecret',
            });
            const providers = service.getAvailableProviders();
            expect(providers).toContain('github');
        });

        test('두 설정 모두 있으면 둘 다 포함된다', () => {
            (getConfig as jest.Mock).mockReturnValue({
                adminEmails: '',
                googleClientId: 'gid',
                googleClientSecret: 'gsecret',
                githubClientId: 'ghid',
                githubClientSecret: 'ghsecret',
            });
            const providers = service.getAvailableProviders();
            expect(providers).toContain('google');
            expect(providers).toContain('github');
        });
    });
});

// ─────────────────────────────────────────────
// getAuthService (싱글톤)
// ─────────────────────────────────────────────

describe('getAuthService', () => {
    test('AuthService 인스턴스를 반환한다', () => {
        const svc = getAuthService();
        expect(svc).toBeInstanceOf(AuthService);
    });

    test('같은 인스턴스를 반환한다 (싱글톤)', () => {
        const svc1 = getAuthService();
        const svc2 = getAuthService();
        expect(svc1).toBe(svc2);
    });
});
