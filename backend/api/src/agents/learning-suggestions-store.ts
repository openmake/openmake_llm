/**
 * ============================================================
 * Agent Prompt Suggestions Store (F2)
 * ============================================================
 *
 * learning.ts 에서 추출 (max-lines 정책 + 책임 분리). `agent_prompt_suggestions`
 * 테이블 전용 raw SQL — 영속화/승인 조회/목록/상태변경. 자가개선 루프의 저장 계층.
 *
 * @module agents/learning-suggestions-store
 */

import crypto from 'node:crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentSuggestionsStore');

function getPool(): import('pg').Pool {
    const { getPool: gp } = require('../data/models/unified-database') as { getPool: () => import('pg').Pool };
    return gp();
}

/** 프롬프트 제안 행 (관리자 검토용) */
export interface PromptSuggestionRow {
    id: string;
    agentId: string;
    suggestion: string;
    sourcePatterns: string | null;
    qualityScore: number | null;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: Date;
}

/**
 * 프롬프트 개선 제안을 DB 에 영속화 (status='pending').
 * id = sha1(agentId + suggestion) 로 멱등 (ON CONFLICT DO NOTHING). DB 오류는 graceful(0).
 */
export async function persistSuggestions(
    agentId: string,
    suggestions: string[],
    qualityScore: number,
    sourcePatterns: string,
): Promise<number> {
    const unique = [...new Set(suggestions.filter(s => s && s.trim()))];
    if (unique.length === 0) return 0;
    try {
        const pool = getPool();
        for (const suggestion of unique) {
            const id = `sug_${crypto.createHash('sha1').update(`${agentId}::${suggestion}`).digest('hex').slice(0, 24)}`;
            await pool.query(
                `INSERT INTO agent_prompt_suggestions (id, agent_id, suggestion, source_patterns, quality_score, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending')
                 ON CONFLICT (id) DO NOTHING`,
                [id, agentId, suggestion, sourcePatterns || null, qualityScore],
            );
        }
        return unique.length;
    } catch (error) {
        logger.error('프롬프트 제안 DB 저장 실패 (graceful — 사이클 계속):', error);
        return 0;
    }
}

/** 승인(approved)된 프롬프트 추가 지침 조회 (시스템 프롬프트 주입용). DB 오류 시 []. */
export async function getApprovedPromptAdditions(agentId: string, limit: number = 5): Promise<string[]> {
    try {
        const pool = getPool();
        const result = await pool.query(
            `SELECT suggestion FROM agent_prompt_suggestions
             WHERE agent_id = $1 AND status = 'approved'
             ORDER BY created_at DESC LIMIT $2`,
            [agentId, limit],
        );
        return result.rows.map((r: { suggestion: string }) => r.suggestion).filter(Boolean);
    } catch (error) {
        logger.error('승인된 프롬프트 제안 조회 실패 (graceful — 빈 배열):', error);
        return [];
    }
}

/** 제안 목록 조회 (관리자 검토용). DB 오류 시 graceful []. */
export async function listSuggestions(opts: {
    status?: 'pending' | 'approved' | 'rejected' | 'all';
    agentId?: string;
    limit?: number;
} = {}): Promise<PromptSuggestionRow[]> {
    const status = opts.status ?? 'pending';
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where: string[] = [];
    const params: unknown[] = [];
    if (status !== 'all') {
        params.push(status);
        where.push(`status = $${params.length}`);
    }
    if (opts.agentId) {
        params.push(opts.agentId);
        where.push(`agent_id = $${params.length}`);
    }
    params.push(limit);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    try {
        const pool = getPool();
        const result = await pool.query(
            `SELECT id, agent_id, suggestion, source_patterns, quality_score, status, created_at
             FROM agent_prompt_suggestions ${whereSql}
             ORDER BY created_at DESC LIMIT $${params.length}`,
            params,
        );
        return result.rows.map((r: Record<string, unknown>) => ({
            id: String(r.id),
            agentId: String(r.agent_id),
            suggestion: String(r.suggestion),
            sourcePatterns: r.source_patterns != null ? String(r.source_patterns) : null,
            qualityScore: r.quality_score != null ? Number(r.quality_score) : null,
            status: String(r.status) as PromptSuggestionRow['status'],
            createdAt: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
        }));
    } catch (error) {
        logger.error('프롬프트 제안 목록 조회 실패 (graceful — 빈 배열):', error);
        return [];
    }
}

/**
 * 제안 상태 변경(승인/거부). DB 오류는 throw(라우트 500), 대상 미존재 시 false.
 */
export async function setSuggestionStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
        `UPDATE agent_prompt_suggestions SET status = $2 WHERE id = $1 RETURNING id`,
        [id, status],
    );
    return (result.rowCount ?? 0) > 0;
}
