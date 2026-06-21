"use client";

import { useEffect, useState } from "react";
import { FolderKanban, Plus, MessageSquare } from "lucide-react";
import {
  Button,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import type {
  ApiSuccess,
  Project as ApiProject,
  ProjectsPayload,
} from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 (뷰 모델) ──────────────────────────────────────── */
interface Project {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
}

/* ── 백엔드 응답 타입 (shared-types 계약) ───────────────────── */
type ProjectsResponse = ApiSuccess<ProjectsPayload>;
type CreateProjectResponse = ApiSuccess<{ project: ApiProject }>;

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const wk = Math.floor(day / 7);
  return `${wk}주 전`;
}

function mapProject(p: ApiProject): Project {
  return {
    id: p.id,
    name: p.name,
    description: p.description || "설명이 없습니다.",
    updatedAt: formatRelative(p.updated_at),
  };
}

/* ── 목업 데이터 — 미인증/네트워크 실패 시 폴백 ─────────────── */
const FALLBACK: Project[] = [
  {
    id: "p1",
    name: "신규 결제 모듈",
    description: "PG 연동 및 정산 파이프라인 설계 논의",
    updatedAt: "2시간 전",
  },
  {
    id: "p2",
    name: "마케팅 캠페인 Q2",
    description: "광고 카피 및 타겟 세그먼트 기획",
    updatedAt: "어제",
  },
  {
    id: "p3",
    name: "인프라 마이그레이션",
    description: "온프레미스 → 클러스터 라우팅 전환 계획",
    updatedAt: "3일 전",
  },
  {
    id: "p4",
    name: "고객 지원 봇",
    description: "FAQ 자동 응답 에이전트 프롬프트 튜닝",
    updatedAt: "1주 전",
  },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<ProjectsResponse>(
          "/api/users/me/projects",
        );
        if (cancelled) return;
        setProjects((res?.data?.projects ?? []).map(mapProject));
        setAuthed(true);
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

  async function handleCreate() {
    const name = window.prompt("새 프로젝트 이름 (1~80자)")?.trim();
    if (!name) return;
    const description =
      window.prompt("프로젝트 설명 (선택, 최대 500자)")?.trim() || "";
    setCreating(true);
    try {
      const res = await ApiClient.post<CreateProjectResponse>(
        "/api/users/me/projects",
        { name, description },
      );
      const created = res?.data?.project;
      if (created) {
        setProjects((prev) => [mapProject(created), ...prev]);
        setAuthed(true);
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "프로젝트 생성에 실패했습니다.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="프로젝트"
        description="관련 대화를 프로젝트 단위로 묶어 컨텍스트를 공유합니다."
        actions={
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            <Plus className="h-4 w-4" />새 프로젝트
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <FolderKanban className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <FolderKanban className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">프로젝트가 없습니다</p>
            <p className="mt-1 text-sm text-muted">
              새 프로젝트를 만들어 대화를 정리하세요.
            </p>
            <Button size="sm" className="mt-4" onClick={handleCreate} disabled={creating}>
              <Plus className="h-4 w-4" />새 프로젝트 만들기
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="flex cursor-pointer flex-col p-5 transition hover:border-border-strong hover:shadow-2"
              >
                <div className="mb-3 grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-accent">
                  <FolderKanban className="h-5 w-5" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-fg">{p.name}</h3>
                <p className="mb-4 line-clamp-2 flex-1 text-xs leading-relaxed text-muted">
                  {p.description}
                </p>
                <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-faint">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {authed ? "프로젝트" : "대화"}
                  </span>
                  <span>{p.updatedAt}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
