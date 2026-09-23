// 얇은 라우트 — 목록 화면은 add-on 컴포넌트가 전담한다(Base 는 렌더만).
import { SpaceListView } from "@/addons/knowledge/pages/space-list";

export default function Page() {
  return <SpaceListView />;
}
