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
