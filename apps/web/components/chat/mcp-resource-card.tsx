"use client";

import { useState } from "react";
import { ChevronDown, Package } from "lucide-react";
import type { McpToolResource } from "@openmake/shared-types";

/**
 * MCP 도구 결과의 resource content 를 채팅 타임라인에 렌더하는 접이식 카드.
 *
 * WS 계약상 resources 를 담을 store 필드가 없어(채팅 메시지에 구조화 필드를 추가하지
 * 않는다), 페이로드를 sentinel 프리픽스 + JSON 으로 system(notice) 메시지 content 에
 * 실어 나른다. notice:true 라 히스토리 payload 에는 제외되고(백엔드로 새지 않음),
 * message-list 가 프리픽스를 감지해 이 카드로 렌더한다.
 */
const MCP_RESOURCE_MARK = "mcpres:";

export interface McpResourcePayload {
  toolName: string;
  resources: McpToolResource[];
}

export function encodeMcpResources(payload: McpResourcePayload): string {
  return MCP_RESOURCE_MARK + JSON.stringify(payload);
}

export function decodeMcpResources(content: string): McpResourcePayload | null {
  if (!content.startsWith(MCP_RESOURCE_MARK)) return null;
  try {
    const parsed = JSON.parse(content.slice(MCP_RESOURCE_MARK.length)) as McpResourcePayload;
    if (!parsed || !Array.isArray(parsed.resources)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const TEXT_CAP = 600;

/** resource uri 의 마지막 세그먼트(가독 라벨용). */
function resourceLabel(uri: string): string {
  const trimmed = uri.replace(/\/+$/, "");
  const seg = trimmed.split("/").pop();
  return seg && seg.length > 0 ? seg : uri;
}

export function McpResourceCard({ payload }: { payload: McpResourcePayload }) {
  const [open, setOpen] = useState(false);
  const count = payload.resources.length;
  return (
    <div className="w-full max-w-full overflow-hidden rounded-lg border border-border bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-fg-2 hover:bg-surface-2"
      >
        <Package className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono text-fg">{payload.toolName}</span>
          <span className="ml-1.5 text-muted">· {count}개 리소스 / {count} resource{count === 1 ? "" : "s"}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {payload.resources.map((r, i) => (
            <div key={`${r.uri}-${i}`} className="space-y-1">
              <p className="break-all font-mono text-[11px] text-muted">{resourceLabel(r.uri)}</p>
              {r.text && (
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed text-fg-2">
                  {r.text.length > TEXT_CAP ? `${r.text.slice(0, TEXT_CAP)}…` : r.text}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
