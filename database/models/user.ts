/**
 * User Model
 * 사용자 관리 및 인증 모델
 * 
 * #17 개선: UnifiedDatabase의 기본 CRUD 위에 비즈니스 로직(bcrypt 해싱, 인증, 권한)을 추가하는 서비스 레이어.
 * 단순 CRUD는 UnifiedDatabase에 위임하고, 이 모델은 비즈니스 규칙만 담당합니다.
 */

import * as bcrypt from 'bcryptjs';
import { getUnifiedDatabase } from './unified-database';

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
    static createUser(input: CreateUserInput): PublicUser | null {
        try {
            const passwordHash = bcrypt.hashSync(input.password, 10);
            const db = getUnifiedDatabase();

            db.createUser(
                input.id,
                input.username.toLowerCase().trim(),
                passwordHash,
                input.email?.toLowerCase().trim(),
                input.role || 'user'
            );

            const user = db.getUserById(input.id);
            if (!user) return null;

            return this.toPublicUser(user);
        } catch (error: any) {
            console.error('[UserModel] 사용자 생성 실패:', error.message);
            return null;
        }
    }

    /**
     * 사용자 인증
     */
    static authenticate(username: string, password: string): PublicUser | null {
        const db = getUnifiedDatabase();
        const user = db.getUserByUsername(username.toLowerCase().trim());

        if (!user) {
            return null;
        }

        if (!user.is_active) {
            console.log('[UserModel] 비활성화된 계정:', username);
            return null;
        }

        if (!bcrypt.compareSync(password, user.password_hash)) {
            return null;
        }

        // 마지막 로그인 시간 업데이트
        db.updateLastLogin(user.id);

        return this.toPublicUser(user);
    }

    /**
     * ID로 사용자 조회
     */
    static getUserById(id: string): PublicUser | null {
        const db = getUnifiedDatabase();
        const user = db.getUserById(id);
        return user ? this.toPublicUser(user) : null;
    }

    /**
     * 사용자명으로 조회
     */
    static getUserByUsername(username: string): PublicUser | null {
        const db = getUnifiedDatabase();
        const user = db.getUserByUsername(username.toLowerCase().trim());
        return user ? this.toPublicUser(user) : null;
    }

    /**
     * 전체 사용자 목록
     */
    static getAllUsers(limit: number = 50): PublicUser[] {
        const db = getUnifiedDatabase();
        const users = db.getAllUsers(limit);
        return users.map(u => this.toPublicUser(u));
    }

    /**
     * 비밀번호 변경
     */
    static changePassword(userId: string, newPassword: string): boolean {
        try {
            const passwordHash = bcrypt.hashSync(newPassword, 10);
            const db = getUnifiedDatabase();
            const userDb = db.getDatabase();

            const result = userDb.prepare(
                'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).run(passwordHash, userId);

            return result.changes > 0;
        } catch (error) {
            console.error('[UserModel] 비밀번호 변경 실패:', error);
            return false;
        }
    }

    /**
     * 사용자 활성화/비활성화
     */
    static setActive(userId: string, isActive: boolean): boolean {
        try {
            const db = getUnifiedDatabase();
            const userDb = db.getDatabase();

            const result = userDb.prepare(
                'UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).run(isActive ? 1 : 0, userId);

            return result.changes > 0;
        } catch (error) {
            console.error('[UserModel] 활성화 상태 변경 실패:', error);
            return false;
        }
    }

    /**
     * Private: User 객체를 PublicUser로 변환
     */
    private static toPublicUser(user: any): PublicUser {
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
    static ensureAdminExists(): void {
        const db = getUnifiedDatabase();
        const admin = db.getUserByUsername('admin');

        if (!admin) {
            const defaultPassword = process.env.ADMIN_PASSWORD;
            const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@localhost';

            // ADMIN_PASSWORD 미설정 시 경고 및 프로덕션 환경에서 중단
            if (!defaultPassword) {
                console.error('[UserModel] ❌ ADMIN_PASSWORD 환경변수가 설정되지 않았습니다!');
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('ADMIN_PASSWORD 환경변수가 필수입니다!');
                }
                console.warn('[UserModel] ⚠️ 개발 환경: 임시 비밀번호 사용');
            }

            this.createUser({
                id: 'admin-001',
                username: 'admin',
                password: defaultPassword || 'dev-temp-password-change-me',
                email: adminEmail,
                role: 'admin'
            });

            console.log('[UserModel] 기본 관리자 계정 생성 완료: admin');
            if (!defaultPassword) {
                console.warn('[UserModel] ⚠️ ADMIN_PASSWORD 환경변수를 설정하세요!');
            }
        }
    }
}
