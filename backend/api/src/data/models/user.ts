/**
 * User Model
 * 사용자 관리 및 인증 모델
 */

import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { getUnifiedDatabase, getPool, User } from './unified-database';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';

const logger = createLogger('UserModel');

export type UserRole = 'admin' | 'user' | 'guest';

export interface PublicUser {
    id: string;
    username: string;
    email?: string;
    role: UserRole;
    created_at: string;
    last_login?: string;
    is_active: boolean;
}

export interface CreateUserInput {
    id: string;
    username: string;
    password: string;
    email?: string;
    role?: UserRole;
}

export class UserModel {
    /**
     * 사용자 생성
     */
    static async createUser(input: CreateUserInput): Promise<PublicUser | null> {
        try {
            const passwordHash = bcrypt.hashSync(input.password, 10);
            const db = getUnifiedDatabase();

            await db.createUser(
                input.id,
                input.username.toLowerCase().trim(),
                passwordHash,
                input.email?.toLowerCase().trim(),
                input.role || 'user'
            );

            const user = await db.getUserById(input.id);
            if (!user) return null;

            return this.toPublicUser(user);
        } catch (error: unknown) {
            logger.error('사용자 생성 실패:', (error instanceof Error ? error.message : String(error)));
            return null;
        }
    }

    /**
     * 사용자 인증
     */
    static async authenticate(username: string, password: string): Promise<PublicUser | null> {
        const db = getUnifiedDatabase();
        const user = await db.getUserByUsername(username.toLowerCase().trim());

        if (!user) {
            return null;
        }

        if (!user.is_active) {
            logger.info('비활성화된 계정:', username);
            return null;
        }

        if (!bcrypt.compareSync(password, user.password_hash)) {
            return null;
        }

        // 마지막 로그인 시간 업데이트
        await db.updateLastLogin(user.id);

        return this.toPublicUser(user);
    }

    /**
     * ID로 사용자 조회
     */
    static async getUserById(id: string): Promise<PublicUser | null> {
        const db = getUnifiedDatabase();
        const user = await db.getUserById(id);
        return user ? this.toPublicUser(user) : null;
    }

    /**
     * 사용자명으로 조회
     */
    static async getUserByUsername(username: string): Promise<PublicUser | null> {
        const db = getUnifiedDatabase();
        const user = await db.getUserByUsername(username.toLowerCase().trim());
        return user ? this.toPublicUser(user) : null;
    }

    /**
     * 전체 사용자 목록
     */
    static async getAllUsers(limit: number = 50): Promise<PublicUser[]> {
        const db = getUnifiedDatabase();
        const users = await db.getAllUsers(limit);
        return users.map(u => this.toPublicUser(u));
    }

    /**
     * 비밀번호 변경
     */
    static async changePassword(userId: string, newPassword: string): Promise<boolean> {
        try {
            const passwordHash = bcrypt.hashSync(newPassword, 10);
            const pool = getPool();

            const result = await pool.query(
                'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
                [passwordHash, userId]
            );

            return (result.rowCount || 0) > 0;
        } catch (error) {
            logger.error('비밀번호 변경 실패:', error);
            return false;
        }
    }

    /**
     * 사용자 활성화/비활성화
     */
    static async setActive(userId: string, isActive: boolean): Promise<boolean> {
        try {
            const pool = getPool();

            const result = await pool.query(
                'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2',
                [isActive, userId]
            );

            return (result.rowCount || 0) > 0;
        } catch (error) {
            logger.error('활성화 상태 변경 실패:', error);
            return false;
        }
    }

    /**
     * Private: User 객체를 PublicUser로 변환
     */
    private static toPublicUser(user: User): PublicUser {
        return {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            created_at: user.created_at,
            last_login: user.last_login,
            is_active: Boolean(user.is_active)
        };
    }

    /**
     * 기본 관리자 계정 생성
     */
    static async ensureAdminExists(): Promise<void> {
        const db = getUnifiedDatabase();
        const admin = await db.getUserByUsername('admin');

        if (!admin) {
            const defaultPassword = getConfig().adminPassword;
            const adminEmail = getConfig().defaultAdminEmail;

            // ADMIN_PASSWORD 미설정 시 프로덕션 환경에서 중단, 개발환경에서는 랜덤 비밀번호 생성
            if (!defaultPassword) {
                if (getConfig().nodeEnv === 'production') {
                    logger.error('ADMIN_PASSWORD 환경변수가 설정되지 않았습니다!');
                    throw new Error('ADMIN_PASSWORD 환경변수가 필수입니다!');
                }
                logger.warn('개발 환경: 랜덤 비밀번호 생성');
            }

            // 개발환경에서는 랜덤 비밀번호 생성 (32 bytes = 256 bit entropy)
            const generatedPassword = defaultPassword || crypto.randomBytes(32).toString('base64');

            await this.createUser({
                id: 'admin-001',
                username: 'admin',
                password: generatedPassword,
                email: adminEmail,
                role: 'admin'
            });

            logger.info('기본 관리자 계정 생성 완료: admin');
            if (!defaultPassword) {
                logger.warn('개발환경: 랜덤 admin 비밀번호가 생성되었습니다. 프로덕션에서는 ADMIN_PASSWORD 환경변수를 설정하세요!');
            }
        }
    }
}
