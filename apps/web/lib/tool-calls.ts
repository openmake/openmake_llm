/**
 * 채팅의 도구 호출 목록 — 답변 한 번에 모델이 부른 도구를 순서대로 쌓아 카드로 보여 준다.
 * 서버가 `mcp_tool_start`(시작)와 `mcp_tool_result.summary`(성공·실패, 걸린 시간, 인자·결과 앞부분)를 보낸다.
 * 순수 함수 — 상태는 store(turnToolCalls, 메시지의 toolCalls)가 쥔다.
 */

export interface ToolCallView {
  toolName: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  /** 인자 요약(JSON, 서버가 가리고 자름) */
  args?: string;
  /** 결과 앞부분(서버가 자름) */
  preview?: string;
}

export interface ToolCallSummary {
  ok: boolean;
  durationMs: number;
  args?: string;
  preview?: string;
}

export function startToolCall(calls: ToolCallView[], toolName: string): ToolCallView[] {
  return [...calls, { toolName, status: "running" }];
}

/** 같은 이름의 실행 중 항목 중 가장 먼저 시작한 것을 닫는다. 없으면(시작 이벤트 유실) 끝난 항목으로 붙인다. */
export function finishToolCall(calls: ToolCallView[], toolName: string, summary?: ToolCallSummary): ToolCallView[] {
  const done: ToolCallView = {
    toolName,
    status: summary && !summary.ok ? "error" : "done",
    ...(summary ? { durationMs: summary.durationMs } : {}),
    ...(summary?.args ? { args: summary.args } : {}),
    ...(summary?.preview ? { preview: summary.preview } : {}),
  };
  const i = calls.findIndex((c) => c.toolName === toolName && c.status === "running");
  return i < 0 ? [...calls, done] : calls.map((c, j) => (j === i ? done : c));
}

/** 답변이 끝났는데 남은 실행 중 항목을 닫는다 — 결과를 받지 못한 호출이다(중단·오류). */
export function settleToolCalls(calls: ToolCallView[]): ToolCallView[] {
  return calls.map((c) => (c.status === "running" ? { ...c, status: "error" as const } : c));
}
