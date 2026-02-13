/**
 * User Manager
 * backend/api에서 사용하는 UserManager 래퍼
 * 
 * 🔒 보안 강화: bcrypt를 사용한 비밀번호 해싱 적용
 * 📦 PostgreSQL 기반 (unified-database 사용)
 */

import * as bcrypt from 'bcryptjs';
import { getPool } from './models/unified-database';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('UserManager');

// 비밀번호 해싱 라운드 (높을수록 안전하지만 느림)
const BCRYPT_ROUNDS = 12;

export type UserRole = 'admin' | 'user' | 'guest';

// MCP 도구 접근 등급
export type UserTier = 'free' | 'pro' | 'enterprise';

export interface PublicUser {
    id: string;
    email: string;
    role: UserRole;
    tier: UserTier;
    created_at: string;
    last_login?: string;
    is_active: boolean;
}

export interface CreateUserInput {
    email: string;
    password: string;
    role?: UserRole;
    tier?: UserTier;
}

interface UserRow {
    id: string;
    username: string;
    password_hash: string;
    email: string | null;
    role: string;
    tier: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    last_login: string | null;
}

/**
 * PostgreSQL 기반 UserManager
 */
class UserManagerImpl {
    constructor() {
        this.init().catch(err => logger.error('[UserManager] Init failed:', err));
    }

    private async init(): Promise<void> {
        await this.ensureSchema();
        await this.ensureAdminUser();
    }

