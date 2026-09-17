/**
 * @module data/repositories/chat-request-repository
 * @description `chat_requests`·`prompt_fingerprints`(142) — 요청 사실 1행 적재와 지문 원문 upsert. 호출부는 fire-and-forget.
 */
import { BaseRepository } from './base-repository';

export interface ChatRequestRecord {
    requestId: string;
    traceId?: string;
    userId?: string;
    sessionId?: string;
    startedAt: Date;
    status: 'ok' | 'error' | 'aborted';
    errorCode?: string | null;
    providerId?: string;
    model?: string;
    appVersion?: string;
    gitHash?: string;
    promptStaticHash?: string;
    promptFullHash?: string;
    promptBlocks: string[];
    toolManifestHash?: string;
    toolNames: string[];
    ttftMs?: number | null;
    prepMs?: number | null;
    totalMs: number;
    toolMs?: number;
    toolTurns?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsdMicros?: number;
}

export class ChatRequestRepository extends BaseRepository {
    async insert(r: ChatRequestRecord): Promise<void> {
        await this.query(
            `INSERT INTO chat_requests (request_id, trace_id, user_id, session_id, started_at, status, error_code, provider_id, model,
                app_version, git_hash, prompt_static_hash, prompt_full_hash, prompt_blocks, tool_manifest_hash, tool_names,
                ttft_ms, prep_ms, total_ms, tool_ms, tool_turns, input_tokens, output_tokens, cost_usd_micros)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
             ON CONFLICT (request_id) DO NOTHING`,
            [r.requestId, r.traceId ?? null, r.userId ?? null, r.sessionId ?? null, r.startedAt.toISOString(), r.status, r.errorCode ?? null,
                r.providerId ?? null, r.model ?? null, r.appVersion ?? null, r.gitHash ?? null, r.promptStaticHash ?? null, r.promptFullHash ?? null,
                r.promptBlocks, r.toolManifestHash ?? null, r.toolNames, r.ttftMs ?? null, r.prepMs ?? null, r.totalMs, r.toolMs ?? null,
                r.toolTurns ?? null, r.inputTokens ?? null, r.outputTokens ?? null, r.costUsdMicros ?? 0],
        );
    }

    /** 지문 원문 — 이미 있으면 last_seen 만 갱신. */
    async upsertFingerprint(hash: string, kind: 'prompt_static' | 'tool_manifest', content: string, appVersion?: string): Promise<void> {
        await this.query(
            `INSERT INTO prompt_fingerprints (hash, kind, content, app_version) VALUES ($1, $2, $3, $4)
             ON CONFLICT (hash) DO UPDATE SET last_seen = NOW()`,
            [hash, kind, content, appVersion ?? null],
        );
    }

    /** 보존 정리 — 오래된 요청 행과, 그 뒤로 쓰이지 않은 지문. */
    async purge(retentionDays: number, fingerprintRetentionDays: number): Promise<{ requests: number; fingerprints: number }> {
        const r = await this.query('DELETE FROM chat_requests WHERE started_at < NOW() - make_interval(days => $1)', [retentionDays]);
        const f = await this.query('DELETE FROM prompt_fingerprints WHERE last_seen < NOW() - make_interval(days => $1)', [fingerprintRetentionDays]);
        return { requests: r.rowCount ?? 0, fingerprints: f.rowCount ?? 0 };
    }

    /** ops_metrics `prompt_versions` — 정적 지문별 요청 수·오류율·TTFT p50(기간). */
    async promptVersions(hours: number, limit: number): Promise<Array<{ prompt_static_hash: string | null; requests: number; error_rate: number; ttft_p50_ms: number | null; models: string[]; first_seen: string; last_seen: string }>> {
        const r = await this.query<{ prompt_static_hash: string | null; requests: string; error_rate: string; ttft_p50_ms: string | null; models: string[]; first_seen: string; last_seen: string }>(
            `SELECT prompt_static_hash, COUNT(*)::text AS requests,
                    ROUND(AVG(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::numeric, 4)::text AS error_rate,
                    (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ttft_ms))::int::text AS ttft_p50_ms,
                    ARRAY_AGG(DISTINCT model) FILTER (WHERE model IS NOT NULL) AS models,
                    MIN(started_at)::text AS first_seen, MAX(started_at)::text AS last_seen
               FROM chat_requests WHERE started_at > NOW() - make_interval(hours => $1)
              GROUP BY prompt_static_hash ORDER BY COUNT(*) DESC LIMIT $2`,
            [hours, limit],
        );
        return r.rows.map((x) => ({ ...x, requests: Number(x.requests), error_rate: Number(x.error_rate), ttft_p50_ms: x.ttft_p50_ms === null ? null : Number(x.ttft_p50_ms) }));
    }
}
