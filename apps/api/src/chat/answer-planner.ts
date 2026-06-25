/**
 * ============================================================
 * Answer Planner — 답변 유형(AnswerIntent) 분류
 * ============================================================
 *
 * 제안서(2026-06-26) 3절 "가장 먼저 넣어야 할 기능: Answer Planner".
 * 사용자 질문을 받아 답변 유형을 먼저 분류한다. 분류 결과는 구조화 출력
 * (StructuredAnswer.intent) 와 Response Formatter Layer 의 system prompt 조립에
 * 사용된다.
 *
 * 구현: cross-cutting intent(decision/comparison/troubleshooting 등)는 키워드
 * 가중치(config/data/answer-intent-patterns.json)로 우선 식별하고, 미달 시 기존
 * detectPromptType(regex 분류기) 결과를 promptTypeFallback 으로 매핑한다.
 * (No-Hardcoding: 패턴 인라인 금지 — JSON 외부화, prompt-type-patterns.json 과 동일 패턴.)
 *
 * @module chat/answer-planner
 */
import patternsData from '../config/data/answer-intent-patterns.json';
import { detectPromptType } from './prompt-templates';
import type { PromptType } from './prompt-templates';
import type { AnswerIntent } from '../schemas/structured-answer.schema';

interface IntentKeyword { pattern: RegExp; weight: number; }
interface IntentConfig { intent: AnswerIntent; priority: number; keywords: IntentKeyword[]; }

// 모듈 로드 시 1회 컴파일 (prompt-templates.ts 와 동일 패턴).
const INTENT_CONFIGS: IntentConfig[] = patternsData.intentConfigs.map((c) => ({
    intent: c.intent as AnswerIntent,
    priority: c.priority,
    keywords: c.keywords.map((k) => ({ pattern: new RegExp(k.source, k.flags), weight: k.weight })),
}));
const MIN_SCORE: number = patternsData.minScore;
const PROMPT_TYPE_FALLBACK = patternsData.promptTypeFallback as Record<PromptType, AnswerIntent>;
const DEFAULT_INTENT: AnswerIntent = 'explanation';

/**
 * 답변 유형 분류. 키워드 가중치 우선 → 미달 시 detectPromptType 매핑.
 */
export function classifyAnswerIntent(message: string): AnswerIntent {
    const lowerQ = (message || '').toLowerCase();

    const scored = INTENT_CONFIGS.map((c) => {
        let score = 0;
        for (const kw of c.keywords) {
            if (kw.pattern.test(lowerQ)) score += kw.weight;
        }
        return { intent: c.intent, score, priority: c.priority };
    });
    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.priority - a.priority));

    if (scored[0] && scored[0].score >= MIN_SCORE) {
        return scored[0].intent;
    }

    // Fallback: 기존 regex 분류기 재사용 (신규 classifier 도입 금지).
    const promptType = detectPromptType(message || '');
    return PROMPT_TYPE_FALLBACK[promptType] ?? DEFAULT_INTENT;
}
