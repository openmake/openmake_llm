/**
 * skill-runtime 화면 경로 — `/skill-library`(스킬 목록·작성·가져오기·배정). 서버에서 import 되므로 훅을 두지 않는다(화면 컴포넌트는 "use client").
 */
import type { WebAddonPage } from "../../types";
import { SkillLibraryPage } from "./skill-library-page";

export const skillRuntimePages: readonly WebAddonPage[] = [
  { path: "skill-library", render: ({ segments }) => (segments.length === 0 ? <SkillLibraryPage /> : null) },
];
