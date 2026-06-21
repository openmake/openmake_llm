/**
 * ============================================================
 * Artifact Stream Parser — incremental XML 태그 분리
 * ============================================================
 *
 * LLM 토큰 스트림에서 `<artifact id="..." kind="..." title="..." lang="...">`
 * 본문을 incremental 하게 감지·분리. reasoning-tag-parser.ts 와 동일한 철학
 * (vLLM 토큰이 태그 중간에 잘려 도착해도 buffer 로 처리).
 *
 * 콜백 발행 순서:
 *   - outside 본문 토큰   → onContent(delta)
 *   - 시작 태그 감지       → onArtifactStart(info)
 *   - inside 본문 토큰     → onArtifactChunk(id, delta)
 *   - 닫는 태그 감지       → onArtifactEnd(id)
 *
 * 호출 패턴:
 *   const parser = new ArtifactStreamParser({ onContent, onStart, onChunk, onEnd });
 *   for await (const delta of stream) parser.feed(delta);
 *   parser.flush();  // 스트림 종료 시 잔여 buffer 처리
 *
 * @module llm/artifact-parser
 * @see apps/api/src/llm/reasoning-tag-parser.ts (같은 패턴)
 */

import { verifyArtifact, type ArtifactValidation } from './artifact-verifier';

export interface ArtifactInfo {
    id: string;
    kind: string;
    title: string;
    lang: string | null;
}

/** 산출물 결정론 검증 게이트 on/off (기본 ON). 비차단 — 결과는 annotate 만 함. */
const ARTIFACT_VERIFY_ENABLED = process.env.ARTIFACT_VERIFY_ENABLED !== 'false';

export interface ArtifactStreamCallbacks {
    /** 일반 본문 토큰 (artifact 외부) */
    onContent(delta: string): void;
    /** 시작 태그 감지 — id/kind/title 메타 노출 */
    onArtifactStart(info: ArtifactInfo): void;
    /** artifact 본문 토큰 (incremental) */
    onArtifactChunk(id: string, delta: string): void;
    /** 닫는 태그 감지 — 완성 */
    onArtifactEnd(id: string): void;
}

const OPEN_TAG_PATTERN = /<artifact\s+([^>]*)>/i;
const CLOSE_TAG = '</artifact>';
// 잘림 검출: '<', '<a', '<ar', ... '<artifact ' 모두 partial — 다음 청크 기다림.
const OPEN_PREFIX_PATTERN = /<a?r?t?i?f?a?c?t?(\s[^>]*)?$/i;
const CLOSE_PREFIX_PATTERN = /<\/a?r?t?i?f?a?c?t?$/i;

export class ArtifactStreamParser {
    private buffer = '';
    private state: 'outside' | 'inside' = 'outside';
    private currentId: string | null = null;

    constructor(private readonly cb: ArtifactStreamCallbacks) {}

    feed(delta: string): void {
        if (!delta) return;
        this.buffer += delta;
        this.drain();
    }

    /**
     * 스트림 종료 시 호출. 잔여 buffer 를 마저 emit.
     * 닫는 태그 없이 끝난 artifact 도 강제로 onArtifactEnd 발행 (defensive).
     */
    flush(): void {
        if (this.state === 'inside' && this.currentId) {
            if (this.buffer) {
                this.cb.onArtifactChunk(this.currentId, this.buffer);
                this.buffer = '';
            }
            this.cb.onArtifactEnd(this.currentId);
            this.currentId = null;
            this.state = 'outside';
        } else if (this.buffer) {
            this.cb.onContent(this.buffer);
            this.buffer = '';
        }
    }

    private drain(): void {
        while (this.buffer.length > 0) {
            if (this.state === 'outside') {
                if (!this.drainOutside()) return;
            } else {
                if (!this.drainInside()) return;
            }
        }
    }

