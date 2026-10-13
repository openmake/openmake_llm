/**
 * 근거 게이트 기록(186) — 답이 그 턴의 검색 출처에 근거했는지에 대한 의사결정 어댑터 판정의 저장.
 * 답·출처 본문은 저장하지 않는다. 검토는 message_id 로 conversation_messages(본문·sources)와 조인해서 한다.
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
}

export class ChatGroundingGateLogRepository extends BaseRepository {
    async insert(entry: ChatGroundingGateLogEntry): Promise<void> {
        await this.query(
            `INSERT INTO chat_grounding_gate_log
                (user_id, session_id, message_id, p_true, gate_error, gate_ms, gate_model, source_count, answer_chars)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                entry.userId, entry.sessionId, entry.messageId, entry.pTrue,
                entry.gateError === null ? null : entry.gateError.slice(0, GATE_ERROR_MAX_CHARS),
                entry.gateMs, entry.gateModel, entry.sourceCount, entry.answerChars,
            ],
        );
    }
}
