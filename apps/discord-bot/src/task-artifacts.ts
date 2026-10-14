/**
 * 작업 산출물 → 디스코드 첨부 파일 — 이름·확장자·개수·크기 상한만 정한다(PURE, 디스코드를 모른다).
 * 확장자 규칙은 웹 작업 화면(apps/web agent-tasks 의 산출물 내려받기)과 같다.
 */
import type { TaskArtifact } from './task-client';

export interface ArtifactFile {
    name: string;
    data: Buffer;
}

/** 첨부 계획 — 올릴 파일과 올리지 못한 수(개수 상한 초과·크기 초과) */
export interface ArtifactPlan {
    files: ArtifactFile[];
    leftOver: number;
}

/** 메시지 하나에 싣는 첨부의 상한(개) */
export const MAX_ARTIFACT_FILES = 5;
/** 첨부 하나의 상한(바이트) — 디스코드 기본 업로드 상한 */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
/** 파일 이름(확장자 제외)의 상한(자) */
const NAME_MAX_CHARS = 80;
/** 경로 구분자·윈도우 금지 문자·제어문자 */
const UNSAFE_CHARS = /[\\/:*?"<>|\x00-\x1f\x7f]+/g;

const safe = (text: string): string => text.replace(UNSAFE_CHARS, '_').trim();

export function artifactFileName(artifact: TaskArtifact): string {
    const ext = artifact.kind === 'markdown' ? 'md' : artifact.kind === 'code' ? (artifact.lang || 'txt') : artifact.kind;
    const base = safe(artifact.title).slice(0, NAME_MAX_CHARS) || 'artifact';
    return `${base}.${safe(ext) || 'txt'}`;
}

/** 같은 이름이 겹치면 `-2`, `-3` 을 붙인다 */
function uniqueName(name: string, used: Set<string>): string {
    if (!used.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let n = 2;
    while (used.has(`${base}-${n}${ext}`)) n += 1;
    return `${base}-${n}${ext}`;
}

export function toArtifactFiles(artifacts: readonly TaskArtifact[]): ArtifactPlan {
    const files: ArtifactFile[] = [];
    const used = new Set<string>();
    let leftOver = 0;
    for (const artifact of artifacts) {
        const data = Buffer.from(artifact.content, 'utf8');
        if (files.length >= MAX_ARTIFACT_FILES || data.length > MAX_ARTIFACT_BYTES) {
            leftOver += 1;
            continue;
        }
        const name = uniqueName(artifactFileName(artifact), used);
        used.add(name);
        files.push({ name, data });
    }
    return { files, leftOver };
}