    /** outside 상태 — `<artifact ...>` 시작 태그 찾기. 못 찾으면 onContent 로 flush. */
    private drainOutside(): boolean {
        const m = OPEN_TAG_PATTERN.exec(this.buffer);
        if (!m) {
            // 시작 태그 partial (잘림) — 다음 청크 기다림.
            const prefixM = OPEN_PREFIX_PATTERN.exec(this.buffer);
            if (prefixM && prefixM.index >= 0) {
                const safeEnd = prefixM.index;
                if (safeEnd > 0) {
                    this.cb.onContent(this.buffer.slice(0, safeEnd));
                    this.buffer = this.buffer.slice(safeEnd);
                }
                return false; // 더 기다림
            }
            // partial 도 없으면 전체 flush
            this.cb.onContent(this.buffer);
            this.buffer = '';
            return false;
        }
        // 시작 태그 발견 — 앞부분 onContent, 태그 자체는 메타 추출 후 inside 전환
        if (m.index > 0) {
            this.cb.onContent(this.buffer.slice(0, m.index));
        }
        const info = parseAttrs(m[1] || '');
        this.cb.onArtifactStart(info);
        this.currentId = info.id;
        this.state = 'inside';
        this.buffer = this.buffer.slice(m.index + m[0].length);
        return true;
    }

    /** inside 상태 — `</artifact>` 닫는 태그 찾기. 못 찾으면 chunk 로 발행. */
    private drainInside(): boolean {
        const closeIdx = this.buffer.indexOf(CLOSE_TAG);
        if (closeIdx >= 0) {
            const inner = this.buffer.slice(0, closeIdx);
            if (inner && this.currentId) this.cb.onArtifactChunk(this.currentId, inner);
            if (this.currentId) this.cb.onArtifactEnd(this.currentId);
            this.currentId = null;
            this.state = 'outside';
            this.buffer = this.buffer.slice(closeIdx + CLOSE_TAG.length);
            return true;
        }
        // 닫는 태그 partial — 다음 청크 기다림.
        const prefixM = CLOSE_PREFIX_PATTERN.exec(this.buffer);
        if (prefixM && prefixM.index >= 0) {
            const safeEnd = prefixM.index;
            if (safeEnd > 0 && this.currentId) {
                this.cb.onArtifactChunk(this.currentId, this.buffer.slice(0, safeEnd));
            }
            this.buffer = this.buffer.slice(safeEnd);
            return false; // 더 기다림
        }
        // partial 도 없으면 전체 chunk 로 발행
        if (this.currentId) this.cb.onArtifactChunk(this.currentId, this.buffer);
        this.buffer = '';
        return false;
    }
}

/**
 * Post-hoc 추출: 완성된 응답 본문에서 `<artifact>...</artifact>` 블록을 분리.
 *
 * ws-handler 의 incremental parser 와 grammar 동일하지만, 책임 분리 패턴 —
 * incremental = UX (token vs artifact 분리해서 ws.send),
 * post-hoc    = 영속화 (artifact 본문 → DB INSERT, message 본문은 placeholder 로 정리).
 *
 * cleanedContent: `<artifact ...>...</artifact>` → `[[artifact:id]]` placeholder
 * artifacts: 추출된 본문 + 메타 목록 (DB INSERT 입력)
 *
 * @example
 *   const { cleanedContent, artifacts } = extractAndStripArtifacts(rawAssistant);
 *   for (const a of artifacts) await repo.insertArtifact({ ...a, sessionId, userId });
 *   await saveAssistantMessage(cleanedContent);
 */
export interface ExtractedArtifact extends ArtifactInfo {
    content: string;
    /** 결정론 검증 결과 (게이트 ON 시 부착). 비차단 — 영속화/표시를 막지 않음. */
    validation?: ArtifactValidation;
}

/** 추출된 artifact 에 결정론 검증 결과를 부착 (게이트 OFF 면 그대로 반환). */
function attachValidation(a: ExtractedArtifact): ExtractedArtifact {
    if (!ARTIFACT_VERIFY_ENABLED) return a;
    a.validation = verifyArtifact({ kind: a.kind, lang: a.lang, content: a.content });
    return a;
}

