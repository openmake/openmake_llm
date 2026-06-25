/**
 * ============================================================
 * Answer Composer — Response Formatter Layer (비스트리밍 구조화 출력)
 * ============================================================
 *
 * 제안서(2026-06-26) 4·8·10절: LLM 출력을 자유 텍스트가 아니라 JSON Schema 기반
 * 구조화 출력(StructuredAnswer)으로 받은 뒤, 백엔드에서 일정한 마크다운으로 조립한다.
 *
 * 파이프라인:
 *   message → classifyAnswerIntent(Answer Planner)
 *           → LLM(비스트리밍, json_schema strict)  [Generator]
 *           → StructuredAnswerSchema.safeParse      [Validator] (실패 시 1회 재시도)
 *           → formatAnswer()                        [Response Formatter]
 *
 * ⚠️ 스트리밍 기본 경로(message-pipeline)와 별개의 opt-in 레이어. 토큰 스트리밍이
 * 필요 없는(=완성형 카드/리포트) 호출에만 쓴다. LLM 호출 함수는 주입(chat) 받아
 * 순수 함수로 유지 — 테스트 가능.
 *
 * @module services/answer-composer
 */
import { AppError } from '../utils/error-handler';
import { createLogger } from '../utils/logger';
import {
    StructuredAnswerSchema,
    STRUCTURED_ANSWER_FORMAT,
    type StructuredAnswer,
    type AnswerIntent,
} from '../schemas/structured-answer.schema';
import { classifyAnswerIntent } from '../chat/answer-planner';
import { buildAnswerComposerSystemPrompt, getRepairHint } from '../prompts/answer-composer-system';
import type { ChatMessage, FormatOption } from '../llm/types';

const logger = createLogger('AnswerComposer');

/** 주입되는 LLM 호출 함수 — (messages, json_schema) → raw content. 비스트리밍. */
export type StructuredChatFn = (messages: ChatMessage[], format: FormatOption) => Promise<string>;

/**
 * StructuredAnswer → 일정한 마크다운 (제안서 8절 formatAnswer 정확 구현).
 * 결론 → 요약 → 본문 섹션(+표) → 주의할 점 → 다음 실행 순으로 항상 동일 구조.
 */
export function formatAnswer(answer: StructuredAnswer, lang: 'ko' | 'en' = 'ko'): string {
    const L = lang === 'ko'
        ? { conclusion: '결론', summary: '요약', risks: '주의할 점', actions: '다음 실행' }
        : { conclusion: 'Conclusion', summary: 'Summary', risks: 'Risks', actions: 'Next steps' };

    const parts: string[] = [];
    parts.push(`# ${answer.title}`);
    parts.push(`## ${L.conclusion}`);
    parts.push(answer.conclusion);

    if (answer.summary && answer.summary.trim()) {
        parts.push(`## ${L.summary}`);
        parts.push(answer.summary);
    }

    for (const section of answer.sections) {
        parts.push(`## ${section.heading}`);
        if (section.body && section.body.trim()) parts.push(section.body);
        if (section.bullets?.length) {
            parts.push(section.bullets.map((b) => `- ${b}`).join('\n'));
        }
        if (section.table && section.table.headers.length) {
            parts.push(renderTable(section.table.headers, section.table.rows));
        }
    }

    if (answer.risks?.length) {
        parts.push(`## ${L.risks}`);
        parts.push(answer.risks.map((r) => `- ${r}`).join('\n'));
    }
    if (answer.action_items?.length) {
        parts.push(`## ${L.actions}`);
        parts.push(answer.action_items.map((a) => `- ${a}`).join('\n'));
    }

    return parts.join('\n\n');
}

/** 마크다운 GFM 표 렌더 (셀의 파이프는 이스케이프). */
function renderTable(headers: string[], rows: string[][]): string {
    const esc = (s: string) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const head = `| ${headers.map(esc).join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows
        .map((row) => `| ${headers.map((_, i) => esc(row[i] ?? '')).join(' | ')} |`)
        .join('\n');
    return [head, sep, body].filter(Boolean).join('\n');
}

/** json_schema 출력에서 객체를 안전 파싱 (혹시 모를 마크다운 펜스 제거). */
function parseStructured(raw: string): unknown {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(trimmed);
}

export interface ComposeResult {
    intent: AnswerIntent;
    structured: StructuredAnswer;
    markdown: string;
}

/**
 * 구조화 답변 합성. Answer Planner → Generator → Validator → Response Formatter.
 * Validator 실패 시 교정 힌트로 1회 재시도, 그래도 실패면 422.
 */
export async function composeStructuredAnswer(opts: {
    message: string;
    userLanguage?: string;
    chat: StructuredChatFn;
}): Promise<ComposeResult> {
    const lang = (opts.userLanguage || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
    const intent = classifyAnswerIntent(opts.message);
    const system = buildAnswerComposerSystemPrompt(intent, lang);

    const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: opts.message },
    ];

    const attempt = async (msgs: ChatMessage[]): Promise<StructuredAnswer | null> => {
        const raw = await opts.chat(msgs, STRUCTURED_ANSWER_FORMAT);
        let parsed: unknown;
        try {
            parsed = parseStructured(raw);
        } catch {
            logger.warn('구조화 출력 JSON 파싱 실패');
            return null;
        }
        const result = StructuredAnswerSchema.safeParse(parsed);
        return result.success ? result.data : null;
    };

    let structured = await attempt(messages);
    if (!structured) {
        // 1회 재시도 — 교정 힌트 추가.
        structured = await attempt([
            ...messages,
            { role: 'system', content: getRepairHint(lang) },
        ]);
    }
    if (!structured) {
        throw new AppError('구조화 답변 검증 실패 (스키마 불일치)', 422, true, 'STRUCTURED_OUTPUT_INVALID');
    }

    return { intent, structured, markdown: formatAnswer(structured, lang) };
}
