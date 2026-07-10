"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

const STEP_CODES: Record<number, string> = {
  1: `# Include your API key in the HTTP header
Authorization: Bearer <YOUR_API_KEY>`,
  2: `curl -X POST https://your-instance/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  3: `curl -X POST https://your-instance/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"default","messages":[...],"stream":true}'`,
};

export default function DeveloperPage() {
  const t = useTranslations("developer");

  const defaultSteps: QuickStartStep[] = [
    {
      step: 1,
      title: t("steps.apiKey.title"),
      description: t("steps.apiKey.description"),
      code: STEP_CODES[1],
    },
    {
      step: 2,
      title: t("steps.chatCompletion.title"),
      description: t("steps.chatCompletion.description"),
      code: STEP_CODES[2],
    },
    {
      step: 3,
      title: t("steps.streaming.title"),
      description: t("steps.streaming.description"),
      code: STEP_CODES[3],
    },
  ];

  const [steps, setSteps] = useState<QuickStartStep[]>(defaultSteps);

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
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* API 기본 정보 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-accent" />
              <CardTitle>{t("apiInfo.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-medium text-fg-2">Base URL</p>
                <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                  {`https://your-instance.example.com`}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-2">{t("apiInfo.apiVersionLabel")}</p>
                <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                  {t("apiInfo.versionBlock")}
                </pre>
              </div>
              <p className="text-sm text-fg-2">
                {t.rich("apiInfo.description", {
                  code: (chunks) => (
                    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
                      {chunks}
                    </code>
                  ),
                })}
              </p>
            </CardContent>
          </Card>

          {/* 인증 방식 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-accent" />
              <CardTitle>{t("auth.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-fg">{t("auth.apiKeyTitle")}</p>
                <p className="mb-2 text-sm text-fg-2">
                  {t.rich("auth.apiKeyDesc", {
                    code: (chunks) => (
                      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
                        {chunks}
                      </code>
                    ),
                  })}
                </p>
                <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                  {`Authorization: Bearer om_live_xxxxxxxxxxxxxxxx`}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-fg">{t("auth.jwtTitle")}</p>
                <p className="mb-2 text-sm text-fg-2">
                  {t("auth.jwtDesc")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 모델 목록 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <CardTitle>{t("models.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-fg-2">
                {t.rich("models.description", {
                  code: (chunks) => (
                    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
                      {chunks}
                    </code>
                  ),
                })}
              </p>
              <pre className="rounded-md bg-surface-2 p-3 text-xs text-fg-2 overflow-x-auto font-mono">
                {`curl https://your-instance/api/models \\
  -H "Authorization: Bearer <YOUR_API_KEY>"`}
              </pre>
              {/* 구 7 brand alias(pro/fast/think/code/vision) 는 2026-06-28 폐기됨.
                  실제 사용 가능한 모델 ID 는 위 GET /api/models 로 조회. default 는 기본 모델 별칭. */}
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <p className="mb-2 text-xs font-medium text-fg-2">{t("models.brandIdLabel")}</p>
                <div className="grid grid-cols-1 gap-1 text-xs font-mono text-muted">
                  <div className="flex gap-2">
                    <span className="text-accent">default</span>
                    <span className="text-faint">{t("brandModels.default")}</span>
                  </div>
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
