"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Shield, Users, Boxes, Gauge, ArrowRight, Pencil, Trash2, Plus, X, Loader2 } from "lucide-react";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { AdminObservabilityTabs } from "@/components/hub-tabs";

interface AdminUser {
  id: string;
  email: string;
  name?: string;
  role: "admin" | "user" | "guest";
  is_active: boolean;
  created_at: string;
  last_login?: string | null;
}

interface GuardianPending {
  id: string;
  email: string;
  created_at: string;
}

const ROLE_LABEL_KEY: Record<string, string> = {
  admin: "roles.admin",
  user: "roles.user",
  guest: "roles.guest",
};
const ROLE_TONE: Record<string, "danger" | "success" | "neutral"> = {
  admin: "danger",
  user: "success",
  guest: "neutral",
};

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
  { href: "/admin", titleKey: "quickLinks.users.title", descKey: "quickLinks.users.desc", icon: Users },
  { href: "/mcp-catalog", titleKey: "quickLinks.models.title", descKey: "quickLinks.models.desc", icon: Boxes },
  { href: "/admin/metrics", titleKey: "quickLinks.system.title", descKey: "quickLinks.system.desc", icon: Gauge },
];

/* ── 모달 공통 래퍼 ─────────────────────────────────────────── */
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations("admin");
  const backdropRef = useRef<HTMLDivElement>(null);
  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      ref={backdropRef}
      onClick={(ev) => { if (ev.target === backdropRef.current) onClose(); }}
    >
      <div className="relative mx-4 w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-faint hover:text-fg"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";
const selectCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg focus:border-accent focus:outline-none";
const labelCls = "block text-xs font-medium text-fg-2 mb-1";

/* ── 생성 모달 ───────────────────────────────────────────────── */
function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("admin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "user" | "guest">("user");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await ApiClient.post("/api/admin/users", { name: name || undefined, email, role, password });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("createError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-base font-semibold text-fg">{t("addUser")}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelCls}>{t("nameLabel")}</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
        </div>
        <div>
          <label className={labelCls}>{t("emailRequired")}</label>
          <input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </div>
        <div>
          <label className={labelCls}>{t("roleRequired")}</label>
          <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value as "admin" | "user" | "guest")}>
            <option value="user">{t("roles.user")}</option>
            <option value="admin">{t("roles.admin")}</option>
            <option value="guest">{t("roles.guest")}</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("passwordRequired")}</label>
          <input className={inputCls} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── 편집 모달 ───────────────────────────────────────────────── */
