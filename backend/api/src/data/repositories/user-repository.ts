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
