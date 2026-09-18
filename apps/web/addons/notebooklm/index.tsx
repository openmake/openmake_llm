/**
 * notebooklm add-on (웹) — 컴포저의 노트북 선택기. 고른 노트북은 contextRefs["notebooklm"] 로 서버에 간다.
 */
import { BookOpen } from "lucide-react";
import type { WebAddon } from "../types";
import { NotebookPicker } from "./notebook-picker";

export const notebooklmAddon: WebAddon = {
  id: "notebooklm",
  composerContext: { Icon: BookOpen, labelKey: "notebooks.select", Picker: NotebookPicker },
};
