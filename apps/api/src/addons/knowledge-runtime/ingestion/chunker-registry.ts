/**
 * 청커 레지스트리 — 이름 → 청킹 전략. 크기·오버랩 같은 수치는 코드 리터럴이 아니라 프로필(`ChunkerProfile`)에서 온다.
 *
 * `fixed-token`: 토큰 예산만큼 단어를 모아 청크를 만들고, 다음 청크는 오버랩 토큰만큼 겹쳐 시작한다.
 * 토큰 수는 레포 공용 추정기(`estimateTokens`)로 센다. 각 청크는 원본 문자 오프셋·페이지 범위·(마크다운) heading 경로를 갖는다.
 *
 * @module addons/knowledge-runtime/ingestion/chunker-registry
 */
import { createHash } from 'node:crypto';
import { estimateTokens } from '../../../llm/model-pool';
import type { ChunkerProfile } from '../config/profiles';
import type { ParsedPage } from './parser-registry';

/** 청커가 만든 청크 — DB 저장 전 형태(id·embedding 은 나중) */
export interface ProducedChunk {
    sequence: number;
    content: string;
    contentHash: string;
    tokenCount: number;
    charStart: number;
    charEnd: number;
    pageStart?: number;
    pageEnd?: number;
    headingPath?: string;
}

export interface ChunkInput {
    text: string;
    profile: ChunkerProfile;
    /** 파서 페이지 경계 — 있으면 청크에 페이지 범위를 매긴다 */
    pages?: ParsedPage[];
    /** 마크다운이면 heading 경로를 계산한다 */
    markdown?: boolean;
}

export interface ChunkStrategy {
    name: string;
    chunk(input: ChunkInput): ProducedChunk[];
}

/** heading 경로 한 조각 최대 길이(과도한 제목 방지) */
const HEADING_SEGMENT_MAX = 120;

/** 단어+뒤 공백을 하나의 원자로 — 원본 오프셋을 보존한다 */
interface Atom { start: number; end: number; tok: number }

function tokenize(text: string): Atom[] {
    const atoms: Atom[] = [];
    const re = /\S+\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        atoms.push({ start, end, tok: Math.max(1, estimateTokens(m[0])) });
    }
    return atoms;
}

/** 문자 오프셋 → 페이지 번호(경계에 걸치면 시작 페이지). 없으면 undefined */
function pageAt(offset: number, pages?: ParsedPage[]): number | undefined {
    if (!pages || pages.length === 0) return undefined;
    for (const p of pages) if (offset >= p.charStart && offset < p.charEnd) return p.page;
    // 경계 밖(마지막 문자 등)은 마지막 페이지로
    return pages[pages.length - 1].page;
}

/** 마크다운 heading 이벤트 — 라인 시작 오프셋·레벨·텍스트 */
interface HeadingEvent { offset: number; level: number; text: string }

function headingEvents(text: string): HeadingEvent[] {
    const events: HeadingEvent[] = [];
    const re = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        events.push({ offset: m.index, level: m[1].length, text: m[2].trim().slice(0, HEADING_SEGMENT_MAX) });
    }
    return events;
}

/** charStart 시점에 유효한 heading 스택을 재구성해 경로 문자열(없으면 undefined) */
function headingPathAt(offset: number, events: HeadingEvent[]): string | undefined {
    const stack: HeadingEvent[] = [];
    for (const e of events) {
        if (e.offset > offset) break;
        while (stack.length > 0 && stack[stack.length - 1].level >= e.level) stack.pop();
        stack.push(e);
    }
    return stack.length > 0 ? stack.map((s) => s.text).join(' / ') : undefined;
}

function sha256(s: string): string {
    return createHash('sha256').update(s, 'utf8').digest('hex');
}

const fixedTokenStrategy: ChunkStrategy = {
    name: 'fixed-token',
    chunk({ text, profile, pages, markdown }) {
        const size = Math.max(1, Math.floor(profile.size));
        const overlap = Math.max(0, Math.min(Math.floor(profile.overlap), size - 1));
        const atoms = tokenize(text);
        if (atoms.length === 0) return [];
        const events = markdown ? headingEvents(text) : [];
        const chunks: ProducedChunk[] = [];
        let i = 0;
        let sequence = 0;
        while (i < atoms.length) {
            let j = i;
            let tok = 0;
            while (j < atoms.length && (tok === 0 || tok + atoms[j].tok <= size)) {
                tok += atoms[j].tok;
                j++;
            }
            const charStart = atoms[i].start;
            const charEnd = atoms[j - 1].end;
            const content = text.slice(charStart, charEnd);
            chunks.push({
                sequence: sequence++,
                content,
                contentHash: sha256(content),
                tokenCount: estimateTokens(content),
                charStart,
                charEnd,
                pageStart: pageAt(charStart, pages),
                pageEnd: pageAt(Math.max(charStart, charEnd - 1), pages),
                headingPath: markdown ? headingPathAt(charStart, events) : undefined,
            });
            if (j >= atoms.length) break;
            // 다음 청크 시작 — 오버랩 토큰만큼 뒤로 물린다(단, 최소 한 원자는 전진)
            let nextI = j;
            if (overlap > 0) {
                let ov = 0;
                let k = j;
                while (k > i + 1 && ov < overlap) {
                    k--;
                    ov += atoms[k].tok;
                }
                nextI = k;
            }
            i = nextI <= i ? i + 1 : nextI;
        }
        return chunks;
    },
};

const STRATEGIES: Readonly<Record<string, ChunkStrategy>> = {
    [fixedTokenStrategy.name]: fixedTokenStrategy,
};

/** 이름의 청킹 전략 — 없으면 undefined */
export function chunkerFor(name: string): ChunkStrategy | undefined {
    return STRATEGIES[name];
}

export function chunkStrategyNames(): string[] {
    return Object.keys(STRATEGIES);
}
