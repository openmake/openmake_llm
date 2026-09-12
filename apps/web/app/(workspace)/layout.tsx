import { Sidebar } from "@/components/sidebar";
import { MobileSidebar } from "@/components/mobile-sidebar";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <MobileSidebar />
      {/*
        ⚠️ 레이아웃 계약 — 이 <main> 은 h-dvh + overflow-hidden 이다(채팅이 컴포저를 고정하고
        메시지 목록만 스크롤하는 전제). 따라서 **각 페이지가 스크롤 컨테이너를 직접 만들어야 한다**:

            <PageHeader … />            ← 고정
            <AdminTabs />               ← 고정(있으면)
            <div className="min-h-0 flex-1 overflow-y-auto p-6">…본문…</div>

        빠뜨리면 내용이 뷰포트 밖에서 통째로 잘리고 스크롤도 안 된다 — 화면엔 렌더되므로
        조용한 결함이다(2026-09-13 신고: /admin/model-roles 가 1,280×900 에서 1,314px 접근 불가.
        같은 부류로 /admin/schedules·/api-access 도 작은 창에서 잘렸다).
        페이지 루트를 <div> 로 감싸면 flex-1 이 <main> 에 닿지 않으므로 fragment(<>)를 쓴다.
      */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-[calc(3.25rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>
    </div>
  );
}
