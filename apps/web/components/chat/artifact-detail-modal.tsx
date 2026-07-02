"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ApiSuccess } from "@openmake/shared-types";
import type { Artifact } from "@/lib/store";
import { ApiClient } from "@/lib/api-client";
import { ArtifactBody } from "./artifact-panel";

interface DetailTarget {
  sessionId: string;
  artifactId: string;
  kind: string;
  lang: string | null;
  title: string;
}

interface VersionRow {
  version: number;
}
interface VersionDetail {
  kind: string;
  title: string;
  language: string | null;
  content: string;
  version: number;
}

/**
 * 갤러리 아티팩트 상세 — 대화(세션)를 열지 않고도 본문을 보고, 코드는 실행/실행 이력을
 * 확인한다. 본문·미리보기·코드 실행 렌더는 채팅 패널의 ArtifactBody 를 그대로 재사용한다.
 */
export function ArtifactDetailModal({
  target,
  onCloseAction,
}: {
  target: DetailTarget;
  onCloseAction: () => void;
}) {
  const t = useTranslations("artifacts.page");
  const [versions, setVersions] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);

  const base = `/api/sessions/${encodeURIComponent(target.sessionId)}/artifacts/${encodeURIComponent(target.artifactId)}`;

  // 버전 목록 로드 → 최신 선택
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<ApiSuccess<{ versions: VersionRow[] }>>(`${base}/versions`);
        const vs = (res.data?.versions ?? []).map((v) => v.version);
        if (!alive) return;
        setVersions(vs);
        setSelected(vs.length ? vs[vs.length - 1] : null);
      } catch {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.sessionId, target.artifactId]);

  // 선택 버전 본문 로드
  useEffect(() => {
    if (selected == null) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res = await ApiClient.get<ApiSuccess<VersionDetail>>(`${base}/v/${selected}`);
        const d = res.data;
        if (alive && d) {
          setArtifact({ id: target.artifactId, kind: d.kind, title: d.title, lang: d.language, content: d.content });
        }
      } catch {
        /* 무시 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCloseAction}
      role="presentation"
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-fg">{target.title}</h2>
            <span className="font-mono text-[11px] text-faint">
              {target.kind}
              {target.lang ? `·${target.lang}` : ""}
            </span>
          </div>
          {versions.length > 1 && (
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted"
              aria-label={t("versionPicker")}
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  v{v}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onCloseAction}
            aria-label={t("close")}
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading || !artifact ? (
            <div className="grid h-full place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-faint" />
            </div>
          ) : (
            <ArtifactBody
              artifact={artifact}
              view="preview"
              sessionId={target.sessionId}
              version={selected}
            />
          )}
        </div>
      </div>
    </div>
  );
}
