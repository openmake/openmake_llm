// /admin/* 정적 관리자 화면의 공통 role 가드 — 판정은 AdminGuard(components/admin-guard.tsx).
// add-on 관리자 화면은 이 레이아웃 밖(app/(workspace)/(admin-addons)/admin/[...addonPath])에서 같은 가드를 직접 쓴다.
import { AdminGuard } from "@/components/admin-guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