const ARTIFACT_BLOCK_PATTERN = /<artifact\s+([^>]*)>([\s\S]*?)<\/artifact>/gi;
// Fallback: ```LANG\n...\n``` (lang 그룹 1, 본문 그룹 2). 길이 임계값 (≥15줄) 은 Anthropic 공식 기준.
const FENCE_FALLBACK_PATTERN = /```([a-zA-Z0-9_+\-#.]+)?\n([\s\S]*?)\n```/g;
const FENCE_MIN_LINES = 15;

export function extractAndStripArtifacts(raw: string): {
    cleanedContent: string;
    artifacts: ExtractedArtifact[];
} {
    if (!raw) return { cleanedContent: raw, artifacts: [] };
    const artifacts: ExtractedArtifact[] = [];

    // 1) 명시적 <artifact> 태그 추출 (LLM 이 instruction follow 한 경우).
    let cleaned = raw;
    if (raw.indexOf('<artifact') !== -1) {
        cleaned = cleaned.replace(ARTIFACT_BLOCK_PATTERN, (_match, attrs: string, body: string) => {
            const info = parseAttrs(attrs);
            artifacts.push(attachValidation({ ...info, content: body.trim() }));
            return `[[artifact:${info.id}]]`;
        });
    }

    // 2) Fallback: instruction follow 실패 시 — 긴 code fence (≥15줄) 도 artifact 로 자동 변환.
    //    Qwen 35B 등이 시스템 프롬프트의 XML 태그 가이드를 무시하고 raw fence 만 출력하는 경우 대응.
    //    auto- 접두사 id 로 명시적 artifact 와 구분.
    let fenceIdx = 0;
    cleaned = cleaned.replace(FENCE_FALLBACK_PATTERN, (match, lang: string | undefined, body: string) => {
        const lineCount = body.split('\n').length;
        if (lineCount < FENCE_MIN_LINES) return match; // 짧은 fence 는 inline 유지
        fenceIdx += 1;
        const langNorm = (lang || '').toLowerCase().slice(0, 40) || null;
        const id = `auto-${slug(langNorm || 'code')}-${Date.now().toString(36)}-${fenceIdx}`;
        const title = titleFor(langNorm, body);
        artifacts.push(attachValidation({
            id,
            kind: 'code',
            title,
            lang: langNorm,
            content: body.trim(),
        }));
        return `[[artifact:${id}]]`;
    });

    return { cleanedContent: cleaned, artifacts };
}

function slug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'code';
}

/** code fence 첫 함수/클래스 이름을 title 후보로 추출 — 못 찾으면 lang + 'snippet'. */
function titleFor(lang: string | null, body: string): string {
    const m = body.match(/^\s*(?:def|function|class|fn|func|public|private|static|export)\s+([a-zA-Z_][a-zA-Z0-9_]*)/m);
    if (m) return m[1];
    return lang ? `${lang} snippet` : 'code';
}

/**
 * 시작 태그 속성 문자열 파싱. 견고하지 않은 LLM 출력에도 대응:
 *   id="..." kind=...  title='...' lang="js"
 *   id=todo-app kind=react title="Todo App"
 */
function parseAttrs(s: string): ArtifactInfo {
    const out: Record<string, string> = {};
    // 더블/싱글 quote 또는 unquoted (공백 전까지). XML 표준은 아니지만 LLM 출력은 종종 lazy.
    const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        const key = m[1].toLowerCase();
        const val = m[2] ?? m[3] ?? m[4] ?? '';
        out[key] = val;
    }
    return {
        id: (out.id || '').slice(0, 80) || `artifact-${Date.now().toString(36)}`,
        kind: (out.kind || 'code').toLowerCase().slice(0, 20),
        title: (out.title || '제목 없음').slice(0, 200),
        lang: out.lang || out.language || null,
    };
}
