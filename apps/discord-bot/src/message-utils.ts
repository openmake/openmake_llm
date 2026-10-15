import { DISCORD_CHUNK_LIMIT } from './config';

/**
 * Discord 2000자 제한 대응 분할 — 줄바꿈 경계 우선, 초과 시 하드 분할.
 */
export function splitForDiscord(content: string, limit: number = DISCORD_CHUNK_LIMIT): string[] {
    if (content.length <= limit) return [content];
    const chunks: string[] = [];
    let remaining = content;
    while (remaining.length > limit) {
        let cut = remaining.lastIndexOf('\n', limit);
        if (cut <= 0) cut = limit;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).replace(/^\n/, '');
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}

// 구분 행 — 셀마다 `-` 1개 이상, 정렬 콜론 허용
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
// 닫는 펜스 — 정보 문자열 없이 펜스 글자만(뒤 공백 허용)
const CLOSING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
// String.split 은 lastIndex 를 쓰지 않아 g 플래그 상수를 공유해도 안전하다
const BR_SPLIT_RE = /<br\s*\/?>/gi;
const BULLET_RE = /^(?:[-*]\s+|[•·]\s*)/;
const UNESCAPED_PIPE_RE = /(?<!\\)\|/;

/** 표 한 줄을 셀로 — 앞뒤 파이프는 선택, `\|` 는 셀 안의 글자 `|` */
function splitTableRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** 셀 값을 `<br>` 마다 조각으로 — 앞의 글머리는 떼고 빈 조각은 버린다 */
function cellFragments(cell: string): string[] {
    return cell.split(BR_SPLIT_RE).map((f) => f.trim().replace(BULLET_RE, '').trim()).filter((f) => f.length > 0);
}

function isSeparator(line: string, headerCells: number): boolean {
    return line.includes('|') && TABLE_SEPARATOR_RE.test(line) && splitTableRow(line).length === headerCells;
}

/** 첫 셀 → 제목 — `<br>` 조각을 ', ' 로 잇고 안의 `**` 는 지운다(비면 '') */
function rowTitle(cells: string[]): string {
    return cellFragments(cells[0] ?? '').join(', ').replace(/\*\*/g, '').trim();
}

/** 본문 행 하나 → 목록 줄들 (3열 이상이면 `- 머리: 값`). 2열 이상의 제목 줄은 호출 쪽이 붙인다 */
function rowToLines(cells: string[], headers: string[]): string[] {
    const lines: string[] = [];
    const first = cells[0] ?? '';
    if (headers.length === 1) return first ? [`- ${first}`] : [];
    const labeled = headers.length >= 3;
    for (let i = 1; i < Math.max(cells.length, headers.length); i++) {
        const fragments = cellFragments(cells[i] ?? '');
        if (fragments.length === 0) continue;
        const header = labeled ? headers[i] : undefined;
        if (header) {
            lines.push(`- ${header}: ${fragments[0]}`);
            for (const f of fragments.slice(1)) lines.push(`  - ${f}`);
        } else {
            for (const f of fragments) lines.push(`- ${f}`);
        }
    }
    return lines;
}

/** 1·2열 표의 머리 행 → 이탤릭 한 줄 `*머리1 · 머리2*` (머리가 전부 비면 '') */
function headerLine(headers: string[]): string {
    const joined = headers.map((h) => cellFragments(h).join(', ')).filter((h) => h.length > 0).join(' · ');
    return joined ? `*${joined}*` : '';
}

/**
 * Discord 는 GFM 표를 렌더하지 않는다 — 표를 행마다 `**첫 셀**` + 나머지 셀 목록으로 바꾼다.
 * 1·2열 표는 머리 행을 맨 앞 이탤릭 한 줄로 남기고, 3열 이상은 항목 앞에 머리 이름을 붙인다.
 * 첫 셀이 빈 행은 앞 행에 이어 붙이고, 본문 행이 없는 표는 원문 그대로 둔다.
 * 코드 펜스 안은 건드리지 않고, 구분 행이 없으면 표로 보지 않는다(일반 글의 `|` 오탐 방지).
 */
export function convertTablesForDiscord(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let fence: string | null = null;
    let changed = false;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const fenceMatch = FENCE_RE.exec(line);
        if (fence) {
            const closing = CLOSING_FENCE_RE.exec(line);
            if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
            out.push(line);
            i++;
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            out.push(line);
            i++;
            continue;
        }
        const headers = UNESCAPED_PIPE_RE.test(line) && line.trim() ? splitTableRow(line) : null;
        if (!headers || i + 1 >= lines.length || !isSeparator(lines[i + 1], headers.length)) {
            out.push(line);
            i++;
            continue;
        }
        // 표 블록 — 머리·구분 행 뒤로 파이프가 있는 연속 줄이 본문
        let j = i + 2;
        const blocks: string[][] = [];
        while (j < lines.length && lines[j].trim() && UNESCAPED_PIPE_RE.test(lines[j])) {
            const cells = splitTableRow(lines[j]);
            const items = rowToLines(cells, headers);
            const title = headers.length === 1 ? '' : rowTitle(cells);
            if (headers.length > 1 && !title && blocks.length > 0) {
                blocks[blocks.length - 1].push(...items); // 첫 셀이 빈 이어쓰기 행
            } else {
                const block = title ? [`**${title}**`, ...items] : items;
                if (block.length > 0) blocks.push(block);
            }
            j++;
        }
        // 본문 행이 없으면 표로 보지 않는다
        if (blocks.length === 0) {
            out.push(...lines.slice(i, j));
            i = j;
            continue;
        }
        // 블록 사이는 빈 줄 하나(1열은 목록 한 줄씩이라 붙여 쓴다), 앞뒤 글과 붙어 있으면 빈 줄을 넣는다
        if (out.length > 0 && out[out.length - 1].trim()) out.push('');
        const head = headers.length < 3 ? headerLine(headers) : '';
        const body = blocks.map((b) => b.join('\n')).join(headers.length === 1 ? '\n' : '\n\n');
        out.push(head ? `${head}${headers.length === 1 ? '\n' : '\n\n'}${body}` : body);
        if (j < lines.length && lines[j].trim()) out.push('');
        changed = true;
        i = j;
    }
    return changed ? out.join('\n') : text;
}
