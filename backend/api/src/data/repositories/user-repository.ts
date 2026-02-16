/**
 * @module data/repositories/user-repository
 * @description `users` 테이블 데이터 접근 계층
 *
 * 사용자 계정 엔티티(User)의 CRUD 및 조회를 담당합니다.
 * - 사용자 생성 (createUser)
 * - username/ID/email 기반 조회
 * - 마지막 로그인 갱신, 비밀번호 변경
 * - 전체 사용자 목록 조회 (관리자용)
 */
import type { QueryResult } from 'pg';
import { BaseRepository } from './base-repository';
import type { User } from '../models/unified-database';

export class UserRepository extends BaseRepository {
    async createUser(id: string, username: string, passwordHash: string, email?: string, role: string = 'user'): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            'INSERT INTO users (id, username, password_hash, email, role) VALUES ($1, $2, $3, $4, $5)',
            [id, username, passwordHash, email, role]
        );
    }

    async getUserByUsername(username: string): Promise<User | undefined> {
        const result = await this.query<User>('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0] as User | undefined;
    }

    async getUserById(id: string): Promise<User | undefined> {
        const result = await this.query<User>('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0] as User | undefined;
    }

    async updateLastLogin(userId: string): Promise<QueryResult<Record<string, unknown>>> {
        return this.query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);
    }

    async getAllUsers(limit: number = 50): Promise<User[]> {
        const result = await this.query<User>('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [limit]);
        return result.rows as User[];
    }
}
