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
 * @see backend/api/src/llm/reasoning-tag-parser.ts (같은 패턴)
 */

export interface ArtifactInfo {
    id: string;
    kind: string;
    title: string;
    lang: string | null;
}

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
