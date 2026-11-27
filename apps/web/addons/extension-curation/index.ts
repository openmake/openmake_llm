/**
 * extension-curation add-on (웹) — 설정 '확장' 탭: 내 확장·갤러리(공유 확장 + 큐레이션 카탈로그)·이름 설치·설치 미리보기·
 * 공유 토글·내부 게시·카탈로그 원본 관리(관리자)·권한 패널. 서버 add-on 이 같은 id 로 갤러리·공유·게시 라우트를 가진다(§8-2).
 * 기본 켜짐이라 `hideUntilEnabledKnown` 을 쓰지 않는다(조회 실패·로딩 중에도 탭이 보인다 — 종전 Base 탭과 같다).
 */
import { Package } from "lucide-react";
import type { WebAddon } from "../types";
import { ExtensionsSection } from "./components/extensions-section";

export const extensionCurationAddon: WebAddon = {
  id: "extension-curation",
  // 설정 탭 — 종전 Base 탭 자리(메모리 50 과 개인정보 70 사이, MCP 커넥터 65 앞). id 는 종전 ?tab=extensions 딥링크 그대로
  settingsTabs: [{ id: "extensions", order: 60, labelKey: "settings.tabs.extensions", Icon: Package, Component: ExtensionsSection }],
};
