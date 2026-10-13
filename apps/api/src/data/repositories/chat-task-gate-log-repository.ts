/**
 * 작업 게이트 기록(185) — 채팅 요청이 agent-task 에 맞는지에 대한 의사결정 어댑터 판정의 저장과 검토용 집계.
 * 요청 본문은 저장하지 않는다. 검토용 본문은 답 메시지(message_id) 바로 앞의 사용자 메시지를 조인해 가져온다.
 *
 * @module data/repositories/chat-task-gate-log-repository
 */
import { BaseRepository } from './base-repository';

/** 실패 사유 보관 상한(자) */
const GATE_ERROR_MAX_CHARS = 200;
/** 검토 표본에 싣는 사용자 메시지 앞부분(자) */
const SAMPLE_QUESTION_CHARS = 200;

export interface ChatTaskGateLogEntry {
    userId: string;
    sessionId: string;
    /** 저장된 답 메시지 id — 답을 저장하지 않은 턴은 null */
    messageId: number | null;
    channel: 'web' | 'api';
    mode: 'shadow' | 'on';
    source: 'rule' | 'jev';
    pTrue: number | null;
    gateError: string | null;
    gateMs: number;
    gateModel: string | null;
    suggested: boolean;
    queryChars: number;
}

export interface TaskGateSummary {
    total: number;
    rule: number;
    jev: number;
    /** 어댑터를 불렀지만 확률을 받지 못한 건수 */
    failed: number;
    p50Ms: number | null;
    p95Ms: number | null;
}

export interface TaskGateSample {
    pTrue: number;
    createdAt: string;
    question: string | null;
}

const num = (v: string | number | null | undefined): number => Number(v ?? 0);
const numOrNull = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export class ChatTaskGateLogRepository extends BaseRepository {
    async insert(entry: ChatTaskGateLogEntry): Promise<void> {
        await this.query(
            `INSERT INTO chat_task_gate_log
                (user_id, session_id, message_id, channel, mode, source, p_true, gate_error, gate_ms, gate_model, suggested, query_chars)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                entry.userId, entry.sessionId, entry.messageId, entry.channel, entry.mode, entry.source, entry.pTrue,
                entry.gateError === null ? null : entry.gateError.slice(0, GATE_ERROR_MAX_CHARS),
                entry.gateMs, entry.gateModel, entry.suggested, entry.queryChars,
            ],
        );
    }

    /** 기간(sinceIso 이후)의 건수·실패·판정 지연. 지연은 어댑터 판정만 센다. */
    async summary(sinceIso: string): Promise<TaskGateSummary> {
        const r = await this.query<{ total: string; rule: string; jev: string; failed: string; p50_ms: string | null; p95_ms: string | null }>(
            `SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE source = 'rule') AS rule,
                    COUNT(*) FILTER (WHERE source = 'jev') AS jev,
                    COUNT(*) FILTER (WHERE source = 'jev' AND p_true IS NULL) AS failed,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY gate_ms) FILTER (WHERE source = 'jev') AS p50_ms,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY gate_ms) FILTER (WHERE source = 'jev') AS p95_ms
               FROM chat_task_gate_log
              WHERE created_at >= $1`,
            [sinceIso],
        );
        const row = r.rows[0];
        return {
            total: num(row?.total), rule: num(row?.rule), jev: num(row?.jev), failed: num(row?.failed),
            p50Ms: numOrNull(row?.p50_ms), p95Ms: numOrNull(row?.p95_ms),
        };
    }

    /** 어댑터 판정 확률의 0.1 구간별 건수 — bucket 0 = [0,0.1) … 9 = [0.9,1.0] */
    async histogram(sinceIso: string): Promise<Array<{ bucket: number; count: number }>> {
        const r = await this.query<{ bucket: number; count: string }>(
            `SELECT LEAST(FLOOR(p_true * 10)::int, 9) AS bucket, COUNT(*) AS count
               FROM chat_task_gate_log
              WHERE created_at >= $1 AND source = 'jev' AND p_true IS NOT NULL
              GROUP BY 1 ORDER BY 1`,
            [sinceIso],
        );
        return r.rows.map((x) => ({ bucket: Number(x.bucket), count: num(x.count) }));
    }

    /** 확률 구간 [minP, maxP] 의 판정을 확률 높은 순으로 — 사람이 읽고 맞는지 보는 표본 */
    async samples(sinceIso: string, minP: number, maxP: number, limit: number): Promise<TaskGateSample[]> {
        const r = await this.query<{ p_true: number; created_at: string; question: string | null }>(
            `SELECT l.p_true, l.created_at,
                    (SELECT LEFT(m.content, ${SAMPLE_QUESTION_CHARS}) FROM conversation_messages m
                      WHERE m.session_id = l.session_id AND m.role = 'user' AND m.id < l.message_id
                      ORDER BY m.id DESC LIMIT 1) AS question
               FROM chat_task_gate_log l
              WHERE l.created_at >= $1 AND l.source = 'jev' AND l.p_true BETWEEN $2 AND $3 AND l.message_id IS NOT NULL
              ORDER BY l.p_true DESC, l.id DESC
              LIMIT $4`,
            [sinceIso, minP, maxP, limit],
        );
        return r.rows.map((x) => ({ pTrue: Number(x.p_true), createdAt: String(x.created_at), question: x.question }));
    }
}
