"use client";

import { useEffect, useState } from "react";
import { Boxes, Share2, ExternalLink, Lock, Globe, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ApiSuccess } from "@openmake/shared-types";
import { PageHeader, Card, Badge } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";
import { ArtifactShareModal } from "@/components/chat/artifact-share-modal";

interface GalleryItem {
  artifactId: string;
  sessionId: string;
  kind: string;
  lang: string | null;
  title: string;
  version: number;
  createdAt: string;
  published: boolean;
  publicationId: string | null;
  visibility: "private" | "authenticated" | "link" | null;
  icon: string | null;
}

const VIS_META: Record<string, { labelKey: string; icon: typeof Lock }> = {
  private: { labelKey: "vis.private", icon: Lock },
  authenticated: { labelKey: "vis.authenticated", icon: Globe },
  link: { labelKey: "vis.link", icon: Link2 },
};

export default function ArtifactsGalleryPage() {
  const t = useTranslations("artifacts.page");
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [share, setShare] = useState<{ sessionId: string; artifactId: string; icon: string | null } | null>(null);

  const load = async () => {
    try {
      const res = await ApiClient.get<ApiSuccess<{ items: GalleryItem[] }>>("/api/artifacts/gallery");
      setItems(res.data?.items ?? []);
    } catch {
      /* 미인증/네트워크 — 빈 목록 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const open = async (it: GalleryItem) => {
    if (!it.published || !it.publicationId) return;
    try {
      const res = await ApiClient.get<ApiSuccess<{ url: string }>>(`/api/artifacts/pub/${it.publicationId}/open`);
      window.open(res.data.url, "_blank", "noopener");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : t("viewerOpenFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Boxes className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Boxes className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted">{t("emptyDesc")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => {
              const vis = it.visibility ? VIS_META[it.visibility] : null;
              const VisIcon = vis?.icon;
              return (
                <Card key={`${it.sessionId}:${it.artifactId}`} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-2">
                    <span className="text-lg leading-none">{it.icon || "📦"}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-fg">{it.title}</h3>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge tone="neutral"><span className="font-mono">{it.kind}{it.lang ? `·${it.lang}` : ""}</span></Badge>
                        <span className="font-mono text-[11px] text-faint">v{it.version}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    {it.published && vis && VisIcon ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted">
                        <VisIcon className="h-3 w-3" /> {t(vis.labelKey)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-faint">{t("notShared")}</span>
                    )}
                    <div className="flex gap-1">
                      {it.published && (
                        <button
                          type="button"
                          onClick={() => open(it)}
                          aria-label={t("openViewer")}
                          className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShare({ sessionId: it.sessionId, artifactId: it.artifactId, icon: it.icon })}
                        aria-label={t("share")}
                        className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {share && (
        <ArtifactShareModal
          sessionId={share.sessionId}
          artifactId={share.artifactId}
          defaultIcon={share.icon}
          onCloseAction={() => {
            setShare(null);
            load();
          }}
        />
      )}
    </>
  );
}
