import { BaseRepository, QueryParam } from './base-repository';
import type { ResearchDepth, ResearchSession, ResearchStatus, ResearchStep } from '../models/unified-database';

export class ResearchRepository extends BaseRepository {
    async createResearchSession(params: {
        id: string;
        userId?: string;
        topic: string;
        depth?: ResearchDepth;
    }): Promise<void> {
        await this.query(
            'INSERT INTO research_sessions (id, user_id, topic, depth) VALUES ($1, $2, $3, $4)',
            [params.id, params.userId, params.topic, params.depth || 'standard']
        );
    }

    async getResearchSession(sessionId: string): Promise<ResearchSession | undefined> {
        const result = await this.query<ResearchSession>('SELECT * FROM research_sessions WHERE id = $1', [sessionId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            key_findings: row.key_findings || [],
            sources: row.sources || []
        };
    }

    async updateResearchSession(sessionId: string, updates: {
        status?: ResearchStatus;
        progress?: number;
        summary?: string;
        keyFindings?: string[];
        sources?: string[];
    }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.status) {
            sets.push(`status = $${paramIdx++}`);
            params.push(updates.status);
            if (updates.status === 'completed' || updates.status === 'failed') {
                sets.push('completed_at = NOW()');
            }
        }
        if (updates.progress !== undefined) {
            sets.push(`progress = $${paramIdx++}`);
            params.push(updates.progress);
        }
        if (updates.summary !== undefined) {
            sets.push(`summary = $${paramIdx++}`);
            params.push(updates.summary);
        }
        if (updates.keyFindings) {
            sets.push(`key_findings = $${paramIdx++}`);
            params.push(JSON.stringify(updates.keyFindings));
        }
        if (updates.sources) {
            sets.push(`sources = $${paramIdx++}`);
            params.push(JSON.stringify(updates.sources));
        }

        params.push(sessionId);
        await this.query(`UPDATE research_sessions SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    async addResearchStep(params: {
        sessionId: string;
        stepNumber: number;
        stepType: string;
        query?: string;
        result?: string;
        sources?: string[];
        status?: string;
    }): Promise<void> {
        await this.query(
            `INSERT INTO research_steps (session_id, step_number, step_type, query, result, sources, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.sessionId,
                params.stepNumber,
                params.stepType,
                params.query,
                params.result,
                params.sources ? JSON.stringify(params.sources) : null,
                params.status || 'pending'
            ]
        );
    }

    async getResearchSteps(sessionId: string): Promise<ResearchStep[]> {
        const result = await this.query<ResearchStep>(
            'SELECT * FROM research_steps WHERE session_id = $1 ORDER BY step_number ASC',
            [sessionId]
        );
        return result.rows.map((row) => ({
            ...row,
            sources: row.sources || []
        }));
    }

    async getUserResearchSessions(userId: string, limit: number = 20): Promise<ResearchSession[]> {
        const result = await this.query<ResearchSession>(
            'SELECT * FROM research_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
            [userId, limit]
        );
        return result.rows.map((row) => ({
            ...row,
            key_findings: row.key_findings || [],
            sources: row.sources || []
        }));
    }
}
