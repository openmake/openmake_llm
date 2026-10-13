/**
 * 근거 게이트 기록(186·187) — 답의 인용 문장이 인용한 출처에 근거했는지에 대한 의사결정 어댑터 판정의 저장.
 * 답·출처 본문은 저장하지 않는다(문장별 결과도 출처 번호와 확률만). 검토는 message_id 로 conversation_messages(본문·sources)와 조인해서 한다.
 *
 * @module data/repositories/chat-grounding-gate-log-repository
 */
import { BaseRepository } from './base-repository';

/** 실패 사유 보관 상한(자) */
const GATE_ERROR_MAX_CHARS = 200;

export interface ChatGroundingGateLogEntry {
    userId: string;
    sessionId: string;
    /** 저장된 답 메시지 id — 정수로 읽히지 않으면 null */
    messageId: number | null;
    pTrue: number | null;
    gateError: string | null;
    gateMs: number;
    gateModel: string | null;
    sourceCount: number;
    answerChars: number;
    /** 판정 방식 — 'claim' = 문장 단위(187). 186 의 답 전체 방식 행은 DB 기본값 'answer' 로 남아 있다 */
    method: 'claim';
    /** 확인한 인용 문장 수 — 0 이면 인용 문장이 없어 판정하지 않은 답 */
    claimCount: number;
    /** 기준(GROUNDING_GATE.LOW_THRESHOLD) 미만으로 나온 문장 수 */
    lowCount: number;
    /** 문장별 결과 — 출처 번호와 확률(판정 실패면 null). 본문 없음 */
    claims: Array<{ n: number; p: number | null }>;
}

export class ChatGroundingGateLogRepository extends BaseRepository {
    async insert(entry: ChatGroundingGateLogEntry): Promise<void> {
        await this.query(
            `INSERT INTO chat_grounding_gate_log
                (user_id, session_id, message_id, p_true, gate_error, gate_ms, gate_model, source_count, answer_chars,
                 method, claim_count, low_count, claims)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
            [
                entry.userId, entry.sessionId, entry.messageId, entry.pTrue,
                entry.gateError === null ? null : entry.gateError.slice(0, GATE_ERROR_MAX_CHARS),
                entry.gateMs, entry.gateModel, entry.sourceCount, entry.answerChars,
                entry.method, entry.claimCount, entry.lowCount, JSON.stringify(entry.claims),
            ],
        );
    }
}