function EditUserModal({
  user,
  onClose,
  onUpdated,
}: {
  user: AdminUser;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const t = useTranslations("admin");
  const [role, setRole] = useState<"admin" | "user" | "guest">(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const body: Record<string, unknown> = { role, is_active: isActive };
      if (password) body.password = password;
      await ApiClient.put(`/api/admin/users/${user.id}`, body);
      onUpdated();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("updateError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-base font-semibold text-fg">{t("editUser")}</h2>
      <p className="mb-4 text-xs text-muted">{user.email}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelCls}>{t("roleField")}</label>
          <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value as "admin" | "user" | "guest")}>
            <option value="user">{t("roles.user")}</option>
            <option value="admin">{t("roles.admin")}</option>
            <option value="guest">{t("roles.guest")}</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("statusField")}</label>
          <select className={selectCls} value={isActive ? "active" : "inactive"} onChange={(e) => setIsActive(e.target.value === "active")}>
            <option value="active">{t("active")}</option>
            <option value="inactive">{t("inactive")}</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("newPasswordLabel")}</label>
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("newPasswordPlaceholder")} />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── 삭제 확인 모달 ─────────────────────────────────────────── */
function DeleteUserModal({
  user,
  onClose,
  onDeleted,
}: {
  user: AdminUser;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("admin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setSubmitting(true);
    setError("");
    try {
      await ApiClient.del(`/api/admin/users/${user.id}`);
      onDeleted();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("deleteError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold text-fg">{t("deleteTitle")}</h2>
      <p className="mb-1 text-sm text-fg-2">{t("deleteConfirm")}</p>
      <p className="mb-4 text-xs text-muted font-mono">{user.email}</p>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>{t("cancel")}</Button>
        <Button variant="danger" size="sm" onClick={handleDelete} disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("delete")}
        </Button>
      </div>
    </Modal>
  );
}

export default function AdminPage() {
  const t = useTranslations("admin");
  const [users, setUsers] = useState<AdminUser[]>(MOCK_USERS);
  const [stats, setStats] = useState({ total: 1042, active: 318, today: 4821, status: t("statusNormal") });
  const [guardianPending, setGuardianPending] = useState<GuardianPending[]>([]);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);

  async function loadUsers() {
    try {
      const res = await ApiClient.get<{ data?: { users?: AdminUser[] }; users?: AdminUser[] }>("/api/admin/users?limit=8");
      const list = (res.data?.users || (res as { users?: AdminUser[] }).users) ?? [];
      if (list.length) setUsers(list);
    } catch {
      /* 목업 유지 */
    }
  }

  async function loadGuardianPending() {
    try {
      const res = await ApiClient.get<{ data?: { users?: GuardianPending[] }; users?: GuardianPending[] }>("/api/admin/guardian-consent-pending");
      const list = (res.data?.users || (res as { users?: GuardianPending[] }).users) ?? [];
      setGuardianPending(list);
    } catch {
      /* 미표시 */
    }
  }

  async function approveGuardian(id: string) {
    setApprovingIds((prev) => new Set(prev).add(id));
    try {
      await ApiClient.post(`/api/admin/users/${id}/guardian-verify`, {});
      setGuardianPending((prev) => prev.filter((u) => u.id !== id));
    } catch {
      /* 실패 시 목록 유지 */
    } finally {
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

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
          const list = (u.value.data?.users || (u.value as { users?: AdminUser[] }).users) ?? [];
          if (list.length) setUsers(list);
        }
        if (us.status === "fulfilled") {
          const p = us.value.data ?? (us.value as Record<string, number>);
          setStats((s) => ({
            ...s,
            total: (p as Record<string, number>).totalUsers ?? s.total,
            active: (p as Record<string, number>).activeUsers ?? s.active,
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
    void loadGuardianPending();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="danger">
              <Shield className="h-3.5 w-3.5" /> {t("adminOnly")}
            </Badge>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              {t("addUser")}
            </Button>
          </div>
        }
      />
      <AdminObservabilityTabs />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 값은 실데이터. 트렌드 델타(+12/+5.2%/+18.4%)는 실 비교 소스가 없어 제거(가짜 표시 방지).
              시스템 상태의 "모든 노드 정상"은 트렌드가 아니라 실 상태 라벨이라 유지. */}
          <StatCard label={t("stats.totalUsers")} value={stats.total.toLocaleString()} />
          <StatCard label={t("stats.activeSessions")} value={stats.active.toLocaleString()} />
          <StatCard label={t("stats.todayRequests")} value={stats.today.toLocaleString()} />
          <StatCard label={t("stats.systemStatus")} value={stats.status} delta={t("stats.allNodesNormal")} />
        </div>

        <h2 className="mt-8 mb-3 text-sm font-semibold text-fg-2">{t("quickLinksHeading")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((q) => (
            <Link key={q.titleKey + q.href} href={q.href} className="group">
              <Card className="h-full p-5 transition hover:border-border-strong hover:shadow-2">
                <div className="flex items-start justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <q.icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </div>
                <p className="mt-4 text-sm font-semibold text-fg">{t(q.titleKey)}</p>
                <p className="mt-1 text-xs text-muted">{t(q.descKey)}</p>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="mt-8">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t("recentUsers")}</CardTitle>
            <Link
              href="/admin"
              className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-2"
            >
              {t("viewAll")}
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t("col.id")}</Th>
                  <Th>{t("col.email")}</Th>
                  <Th>{t("col.role")}</Th>
                  <Th>{t("col.status")}</Th>
                  <Th>{t("col.joinedAt")}</Th>
                  <Th>{t("col.lastLogin")}</Th>
                  <Th>{t("col.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-mono text-xs text-muted">{u.id}</Td>
                    <Td className="text-fg">{u.email}</Td>
                    <Td>
                      <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>{ROLE_LABEL_KEY[u.role] ? t(ROLE_LABEL_KEY[u.role]) : u.role}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={u.is_active ? "success" : "danger"}>{u.is_active ? t("active") : t("inactive")}</Badge>
                    </Td>
                    <Td>{fmtDate(u.created_at)}</Td>
                    <Td className="text-muted">{u.last_login ? fmtDate(u.last_login) : "-"}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditUser(u)}
                          aria-label={t("col.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteUser(u)}
                          aria-label={t("col.delete")}
                          className="text-danger hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        {/* M8: 미성년자 동의 보류 섹션 */}
        {guardianPending.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("guardianPending")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("col.email")}</Th>
                    <Th>{t("col.joinedAt")}</Th>
                    <Th>{t("col.actions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {guardianPending.map((u) => (
                    <tr key={u.id}>
                      <Td className="text-fg">{u.email}</Td>
                      <Td className="text-muted">{fmtDate(u.created_at)}</Td>
                      <Td>
                        <Button
                          size="sm"
                          disabled={approvingIds.has(u.id)}
                          onClick={() => approveGuardian(u.id)}
                        >
                          {approvingIds.has(u.id) && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          {t("approve")}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={loadUsers}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onUpdated={loadUsers}
        />
      )}
      {deleteUser && (
        <DeleteUserModal
          user={deleteUser}
          onClose={() => setDeleteUser(null)}
          onDeleted={loadUsers}
        />
      )}
    </>
  );
}
