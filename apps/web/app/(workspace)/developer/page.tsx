"use client";

import { useEffect, useState } from "react";
import { ScrollText, KeyRound, MessageSquare, Sparkles } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";

interface QuickStartStep {
  step: number;
  title: string;
  description: string;
  code?: string;
}

interface QuickStartData {
  steps?: QuickStartStep[];
  baseUrl?: string;
}

const DEFAULT_STEPS: QuickStartStep[] = [
  {
    step: 1,
    title: "API 키 발급",
    description: "설정 > API 키 페이지에서 새 API 키를 생성합니다.",
    code: `# API 키를 HTTP 헤더에 포함
Authorization: Bearer <YOUR_API_KEY>`,
  },
  {
    step: 2,
    title: "채팅 완성 요청",
    description: "OpenAI 호환 /v1/chat/completions 엔드포인트에 요청을 보냅니다.",
    code: `curl -X POST https://your-instance/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "안녕하세요!"}]
  }'`,
  },
  {
    step: 3,
    title: "스트리밍 응답",
    description: "stream: true 를 추가하면 SSE 스트림으로 토큰을 실시간 수신합니다.",
    code: `curl -X POST https://your-instance/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"default","messages":[...],"stream":true}'`,
  },
];

export default function DeveloperPage() {
  const [steps, setSteps] = useState<QuickStartStep[]>(DEFAULT_STEPS);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<{ data?: QuickStartData } & QuickStartData>(
          "/api/docs/quickstart",
        );
        const payload: QuickStartData = res.data ?? res;
        if (!alive) return;
        if (payload.steps && payload.steps.length > 0) {
          setSteps(payload.steps);
        }
      } catch {
        /* 기본 목업 유지 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="개발자 문서"
        description="OpenMake LLM API를 통합하고 자동화합니다."
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* API 기본 정보 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-accent" />
              <CardTitle>API 기본 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-medium text-fg-2">Base URL</p>
                <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                  {`https://your-instance.example.com`}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-2">API 버전</p>
                <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                  {`/v1  — OpenAI 호환 엔드포인트\n/api — OpenMake 전용 엔드포인트`}
                </pre>
              </div>
              <p className="text-sm text-fg-2">
                OpenMake LLM API는 OpenAI Chat Completions API와 호환됩니다.
                기존 OpenAI SDK를 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">baseURL</code>만
                변경하여 바로 사용할 수 있습니다.
              </p>
            </CardContent>
          </Card>

          {/* 인증 방식 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-accent" />
              <CardTitle>인증 방식</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-fg">API Key 인증</p>
                <p className="mb-2 text-sm text-fg-2">
                  설정 {">"} API 키 페이지에서 발급한 키를 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">Authorization</code> 헤더에 전달합니다.
                </p>
                <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                  {`Authorization: Bearer om_live_xxxxxxxxxxxxxxxx`}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-fg">JWT 세션 인증</p>
                <p className="mb-2 text-sm text-fg-2">
                  브라우저 세션은 HttpOnly 쿠키에 저장된 JWT를 자동으로 사용합니다.
                  API 직접 호출 시에는 API Key를 권장합니다.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 모델 목록 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <CardTitle>모델 목록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-fg-2">
                사용 가능한 모델 목록은 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">GET /api/models</code>로 조회하거나,
                채팅 페이지의 모델 선택기를 참고하세요.
              </p>
              <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                {`curl https://your-instance/api/models \\
  -H "Authorization: Bearer <YOUR_API_KEY>"`}
              </pre>
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <p className="mb-2 text-xs font-medium text-fg-2">브랜드 모델 ID</p>
                <div className="grid grid-cols-2 gap-1 text-xs font-mono text-muted">
                  {[
                    ["default", "기본 모델"],
                    ["pro", "고성능 모델"],
                    ["fast", "빠른 응답"],
                    ["think", "추론 모드"],
                    ["code", "코드 특화"],
                    ["vision", "이미지 지원"],
                  ].map(([id, label]) => (
                    <div key={id} className="flex gap-2">
                      <span className="text-accent">{id}</span>
                      <span className="text-faint">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Start */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-accent" />
              <CardTitle>Quick Start</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {steps.map((s) => (
                <div key={s.step}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                      {s.step}
                    </span>
                    <p className="text-sm font-semibold text-fg">{s.title}</p>
                  </div>
                  <p className="mb-2 text-sm text-fg-2">{s.description}</p>
                  {s.code && (
                    <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                      {s.code}
                    </pre>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
