/**
 * 딥리서치 화면 경로 — `/research`(조사 세션 목록·진행). 서버에서 import 되므로 훅을 두지 않는다(화면 컴포넌트는 "use client").
 */
import type { WebAddonPage } from "../../types";
import { ResearchPage } from "./research-page";

export const deepResearchPages: readonly WebAddonPage[] = [
  { path: "research", render: ({ segments }) => (segments.length === 0 ? <ResearchPage /> : null) },
];
