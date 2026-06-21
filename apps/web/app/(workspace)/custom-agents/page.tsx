"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Pencil, Trash, GitBranch } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 ────────────────────────────────────────────────── */
interface CustomAgent {
  id: string;
  emoji: string;
  name: string;
  description: string;
  systemPrompt: string;
  source: "git" | "custom";
}

/* ── 백엔드 응답 타입 (GET /api/users/me/agents → res.data.agents) ── */
interface ApiUserAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  icon: string | null;
}

type UserAgentsResponse = ApiSuccess<{ agents: ApiUserAgent[] }>;

function mapAgent(a: ApiUserAgent): CustomAgent {
  return {
    id: a.id,
    emoji: a.icon || "🤖",
    name: a.name,
    description: a.description || "설명이 없습니다.",
    systemPrompt: a.system_prompt,
    // 백엔드 user_agents 에는 git/custom 출처 구분 컬럼이 없음 — 모두 custom 으로 표기
    source: "custom",
  };
}

/* ── 목업 데이터 — 미인증/네트워크 실패 시 폴백 ─────────────── */
const AGENTS: CustomAgent[] = [
  {
    id: "a1",
    emoji: "📐",
    name: "기술 문서 작성가",
    description: "API 레퍼런스와 아키텍처 문서를 일관된 톤으로 작성합니다.",
    systemPrompt:
      "당신은 시니어 테크니컬 라이터입니다. 명료하고 구조적인 한국어 문서를 작성하며, 코드 예시를 적극 포함합니다...",
    source: "custom",
  },
  {
    id: "a2",
    emoji: "🧪",
    name: "코드 리뷰어",
    description: "변경된 코드의 버그와 단순화 기회를 집어냅니다.",
    systemPrompt:
      "당신은 까다로운 코드 리뷰어입니다. 정확성 버그를 우선하고, 재사용/단순화 개선점을 신뢰도 순으로 제시합니다...",
    source: "git",
  },
  {
    id: "a3",
    emoji: "📊",
    name: "데이터 분석가",
    description: "데이터셋을 해석하고 인사이트를 도출합니다.",
    systemPrompt:
      "당신은 데이터 분석 전문가입니다. 통계적으로 타당한 해석을 제공하며, 시각화 제안을 함께 합니다...",
    source: "custom",
  },
];

export default function CustomAgentsPage() {
  const [agents, setAgents] = useState<CustomAgent[]>(AGENTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<UserAgentsResponse>(
          "/api/users/me/agents",
        );
        if (cancelled) return;
        setAgents((res?.data?.agents ?? []).map(mapAgent));
      } catch {
        // 401·네트워크 실패: 목업 폴백 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="커스텀 에이전트"
        description="나만의 시스템 프롬프트로 특화된 에이전트를 정의합니다."
        actions={
          <>
            <Button variant="outline" size="sm">
              <GitBranch className="h-4 w-4" />
              Git URL 에서 가져오기
            </Button>
            <Button size="sm">
              <Plus className="h-4 w-4" />새 에이전트
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Bot className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Bot className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">
              아직 커스텀 에이전트가 없습니다
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              직접 만들거나 Git URL 에서 가져와 특화된 에이전트를 추가하세요.
            </p>
            <Button size="sm" className="mt-4">
              <Plus className="h-4 w-4" />새 에이전트 만들기
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <Card key={agent.id} className="flex flex-col p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-xl">
                    {agent.emoji}
                  </div>
                  {agent.source === "git" && (
                    <Badge tone="neutral">
                      <GitBranch className="h-3 w-3" />
                      git
                    </Badge>
                  )}
                </div>

                <h3 className="mb-1 text-sm font-semibold text-fg">
                  {agent.name}
                </h3>
                <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted">
                  {agent.description}
                </p>

                <div className="mb-4 flex-1 rounded-md border border-border bg-surface-2 p-3">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-faint">
                    시스템 프롬프트
                  </p>
                  <p className="line-clamp-3 text-xs leading-relaxed text-fg-2">
                    {agent.systemPrompt}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Pencil className="h-3.5 w-3.5" />
                    편집
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="삭제">
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
