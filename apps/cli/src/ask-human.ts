/**
 * ask_human 구조화 질문 — 터미널 표시·입력 해석 (순수 함수, I/O 없음).
 *
 * 서버(`services/task-sandbox/ask-human.ts`)는 질문 여러 개·선택지·권장안을 승인 항목 인자의 `questions` 에 싣고,
 * 같은 내용을 줄글로 엮어 `question` 에도 넣는다. CLI 는 승인 대기 목록(REST)으로 그 인자를 그대로 받는다.
 * 구조가 있으면 번호 목록으로 보여 주고 번호 입력으로 고르게 한다. 없으면(옛 서버·질문 하나) 호출부가 종전 표시를 쓴다.
 * 웹 `apps/web/lib/hitl-question.ts` 와 짝 — 답변 글의 모양이 같아야 모델이 같은 결과를 받는다.
 */

export interface StructuredQuestion {
    question: string;
    options?: string[];
    /** options 중 하나. */
    recommended?: string;
}

const TEXT = {
    recommended: ' (권장)',
    hintOptions: (n: number) => `번호(1-${n}) 또는 직접 입력`,
    hintRecommended: ', Enter=권장안',
    hintFree: '답변 입력',
    needAnswer: '답을 입력하세요.',
    outOfRange: (n: number) => `1-${n} 사이의 번호를 고르거나 답을 직접 입력하세요.`,
} as const;

/** 터미널 제어 문자(ESC·BEL 등)를 지운다 — 질문·선택지는 모델이 쓴 글이다. 줄바꿈·탭은 둔다. */
function clean(s: string): string {
    return s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/** 승인 인자의 `questions` 를 읽는다. 없거나 모양이 다르면 null. */
export function structuredQuestions(toolName: string, args?: unknown): { intro: string; questions: StructuredQuestion[] } | null {
    const a = args as { questions?: unknown; intro?: unknown } | null | undefined;
    if (toolName !== 'ask_human' || !a || !Array.isArray(a.questions)) return null;
    const questions: StructuredQuestion[] = [];
    for (const raw of a.questions) {
        const r = raw as { question?: unknown; options?: unknown; recommended?: unknown } | null;
        if (!r || typeof r.question !== 'string' || !r.question) return null;
        const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string' && o.length > 0) : [];
        questions.push({
            question: r.question,
            ...(options.length > 0 ? { options } : {}),
            ...(typeof r.recommended === 'string' && options.includes(r.recommended) ? { recommended: r.recommended } : {}),
        });
    }
    if (questions.length === 0) return null;
    return { intro: typeof a.intro === 'string' ? a.intro : '', questions };
}

/** 승인 인자의 줄글 질문(`question`) — 구조가 없을 때 보여 준다. */
export function approvalQuestionText(args?: unknown): string {
    const q = (args as { question?: unknown } | null | undefined)?.question;
    return typeof q === 'string' ? clean(q).trim() : '';
}

/** 질문 하나의 표시 글 — 선택지는 번호 목록, 권장안에는 표시. 질문이 여럿이면 순번을 앞에 붙인다. */
export function renderQuestion(q: StructuredQuestion, index: number, total: number): string {
    const head = `${total > 1 ? `[${index + 1}/${total}] ` : ''}${clean(q.question)}`;
    const lines = (q.options ?? []).map((o, i) => `  ${i + 1}) ${clean(o)}${o === q.recommended ? TEXT.recommended : ''}`);
    return [head, ...lines].join('\n');
}

/** 입력 줄 앞의 안내. */
export function renderInputHint(q: StructuredQuestion): string {
    const n = q.options?.length ?? 0;
    if (n === 0) return `${TEXT.hintFree}: `;
    return `${TEXT.hintOptions(n)}${q.recommended ? TEXT.hintRecommended : ''}: `;
}

/** 입력 한 줄 → 답. 번호는 그 선택지, 빈 입력은 권장안, 그 밖의 글은 직접 입력. 답이 안 되면 다시 물을 안내를 돌려준다. */
export function interpretAnswer(q: StructuredQuestion, input: string): { ok: true; answer: string } | { ok: false; message: string } {
    const text = input.trim();
    const options = q.options ?? [];
    if (!text) return q.recommended ? { ok: true, answer: q.recommended } : { ok: false, message: TEXT.needAnswer };
    if (options.length > 0 && /^\d+$/.test(text)) {
        const picked = options[Number(text) - 1];
        return picked !== undefined && Number(text) >= 1 ? { ok: true, answer: picked } : { ok: false, message: TEXT.outOfRange(options.length) };
    }
    return { ok: true, answer: text };
}

/** 질문별 답을 답변 글 하나로 엮는다 — 답변 채널은 글 하나다. 질문이 하나면 답 그대로. */
export function composeAnswer(questions: readonly StructuredQuestion[], picks: readonly string[]): string {
    if (questions.length === 1) return picks[0] ?? '';
    return questions.map((_, i) => (picks[i] ? `${i + 1}) ${picks[i]}` : '')).filter((s) => s.length > 0).join('; ');
}
