/**
 * ask_human 구조화 질문 — 질문 여러 개와 선택지·권장안을 한 호출로 받는다.
 *
 * 종전에는 질문 문자열 하나뿐이라, 물을 것이 여럿이면 모델이 호출을 나눠 사용자를 여러 번 멈춰 세우거나
 * 한 문장에 뭉쳐 넣어 답하기 어려웠다. `questions` 로 받은 구조는 승인 항목 인자에 그대로 실어 웹 질문 카드가
 * 선택지를 버튼으로 보여 주고, 같은 내용을 줄글로 엮어 `question` 에도 넣는다 — 구조를 모르는 클라이언트
 * (CLI·iOS)와 모델에 돌아가는 결과 문구는 그 줄글을 쓴다. 답변 채널은 종전과 같은 글 하나다.
 *
 * @module services/task-sandbox/ask-human
 */
import { ASK_HUMAN } from '../../config/agent-task-tools';
import { ASK_HUMAN_ARG_DESCRIPTIONS, formatAskHumanLine } from '../../prompts/agent-task-tools';

export interface AskHumanQuestion {
    question: string;
    options?: string[];
    /** options 중 하나. */
    recommended?: string;
}

interface AskHumanArgs extends Record<string, unknown> {
    /** 줄글 질문 — 구조가 있으면 질문·선택지를 엮은 것. */
    question: string;
    /** 구조(선택지가 있거나 질문이 둘 이상일 때만). */
    questions?: AskHumanQuestion[];
    /** 모델이 question 과 questions 를 함께 보냈을 때의 question — 질문들 앞의 설명. */
    intro?: string;
}

/** 도구 인자 스키마(구조화 질문). 끄면 tools.ts 의 종전 스키마(question 하나)를 쓴다. */
export const ASK_HUMAN_STRUCTURED_SCHEMA = {
    type: 'object' as const,
    properties: {
        question: { type: 'string', description: ASK_HUMAN_ARG_DESCRIPTIONS.question },
        questions: {
            type: 'array',
            description: ASK_HUMAN_ARG_DESCRIPTIONS.questions,
            items: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: ASK_HUMAN_ARG_DESCRIPTIONS.itemQuestion },
                    options: { type: 'array', items: { type: 'string' }, description: ASK_HUMAN_ARG_DESCRIPTIONS.options },
                    recommended: { type: 'string', description: ASK_HUMAN_ARG_DESCRIPTIONS.recommended },
                },
                required: ['question'],
            },
        },
    },
    required: [] as string[],
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function parseQuestion(raw: unknown): AskHumanQuestion | null {
    if (typeof raw === 'string') return raw.trim() ? { question: raw.trim() } : null;
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const question = text(r.question);
    if (!question) return null;
    const options = (Array.isArray(r.options) ? r.options : [])
        .map(text).filter((o) => o.length > 0)
        .map((o) => o.slice(0, ASK_HUMAN.OPTION_MAX_CHARS))
        .slice(0, ASK_HUMAN.MAX_OPTIONS);
    const recommended = text(r.recommended);
    return {
        question,
        ...(options.length > 0 ? { options } : {}),
        ...(recommended && options.includes(recommended) ? { recommended } : {}),
    };
}

/**
 * PURE: 모델이 보낸 인자 → 승인 항목에 실을 인자. 같은 입력이면 같은 결과다(재개 때 같은 호출로 다시 요청된다).
 * 구조로 쓸 것이 없으면(질문 하나에 선택지 없음 포함) 종전과 같은 `{ question }` 이다.
 */
export function normalizeAskHuman(args: Record<string, unknown>, structured: boolean = ASK_HUMAN.STRUCTURED_ENABLED): AskHumanArgs {
    // 그 밖의 인자는 그대로 둔다 — 승인 항목은 인자 해시로 같은 호출을 알아본다(배포 전에 주차된 질문 포함).
    const { questions: rawQuestions, ...rest } = args;
    const intro = typeof args.question === 'string' ? args.question : '';
    const questions = structured && Array.isArray(rawQuestions)
        ? rawQuestions.map(parseQuestion).filter((q): q is AskHumanQuestion => q !== null).slice(0, ASK_HUMAN.MAX_QUESTIONS)
        : [];
    if (questions.length === 0) return { ...rest, question: intro };
    if (questions.length === 1 && !questions[0].options && !intro.trim()) return { ...rest, question: questions[0].question };
    const lines = questions.map((q, i) => formatAskHumanLine(q.question, q.options ?? [], q.recommended, questions.length > 1 ? i + 1 : null));
    const head = intro.trim();
    return { ...rest, question: [head, ...lines].filter((l) => l.length > 0).join('\n'), questions, ...(head ? { intro: head } : {}) };
}
