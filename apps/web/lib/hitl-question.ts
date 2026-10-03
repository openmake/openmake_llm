/**
 * 질문형 승인(HITL) 판별·표시 보조 — 도구 승인이 아니라 사람의 답을 기다리는 항목.
 *
 * 백엔드 `config/tool-policy.ts` 의 `HITL_ALWAYS_WAIT_TOOLS` 와 짝이다. `mcp_elicit`(F13.10)는 외부 MCP 서버가
 * 도구 실행 중 요청한 입력으로, 인자에 `server`·`question`·`requestedSchema` 가 실린다.
 */
export const HITL_QUESTION_TOOLS: ReadonlySet<string> = new Set(["ask_human", "mcp_elicit"]);

export function isQuestionApproval(toolName: string): boolean {
  return HITL_QUESTION_TOOLS.has(toolName);
}

interface ElicitSchemaLike {
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

/** mcp_elicit 답변 안내 — 서버 이름, 항목 목록(필수는 *), 항목이 둘 이상이면 JSON 예시. 다른 승인은 null. */
export function elicitationHint(
  toolName: string,
  args?: Record<string, unknown>,
): { server: string; fields: string; jsonExample: string | null } | null {
  if (toolName !== "mcp_elicit" || !args) return null;
  const schema = (args.requestedSchema ?? {}) as ElicitSchemaLike;
  const keys = Object.keys(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const example = Object.fromEntries(
    keys.map((k) => [k, schema.properties?.[k]?.type === "string" || !schema.properties?.[k]?.type ? "…" : 0]),
  );
  return {
    server: typeof args.server === "string" ? args.server : "",
    fields: keys.map((k) => (required.has(k) ? `${k}*` : k)).join(", "),
    jsonExample: keys.length > 1 ? JSON.stringify(example) : null,
  };
}

/** 구조화 질문 한 건 — 백엔드 `services/task-sandbox/ask-human.ts` 의 AskHumanQuestion 과 짝이다. */
export interface StructuredQuestion {
  question: string;
  options?: string[];
  /** options 중 하나. */
  recommended?: string;
}

/**
 * ask_human 인자의 `questions`(질문 여러 개·선택지·권장안)를 읽는다. 없거나 모양이 다르면 null —
 * 호출부는 종전처럼 `question` 문자열을 보여 준다(서버가 같은 내용을 줄글로 넣어 둔다).
 */
export function structuredQuestions(
  toolName: string,
  args?: Record<string, unknown>,
): { intro: string; questions: StructuredQuestion[] } | null {
  if (toolName !== "ask_human" || !args || !Array.isArray(args.questions)) return null;
  const questions: StructuredQuestion[] = [];
  for (const raw of args.questions) {
    const r = raw as { question?: unknown; options?: unknown; recommended?: unknown } | null;
    if (!r || typeof r.question !== "string" || !r.question) return null;
    const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string" && o.length > 0) : [];
    questions.push({
      question: r.question,
      ...(options.length > 0 ? { options } : {}),
      ...(typeof r.recommended === "string" && options.includes(r.recommended) ? { recommended: r.recommended } : {}),
    });
  }
  if (questions.length === 0) return null;
  return { intro: typeof args.intro === "string" ? args.intro : "", questions };
}

/** 질문별로 고른 답(질문 순번 → 답)을 답변 글 하나로 엮는다 — 답변 채널은 글 하나다. 질문이 하나면 답 그대로. */
export function composeStructuredAnswer(
  questions: readonly StructuredQuestion[],
  picks: Readonly<Record<number, string>>,
): string {
  if (questions.length === 1) return picks[0] ?? "";
  return questions
    .map((_, i) => (picks[i] ? `${i + 1}) ${picks[i]}` : ""))
    .filter((s) => s.length > 0)
    .join("; ");
}
