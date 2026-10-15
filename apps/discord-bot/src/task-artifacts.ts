/**
 * 작업 산출물(응답 산출물·작업 공간 파일) → 디스코드 첨부 파일 — 이름·확장자·개수·크기 상한만 정한다(PURE, 디스코드를 모른다).
 * 확장자 규칙은 웹 작업 화면(apps/web agent-tasks 의 산출물 내려받기)과 같다.
 */
import type { TaskArtifact } from './task-client';

export interface ArtifactFile {
    name: string;
    data: Buffer;
    /** 응답 산출물에서 온 파일이면 그 산출물 id — 작업 공간 파일은 없다 */
    artifactId?: string;
}

/** 올리지 못한 응답 산출물 — 본문의 자리표시자를 웹 안내로 바꾸는 데 쓴다 */
export interface LeftOverArtifact {
    id: string;
    title: string;
}

/** 첨부 계획 — 올릴 파일과 올리지 못한 수(개수 상한 초과·크기 초과) */
export interface ArtifactPlan {
    files: ArtifactFile[];
    leftOver: number;
    /** leftOver 중 응답 산출물인 것 */
    leftOverArtifacts?: LeftOverArtifact[];
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

/**
 * 디스코드가 보존하는 글자(ASCII 영숫자·-·_·.)만 남긴다 — 디스코드는 첨부 이름에서 비ASCII 를 지우고,
 * 남는 게 없으면 임의 hex 이름을 붙인다. 영숫자가 하나도 없으면 빈 문자열
 */
function discordSafe(text: string): string {
    const name = safe(text).replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
    return /[A-Za-z0-9]/.test(name) ? name : '';
}

export function artifactFileName(artifact: TaskArtifact): string {
    const ext = artifact.kind === 'markdown' ? 'md' : artifact.kind === 'code' ? (artifact.lang || 'txt') : artifact.kind;
    const base = (discordSafe(artifact.title) || discordSafe(artifact.id)).slice(0, NAME_MAX_CHARS) || 'artifact';
    return `${base}.${safe(ext) || 'txt'}`;
}

/** 작업 입력 첨부가 쓰이는 작업 공간 폴더 — 서버 config/task-sandbox.ts 의 TASK_UPLOAD_DIR */
const TASK_UPLOAD_DIR = 'uploads';

/** 작업 공간 파일 하나 — data 가 null 이면 내려받지 못한 것(크기 초과·없음·실패·개수 상한 밖) */
export interface WorkspaceFile {
    path: string;
    data: Buffer | null;
}

/** 작업 공간 목록에서 산출물만 — 숨김 경로(.git 포함)·node_modules·입력 첨부(맨 위 uploads/)를 뺀다. 순서는 그대로 */
export function workspaceOutputs(paths: readonly string[]): string[] {
    return paths.filter((p) => {
        const segments = p.split(/[\\/]/);
        if (segments[0] === TASK_UPLOAD_DIR) return false;
        return !segments.some((seg) => seg.startsWith('.') || seg === 'node_modules');
    });
}

/** 경로의 마지막 조각 — 비면 file */
const baseNameOf = (path: string): string => safe(path.split(/[\\/]/).pop() ?? '') || 'file';

/** 같은 이름이 겹치면 `-2`, `-3` 을 붙인다 */
function uniqueName(name: string, used: Set<string>): string {
    if (!used.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let n = 2;
    while (used.has(`${base}-${n}${ext}`)) n += 1;
    return `${base}-${n}${ext}`;
}

/** 작업 공간 파일을 먼저, 그다음 응답 산출물 — 합쳐서 개수·크기 상한을 적용한다 */
export function toArtifactFiles(artifacts: readonly TaskArtifact[], workspace: readonly WorkspaceFile[] = []): ArtifactPlan {
    const files: ArtifactFile[] = [];
    const used = new Set<string>();
    const leftOverArtifacts: LeftOverArtifact[] = [];
    let leftOver = 0;
    const candidates: { name: string; data: Buffer | null; artifact?: TaskArtifact }[] = [
        ...workspace.map((w) => ({ name: baseNameOf(w.path), data: w.data })),
        ...artifacts.map((a) => ({ name: artifactFileName(a), data: Buffer.from(a.content, 'utf8'), artifact: a })),
    ];
    for (const { name: wanted, data, artifact } of candidates) {
        if (data === null || files.length >= MAX_ARTIFACT_FILES || data.length > MAX_ARTIFACT_BYTES) {
            leftOver += 1;
            if (artifact) leftOverArtifacts.push({ id: artifact.id, title: artifact.title });
            continue;
        }
        const name = uniqueName(wanted, used);
        used.add(name);
        files.push(artifact ? { name, data, artifactId: artifact.id } : { name, data });
    }
    return { files, leftOver, leftOverArtifacts };
}
