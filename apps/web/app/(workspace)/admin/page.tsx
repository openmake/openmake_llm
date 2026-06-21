"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, Users, Boxes, Gauge, ArrowRight } from "lucide-react";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";

interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "user" | "guest";
  is_active: boolean;
  created_at: string;
  last_login?: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "관리자",
  user: "사용자",
  guest: "게스트",
};
const ROLE_TONE: Record<string, "danger" | "success" | "neutral"> = {
  admin: "danger",
  user: "success",
  guest: "neutral",
};

// /api/admin/users·/users/stats·/stats 실데이터로 교체, 401/실패 시 폴백 목업.
const MOCK_USERS: AdminUser[] = [
  { id: "u_1042", email: "minji.kim@openmake.io", role: "user", is_active: true, created_at: "2026-06-19T09:12:00Z", last_login: "2026-06-21T02:30:00Z" },
  { id: "u_1041", email: "devops@partner.co.kr", role: "admin", is_active: true, created_at: "2026-06-18T15:40:00Z", last_login: "2026-06-20T22:05:00Z" },
  { id: "u_1040", email: "guest.trial+93@gmail.com", role: "guest", is_active: false, created_at: "2026-06-18T11:03:00Z", last_login: null },
  { id: "u_1039", email: "research.lab@yonsei.ac.kr", role: "user", is_active: true, created_at: "2026-06-17T08:22:00Z", last_login: "2026-06-21T01:11:00Z" },
  { id: "u_1038", email: "sangho.park@openmake.io", role: "user", is_active: true, created_at: "2026-06-16T19:55:00Z", last_login: "2026-06-20T13:48:00Z" },
];

function fmtDate(s?: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const QUICK_LINKS = [
  { href: "/admin", title: "사용자 관리", desc: "계정 생성·권한·상태 관리", icon: Users },
  { href: "/mcp-catalog", title: "모델 · MCP 설정", desc: "모델 프리셋과 도구 카탈로그", icon: Boxes },
  { href: "/admin/metrics", title: "시스템 상태", desc: "노드·서비스 헬스 모니터링", icon: Gauge },
];

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>(MOCK_USERS);
  const [stats, setStats] = useState({ total: 1042, active: 318, today: 4821, status: "정상" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [u, us, st] = await Promise.allSettled([
          ApiClient.get<{ data?: { users?: AdminUser[] }; users?: AdminUser[] }>("/api/admin/users?limit=8"),
          ApiClient.get<{ data?: Record<string, number>; totalUsers?: number }>("/api/admin/users/stats"),
          ApiClient.get<{ data?: { today_queries?: number }; today_queries?: number }>("/api/admin/stats"),
        ]);
        if (!alive) return;
        if (u.status === "fulfilled") {
          const list = (u.value.data?.users || u.value.users) ?? [];
          if (list.length) setUsers(list);
        }
        if (us.status === "fulfilled") {
          const p = us.value.data ?? (us.value as Record<string, number>);
          setStats((s) => ({
            ...s,
            total: p.totalUsers ?? s.total,
            active: p.activeUsers ?? s.active,
          }));
        }
        if (st.status === "fulfilled") {
          const p = st.value.data ?? (st.value as { today_queries?: number });
          if (p.today_queries != null) setStats((s) => ({ ...s, today: p.today_queries! }));
        }
      } catch {
        /* 목업 유지 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="관리자 대시보드"
        description="사용자, 모델, 시스템 상태를 한 곳에서 관리합니다."
        actions={
          <Badge tone="danger">
            <Shield className="h-3.5 w-3.5" /> 관리자 전용
          </Badge>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="총 사용자" value={stats.total.toLocaleString()} delta="+12 (지난 7일)" />
          <StatCard label="활성 세션" value={stats.active.toLocaleString()} delta="+5.2%" />
          <StatCard label="오늘 요청" value={stats.today.toLocaleString()} delta="+18.4%" />
          <StatCard label="시스템 상태" value={stats.status} delta="모든 노드 정상" />
        </div>

        <h2 className="mt-8 mb-3 text-sm font-semibold text-fg-2">빠른 관리</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((q) => (
            <Link key={q.title + q.href} href={q.href} className="group">
              <Card className="h-full p-5 transition hover:border-border-strong hover:shadow-2">
                <div className="flex items-start justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <q.icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </div>
                <p className="mt-4 text-sm font-semibold text-fg">{q.title}</p>
                <p className="mt-1 text-xs text-muted">{q.desc}</p>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="mt-8">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>최근 가입 사용자</CardTitle>
            <Link
              href="/admin"
              className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-2"
            >
              전체 보기
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>이메일</Th>
                  <Th>역할</Th>
                  <Th>상태</Th>
                  <Th>가입일</Th>
                  <Th>마지막 로그인</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-mono text-xs text-muted">{u.id}</Td>
                    <Td className="text-fg">{u.email}</Td>
                    <Td>
                      <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>{ROLE_LABEL[u.role] ?? u.role}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={u.is_active ? "success" : "danger"}>{u.is_active ? "활성" : "비활성"}</Badge>
                    </Td>
                    <Td>{fmtDate(u.created_at)}</Td>
                    <Td className="text-muted">{u.last_login ? fmtDate(u.last_login) : "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
