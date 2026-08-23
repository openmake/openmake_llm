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
import { buildAnswerComposerSystemPrompt, getRepairHint, getLengthRepairHint } from '../prompts/answer-composer-system';
import type { ChatMessage, FormatOption } from '../llm/types';

const logger = createLogger('AnswerComposer');

/** 주입되는 LLM 호출 함수 — (messages, json_schema) → raw content. 비스트리밍. */
/**
 * 구조화 답변용 1회 LLM 호출. `format` 이 undefined 면 **스키마 강제 없이** 호출한다
 * (guided decoding 미지원 백엔드로의 degrade 경로 — 외부 provider 경로는 원래 format 을 무시한다).
 */
export type StructuredChatFn = (
    messages: ChatMessage[],
    format?: FormatOption,
) => Promise<string | { text: string; truncated: boolean }>;

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
/** degrade 시 title 로 쓸 원 질문 길이 상한 — 제목이 본문처럼 길어지지 않게. */
const MAX_FALLBACK_TITLE_CHARS = 80;

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * 백엔드가 response_format(json_schema/guided decoding)을 거절한 오류인가.
 * 백엔드마다 문구가 달라 보수적으로 키워드 매칭한다 — 오탐이 나도 스키마 없이 한 번 더
 * 호출할 뿐이라 손해가 작고, 미탐이면 기존처럼 예외가 그대로 전파된다.
 */
function isFormatUnsupportedError(e: unknown): boolean {
    const msg = errText(e).toLowerCase();
    if (!/\b(400|422|unsupported|not support|invalid[_ ]request)\b/.test(msg)) return false;
    return /response_format|json_schema|guided|structured output|schema/.test(msg);
}

function parseStructured(raw: string): unknown {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(trimmed);
}

export interface ComposeResult {
    intent: AnswerIntent;
    structured: StructuredAnswer;
    markdown: string;
    /**
     * 정상 경로가 아니면 그 사유. 관측·로그용이며 응답은 정상 반환된다.
     *  - `format_unsupported`: 백엔드가 json_schema(guided decoding)를 거절 → 스키마 없이 재시도
     *  - `schema_invalid`: 2회 시도 후에도 스키마 불일치 → 평문 답변을 최소 구조로 감싸 반환
     */
    degraded?: 'format_unsupported' | 'schema_invalid';
}

/**
 * 구조화 답변 합성. Answer Planner → Generator → Validator → Response Formatter.
 * Validator 실패 시 교정 힌트로 1회 재시도, 그래도 실패면 422.
 */
export async function composeStructuredAnswer(opts: {
    message: string;
    userLanguage?: string;
    chat: StructuredChatFn;
    /** 웹검색 결과 컨텍스트 (있으면 user 메시지에 합류 — 최신 사실 근거). */
    webContext?: string;
    /** 현재 날짜(YYYY-MM-DD). 미지정 시 호출 시점. 모델의 2024 컷오프 오인식 방지. */
    currentDate?: string;
}): Promise<ComposeResult> {
    const lang = (opts.userLanguage || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
    const intent = classifyAnswerIntent(opts.message);
    const system = buildAnswerComposerSystemPrompt(intent, lang, opts.currentDate);

    // 웹검색 컨텍스트가 있으면 user 메시지에 합류 (buildContextForLLM 과 동일 정책).
    const userContent = opts.webContext
        ? `${opts.message}${opts.webContext}`
        : opts.message;

    const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
    ];

    let degraded: ComposeResult['degraded'];

    /**
     * 1회 시도. 백엔드가 json_schema 를 거절하면(guided decoding 미지원) **스키마 없이**
     * 한 번 더 호출한다 — 외부 provider 경로가 원래 그렇게 동작하므로 프롬프트만으로도
     * 유효 JSON 이 나올 수 있다. 이 경로를 타면 degraded 사유를 남긴다.
     */
    const asText = (r: Awaited<ReturnType<StructuredChatFn>>) =>
        typeof r === 'string' ? { text: r, truncated: false } : r;

    /** 직전 시도가 **길이 상한**에 걸려 잘렸는지 — 재시도 힌트를 고르는 데 쓴다. */
    let lastTruncated = false;

    const attempt = async (msgs: ChatMessage[]): Promise<StructuredAnswer | null> => {
        let raw: { text: string; truncated: boolean };
        try {
            raw = asText(await opts.chat(msgs, STRUCTURED_ANSWER_FORMAT));
        } catch (e) {
            if (!isFormatUnsupportedError(e)) throw e;
            logger.warn(`백엔드가 json_schema 를 거절 — 스키마 없이 재시도: ${errText(e).slice(0, 160)}`);
            degraded = 'format_unsupported';
            raw = asText(await opts.chat(msgs));
        }
        lastTruncated = raw.truncated;
        let parsed: unknown;
        try {
            parsed = parseStructured(raw.text);
        } catch {
            logger.warn(`구조화 출력 JSON 파싱 실패${raw.truncated ? ' (길이 상한으로 잘림)' : ''}`);
            return null;
        }
        const result = StructuredAnswerSchema.safeParse(parsed);
        return result.success ? result.data : null;
    };

    let structured = await attempt(messages);
    if (!structured) {
        // 1회 재시도 — 실패 원인에 맞는 힌트를 고른다.
        //  · 길이 상한으로 잘렸으면 스키마를 다시 설명해봐야 소용없다 → **짧게 쓰라**고 지시한다.
        //  · 그 외(스키마 불일치)는 기존 교정 힌트.
        // 힌트는 **user** 로 덧붙인다 — 일부 chat_template(qwen 등)은 system 이 맨 앞에만
        // 오는 것을 강제해, 뒤에 붙이면 400 "System message must be at the beginning" 이 난다
        // (실측 2026-08-24: 이 경로가 500 으로 새어나갔다).
        const hint = lastTruncated ? getLengthRepairHint(lang) : getRepairHint(lang);
        structured = await attempt([...messages, { role: 'user', content: hint }]);
    }

    if (!structured) {
        // 최후 degrade — 스키마를 못 맞추는 모델이라도 **답은 준다**. 평문 1회 호출 결과를
        // 최소 구조로 감싼다(confidence=low: 구조 검증을 통과하지 못했음을 정직하게 표기).
        // 여기서도 내용이 없을 때만 422 로 실패한다.
        logger.warn('구조화 2회 실패 — 평문 답변으로 degrade');
        const plain = asText(await opts.chat(messages)).text.trim();
        if (!plain) {
            throw new AppError('구조화 답변 검증 실패 (스키마 불일치)', 422, true, 'STRUCTURED_OUTPUT_INVALID');
        }
        degraded = 'schema_invalid';
        structured = {
            intent,
            title: opts.message.slice(0, MAX_FALLBACK_TITLE_CHARS),
            conclusion: plain,
            summary: '',
            sections: [],
            confidence: 'low',
        };
    }

    const finalAnswer: StructuredAnswer = structured;

    return {
        intent,
        structured: finalAnswer,
        markdown: formatAnswer(finalAnswer, lang),
        ...(degraded ? { degraded } : {}),
    };
}