    private async ensureSchema(): Promise<void> {
        const pool = getPool();
        try {
            await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT \'free\'');
        } catch (_e: unknown) {
            // 이미 존재하는 경우 무시
        }
    }

    private async ensureAdminUser(): Promise<void> {
        const pool = getPool();
        const adminEmail = getConfig().defaultAdminEmail || 'admin';

        // 기존 'admin' 계정이 있고 DEFAULT_ADMIN_EMAIL이 다르면 마이그레이션
        if (adminEmail !== 'admin') {
            const legacyAdmin = await pool.query(
                'SELECT id FROM users WHERE username = $1 AND role = $2',
                ['admin', 'admin']
            );
            const existingEmail = await pool.query(
                'SELECT id, role FROM users WHERE username = $1',
                [adminEmail]
            );

            if (legacyAdmin.rows.length > 0 && existingEmail.rows.length > 0) {
                // 이메일 사용자가 이미 존재하면: admin 권한 부여 + 비밀번호 갱신, 레거시 admin 삭제
                const cfgAdminPassword = getConfig().adminPassword;
                if (cfgAdminPassword) {
                    const passwordHash = bcrypt.hashSync(cfgAdminPassword, BCRYPT_ROUNDS);
                    await pool.query(
                        'UPDATE users SET role = $1, tier = $2, password_hash = $3, updated_at = $4 WHERE username = $5',
                        ['admin', 'enterprise', passwordHash, new Date().toISOString(), adminEmail]
                    );
                    await pool.query('DELETE FROM users WHERE username = $1 AND role = $2', ['admin', 'admin']);
                    logger.info(`[UserManager] ✅ 관리자 권한 이전 완료: admin 삭제, ${adminEmail} → admin 역할`);
                }
                return;
            } else if (legacyAdmin.rows.length > 0) {
                // 이메일 사용자가 없으면: 레거시 admin의 username을 이메일로 변경
                const cfgAdminPassword = getConfig().adminPassword;
                if (cfgAdminPassword) {
                    const passwordHash = bcrypt.hashSync(cfgAdminPassword, BCRYPT_ROUNDS);
                    await pool.query(
                        'UPDATE users SET username = $1, email = $2, password_hash = $3, updated_at = $4 WHERE username = $5 AND role = $6',
                        [adminEmail, adminEmail, passwordHash, new Date().toISOString(), 'admin', 'admin']
                    );
                    logger.info(`[UserManager] ✅ 관리자 계정 마이그레이션 완료: admin → ${adminEmail}`);
                }
                return;
            } else if (existingEmail.rows.length > 0) {
                // 이메일 사용자만 있으면: admin 역할 부여
                if (existingEmail.rows[0].role !== 'admin') {
                    const cfgAdminPassword = getConfig().adminPassword;
                    if (cfgAdminPassword) {
                        const passwordHash = bcrypt.hashSync(cfgAdminPassword, BCRYPT_ROUNDS);
                        await pool.query(
                            'UPDATE users SET role = $1, tier = $2, password_hash = $3, updated_at = $4 WHERE username = $5',
                            ['admin', 'enterprise', passwordHash, new Date().toISOString(), adminEmail]
                        );
                        logger.info(`[UserManager] ✅ ${adminEmail} 관리자 역할 부여 완료`);
                    }
                }
                return;
            }
        }

        // DEFAULT_ADMIN_EMAIL 계정이 이미 있으면 스킵
        const result = await pool.query(
            'SELECT id FROM users WHERE username = $1',
            [adminEmail]
        );
        if (result.rows.length > 0) return;

        // 🔒 보안 강화: 환경변수 필수화, 기본 비밀번호 제거
        const cfgAdminPassword = getConfig().adminPassword;
        if (!cfgAdminPassword) {
            logger.warn('[UserManager] ⚠️ ADMIN_PASSWORD 환경변수가 설정되지 않았습니다!');
            logger.warn('[UserManager] 기본 관리자 계정이 생성되지 않습니다. .env 파일에 ADMIN_PASSWORD를 설정하세요.');
            if (getConfig().nodeEnv === 'production') {
                throw new Error('[UserManager] 프로덕션 환경에서는 ADMIN_PASSWORD 환경변수가 필수입니다!');
            }
            // 개발 환경에서만 임시 비밀번호 생성 (랜덤)
            const tempPassword = require('crypto').randomBytes(16).toString('hex');
            logger.warn('[UserManager] 개발 환경: 랜덤 임시 비밀번호가 생성되었습니다. 프로덕션에서는 ADMIN_PASSWORD를 설정하세요.');
            await this.createUser({
                email: adminEmail,
                password: tempPassword,
                role: 'admin'
            });
        } else {
            await this.createUser({
                email: adminEmail,
                password: cfgAdminPassword,
                role: 'admin'
            });
        }
    }

    private async getNextId(): Promise<number> {
        const pool = getPool();
        // Use pg_advisory_xact_lock to prevent race condition on concurrent user creation
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(1)');
            const result = await client.query(
                `SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 as next_id FROM users WHERE id ~ $1`,
                ['^\\d+$']
            );
            const nextId = result.rows[0]?.next_id || 1;
            await client.query('COMMIT');
            return nextId;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    private rowToPublicUser(row: UserRow): PublicUser {
        return {
            id: row.id,
            email: row.username,
            role: row.role as UserRole,
            tier: (row.tier || 'free') as UserTier,
            is_active: !!row.is_active,
            created_at: row.created_at,
            last_login: row.last_login || undefined
        };
    }

    async createUser(input: CreateUserInput): Promise<PublicUser | null> {
        const pool = getPool();

        // 중복 username 체크
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [input.email]);
        if (existing.rows.length > 0) return null;

        const id = await this.getNextId();
        // admin 역할은 자동으로 enterprise tier
        const tier = input.tier || (input.role === 'admin' ? 'enterprise' : 'free');

        // 🔒 bcrypt로 비밀번호 해싱
        const passwordHash = bcrypt.hashSync(input.password, BCRYPT_ROUNDS);
        const now = new Date().toISOString();
        const role = input.role || 'user';

        await pool.query(
            `INSERT INTO users (id, username, password_hash, email, role, tier, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)`,
            [String(id), input.email, passwordHash, input.email, role, tier, now, now]
        );

        const result = await pool.query('SELECT * FROM users WHERE id = $1', [String(id)]);
        const row = result.rows[0] as UserRow | undefined;
        return row ? this.rowToPublicUser(row) : null;
    }

    async authenticate(email: string, password: string): Promise<PublicUser | null> {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND is_active = TRUE', [email]);
        const row = result.rows[0] as UserRow | undefined;
        if (!row) return null;

        // 🔒 bcrypt로 비밀번호 비교 (해시 비교)
        if (!bcrypt.compareSync(password, row.password_hash)) return null;

        // last_login 업데이트
        const now = new Date().toISOString();
        await pool.query('UPDATE users SET last_login = $1 WHERE id = $2', [now, row.id]);

        row.last_login = now;
        return this.rowToPublicUser(row);
    }

    async getUserById(id: string): Promise<PublicUser | null> {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        const row = result.rows[0] as UserRow | undefined;
        return row ? this.rowToPublicUser(row) : null;
    }

    async getUserByEmail(email: string): Promise<{ id: string; email: string; password: string; role: UserRole } | null> {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [email]);
        const row = result.rows[0] as UserRow | undefined;
        if (!row) return null;
        return {
            id: row.id,
            email: row.username,
            password: row.password_hash,
            role: row.role as UserRole
        };
    }

    async getAllUsers(options?: { page?: number; limit?: number; role?: UserRole; search?: string }): Promise<{ users: PublicUser[]; total: number; page: number; limit: number }> {
        const pool = getPool();
        const conditions: string[] = [];
        const params: (string | number)[] = [];
        let paramIdx = 1;

        if (options?.role) {
            conditions.push(`role = $${paramIdx++}`);
            params.push(options.role);
        }
        if (options?.search) {
            conditions.push(`LOWER(username) LIKE $${paramIdx++}`);
            params.push(`%${options.search.toLowerCase()}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // 총 개수
        const countResult = await pool.query(`SELECT COUNT(*) as total FROM users ${whereClause}`, params);
        const total = parseInt(countResult.rows[0].total, 10);

        const page = options?.page || 1;
        const limit = options?.limit || 20;
        const offset = (page - 1) * limit;

        const queryParams = [...params, limit, offset];
        const rows = await pool.query(
            `SELECT * FROM users ${whereClause} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            queryParams
        );

        return {
            users: (rows.rows as UserRow[]).map(r => this.rowToPublicUser(r)),
            total,
            page,
            limit
        };
    }

    async changePassword(userId: string, newPassword: string): Promise<boolean> {
        const pool = getPool();
        // 🔒 새 비밀번호도 해싱하여 저장
        const passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
        const result = await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3',
            [passwordHash, new Date().toISOString(), userId]
        );
        return (result.rowCount || 0) > 0;
    }

    async changeRole(userId: string, newRole: UserRole): Promise<PublicUser | null> {
        const pool = getPool();
        const result = await pool.query(
            'UPDATE users SET role = $1, updated_at = $2 WHERE id = $3',
            [newRole, new Date().toISOString(), userId]
        );
        if ((result.rowCount || 0) === 0) return null;

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const row = userResult.rows[0] as UserRow | undefined;
        return row ? this.rowToPublicUser(row) : null;
    }

    async updateUser(userId: string, updates: { email?: string; role?: UserRole; is_active?: boolean }): Promise<PublicUser | null> {
        const pool = getPool();
        const sets: string[] = ['updated_at = $1'];
        const params: (string | number | boolean)[] = [new Date().toISOString()];
        let paramIdx = 2;

        if (updates.email !== undefined) {
            sets.push(`username = $${paramIdx++}`);
            params.push(updates.email);
            sets.push(`email = $${paramIdx++}`);
            params.push(updates.email);
        }
        if (updates.role !== undefined) {
            sets.push(`role = $${paramIdx++}`);
            params.push(updates.role);
        }
        if (updates.is_active !== undefined) {
            sets.push(`is_active = $${paramIdx++}`);
            params.push(updates.is_active);
        }

        params.push(userId);
        const result = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
        if ((result.rowCount || 0) === 0) return null;

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const row = userResult.rows[0] as UserRow | undefined;
        return row ? this.rowToPublicUser(row) : null;
    }

    async deleteUser(userId: string): Promise<boolean> {
        const pool = getPool();
        const uid = userId;
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
        const row = userResult.rows[0] as UserRow | undefined;
        if (!row) return false;

        if (row.role === 'admin') {
            const countResult = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE role = \'admin\'');
            if (parseInt(countResult.rows[0].cnt, 10) <= 1) return false;
        }

        // 의존 레코드를 FK 순서대로 삭제 (ON DELETE CASCADE가 없는 테이블들)
        // canvas_documents → conversation_sessions 순서 주의 (canvas가 session FK 참조)
        await pool.query('DELETE FROM agent_installations WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM agent_reviews WHERE user_id = $1', [uid]);
        await pool.query(
            'DELETE FROM agent_marketplace WHERE author_id = $1', [uid]
        );
        await pool.query('DELETE FROM agent_feedback WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM agent_usage_logs WHERE user_id = $1', [uid]);
        await pool.query('UPDATE custom_agents SET created_by = NULL WHERE created_by = $1', [uid]);
        await pool.query('DELETE FROM canvas_documents WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM research_sessions WHERE user_id = $1', [uid]);
        await pool.query('DELETE FROM conversation_sessions WHERE user_id = $1', [uid]);

        const result = await pool.query('DELETE FROM users WHERE id = $1', [uid]);
        return (result.rowCount || 0) > 0;
    }

    async getStats() {
        const pool = getPool();
        const totalRow = await pool.query('SELECT COUNT(*) as cnt FROM users');
        const activeRow = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE is_active = TRUE');
        const adminRow = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE role = \'admin\'');
        const userRow = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE role = \'user\'');
        const guestRow = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE role = \'guest\'');
        return {
            totalUsers: parseInt(totalRow.rows[0].cnt, 10),
            activeUsers: parseInt(activeRow.rows[0].cnt, 10),
            adminCount: parseInt(adminRow.rows[0].cnt, 10),
            userCount: parseInt(userRow.rows[0].cnt, 10),
            guestCount: parseInt(guestRow.rows[0].cnt, 10)
        };
    }

    // 사용자 tier 변경
    async changeTier(userId: string, newTier: UserTier): Promise<PublicUser | null> {
        const pool = getPool();
        const result = await pool.query(
            'UPDATE users SET tier = $1, updated_at = $2 WHERE id = $3',
            [newTier, new Date().toISOString(), userId]
        );
        if ((result.rowCount || 0) === 0) return null;

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const row = userResult.rows[0] as UserRow | undefined;
        return row ? this.rowToPublicUser(row) : null;
    }
}

let userManagerInstance: UserManagerImpl | null = null;

export function getUserManager(): UserManagerImpl {
    if (!userManagerInstance) userManagerInstance = new UserManagerImpl();
    return userManagerInstance;
}
