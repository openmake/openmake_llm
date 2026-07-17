/**
 * 응답의 시각 산출물(생성 이미지·아티팩트)을 Discord 첨부/링크로 변환.
 * - 생성 이미지: 본문의 `![alt](/generated/...)` 마크다운은 Discord 가 렌더하지 못하고
 *   상대경로라 링크로도 못 쓰므로, 백엔드에서 내려받아 파일 첨부하고 본문에서 제거한다.
 * - 아티팩트: v1 확장 필드 message.artifacts 를 kind별 확장자 파일로 첨부하고,
 *   본문의 `[[artifact:id]]` placeholder 를 제목+공유 뷰어 링크로 치환한다.
 */
import { config } from './config';

export interface ResponseArtifact {
    id: string;
    kind: string;
    title: string;
    language: string | null;
    version: number;
    content: string;
    shareUrl?: string;
}

export interface DiscordFile {
    attachment: Buffer;
    name: string;
}

export interface PreparedReply {
    content: string;
    files: DiscordFile[];
}

const GENERATED_IMG_RE = /!?\[([^\]]*)\]\((\/generated\/[^)\s]+)\)/g;
/** Discord 무료 서버 첨부 상한(10MB)보다 보수적으로 */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Discord 메시지당 첨부 파일 상한 */
const MAX_FILES_PER_MESSAGE = 10;

const KIND_EXT: Record<string, string> = {
    markdown: 'md',
    html: 'html',
    svg: 'svg',
    mermaid: 'mmd',
    react: 'jsx',
    chart: 'json',
    csv: 'csv',
    slide: 'html',
    excalidraw: 'json',
};

/** kind='code' 는 language 를 확장자로 (안전한 토큰만), 그 외 txt */
function extFor(artifact: ResponseArtifact): string {
    const byKind = KIND_EXT[artifact.kind];
    if (byKind) return byKind;
    const lang = (artifact.language || '').toLowerCase().trim();
    if (/^[a-z0-9+]{1,10}$/.test(lang)) {
        const LANG_EXT: Record<string, string> = {
            typescript: 'ts', javascript: 'js', python: 'py', 'c++': 'cpp', 'c#': 'cs', shell: 'sh', bash: 'sh',
        };
        return LANG_EXT[lang] || lang;
    }
    return 'txt';
}

/** 파일명 안전화 — 경로/제어문자 제거, 길이 제한 */
function safeFilename(title: string, fallback: string): string {
    const base = (title || fallback)
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    return base || fallback;
}

/** /generated/* 이미지를 백엔드에서 내려받아 Buffer 로 반환 (실패/초과 시 null) */
async function downloadGenerated(relPath: string): Promise<Buffer | null> {
    try {
        const res = await fetch(`${config.apiBaseUrl}${relPath}`);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_ATTACHMENT_BYTES) return null;
        return buf;
    } catch {
        return null;
    }
}

/**
 * 응답 텍스트 + 아티팩트를 Discord 게시용 (본문, 첨부 목록) 으로 변환.
 */
export async function prepareReply(answer: string, artifacts: ResponseArtifact[] = []): Promise<PreparedReply> {
    const files: DiscordFile[] = [];
    let content = answer;

    // ── 1) 생성 이미지 (/generated/*) → 파일 첨부 ──────────────
    const imagePaths: string[] = [];
    content = content.replace(GENERATED_IMG_RE, (_m, _alt: string, relPath: string) => {
        if (!imagePaths.includes(relPath)) imagePaths.push(relPath);
        return ''; // 첨부로 대체 — 본문에서 마크다운 제거
    });
    for (const relPath of imagePaths) {
        if (files.length >= MAX_FILES_PER_MESSAGE) break;
        const buf = await downloadGenerated(relPath);
        const filename = relPath.split('/').pop() || 'image.png';
        if (buf) {
            files.push({ attachment: buf, name: filename });
        } else {
            content += `\n⚠️ 이미지 첨부 실패: \`${filename}\``;
        }
    }

    // ── 2) 아티팩트 → 파일 첨부 + placeholder 치환 ─────────────
    for (const a of artifacts) {
        const filename = `${safeFilename(a.title, a.id)}.${extFor(a)}`;
        const buf = Buffer.from(a.content, 'utf8');
        const attached = buf.length <= MAX_ATTACHMENT_BYTES && files.length < MAX_FILES_PER_MESSAGE;
        if (attached) files.push({ attachment: buf, name: filename });

        const parts = [`📎 **${a.title || a.id}**`];
        if (a.shareUrl) parts.push(`렌더 보기: ${a.shareUrl}`);
        if (attached) parts.push(`(파일 첨부: ${filename})`);
        const replacement = parts.join(' · ');

        // [[artifact:id]] / [[artifact:id:vN]] 두 형태 모두 치환
        const ph = new RegExp(`\\[\\[artifact:${escapeRegExp(a.id)}(?::v\\d+)?\\]\\]`, 'g');
        if (ph.test(content)) {
            content = content.replace(ph, replacement);
        } else {
            content += `\n${replacement}`;
        }
    }

    content = content.trim();
    if (!content && files.length > 0) content = '📎 산출물을 첨부했습니다.';
    if (!content) content = '(빈 응답)';
    return { content, files };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
