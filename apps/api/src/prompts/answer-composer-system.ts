/**
 * ============================================================
 * Answer Composer System Prompt — 구조화 출력 지시
 * ============================================================
 *
 * 제안서(2026-06-26) 5절 Developer Prompt + 4절 JSON 구조화 출력 지시.
 * Response Formatter Layer(services/answer-composer) 가 비스트리밍 LLM 호출 시
 * 사용하는 system prompt. 모델이 StructuredAnswer JSON 스키마에 맞춰 답하도록 유도.
 *
 * 품질 기준(제안서 7.2): 결론 우선·문단 절제·표 활용·권고안 우선·실행항목 분리.
 *
 * @module prompts/answer-composer-system
 */
import type { AnswerIntent } from '../schemas/structured-answer.schema';

const BODY: Record<'ko' | 'en', string> = {
    ko: `당신은 답변을 JSON 구조로 작성하는 어시스턴트입니다. 반드시 주어진 JSON 스키마에 맞는 객체 하나만 출력하고, 그 외 텍스트(설명·마크다운 펜스)는 출력하지 않습니다.

## 작성 품질 기준
- conclusion(결론)을 가장 먼저, 한두 문장으로 명확히 제시한다.
- 각 섹션 body 의 한 문단은 3문장을 넘지 않는다. 같은 의미를 반복하지 않는다.
- 비교 가능한 항목은 sections[].table 로 정리한다(headers + rows).
- 의사결정 질문이면 conclusion 에 권고안 하나를 먼저 제시한 뒤 근거를 sections 에 둔다.
- 실행이 필요하면 action_items 로 분리한다. 위험·주의는 risks 로 분리한다.
- confidence 는 근거의 확실성에 따라 high/medium/low 로 정직하게 표기한다.
- title 은 질문을 요약하는 짧은 제목. 불확실한 사실은 추측하지 말고 confidence 를 낮춘다.`,
    en: `You are an assistant that writes answers as a JSON object. Output exactly one object matching the given JSON schema and nothing else (no prose, no markdown fences).

## Quality bar
- Put the conclusion first, in one or two clear sentences.
- Keep each paragraph in a section body to three sentences or fewer. Do not repeat points.
- Put comparable items into sections[].table (headers + rows).
- For decision questions, give one recommendation first in conclusion, with rationale in sections.
- Separate actionable steps into action_items, and warnings into risks.
- Set confidence honestly to high/medium/low based on the certainty of evidence.
- title is a short summary of the question. Do not guess unverifiable facts; lower confidence instead.`,
};

const INTENT_HINT: Record<'ko' | 'en', string> = {
    ko: '\n\n분류된 답변 유형(intent): ',
    en: '\n\nClassified answer intent: ',
};

/**
 * 시간 컨텍스트 — 모델이 지식 컷오프(2024-12)를 "현재"로 착각하지 않도록 현재 날짜를 명시.
 * (일반 파이프라인의 createDynamicMetadata + 지식 기준일 가드 동등. 구조화 경로는 base prompt 를
 *  거치지 않아 이 가드가 누락되어 "현재가 2024년" 오인식이 발생했음.)
 */
function temporalContext(lang: 'ko' | 'en', currentDate: string): string {
    return lang === 'ko'
        ? `\n\n## ⏱️ 시간 컨텍스트\n- 오늘 날짜는 ${currentDate} 입니다. "현재/올해/최근" 은 이 날짜를 기준으로 판단하세요.\n- 당신의 학습 지식 기준일은 2024년 12월입니다. 그 이후의 사건·인물·통계는 아래 제공된 검색 결과에 근거하고, 검색 결과가 없으면 추측하지 말고 confidence 를 낮추세요.\n- 검색 결과(웹 컨텍스트)가 제공되면 그것을 최신 사실의 근거로 우선하세요.`
        : `\n\n## ⏱️ Temporal context\n- Today's date is ${currentDate}. Interpret "current/this year/recent" relative to this date.\n- Your training knowledge cutoff is December 2024. For events/people/statistics after that, rely on the search results provided below; if none are provided, do not guess — lower confidence instead.\n- When web context (search results) is provided, prefer it as the source of up-to-date facts.`;
}

/**
 * Answer Composer system prompt 빌드. 분류된 intent + 현재 날짜를 모델에 전달.
 * @param currentDate ISO date (YYYY-MM-DD). 미지정 시 호출 시점 날짜.
 */
export function buildAnswerComposerSystemPrompt(intent: AnswerIntent, userLanguage: string, currentDate?: string): string {
    const lang = userLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
    const date = currentDate || new Date().toISOString().split('T')[0];
    return `${BODY[lang]}${temporalContext(lang, date)}${INTENT_HINT[lang]}${intent}`;
}

/** Validator 실패 시 1회 재시도에 덧붙이는 교정 지시. */
export function getRepairHint(userLanguage: string): string {
    const lang = userLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
    return lang === 'ko'
        ? '직전 출력이 JSON 스키마를 벗어났습니다. 마크다운 펜스 없이 스키마에 맞는 JSON 객체 하나만 다시 출력하세요.'
        : 'The previous output did not match the JSON schema. Output exactly one schema-conformant JSON object again, with no markdown fences.';
}
