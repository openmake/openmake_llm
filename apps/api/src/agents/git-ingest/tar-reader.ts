/**
 * 최소 tar 리더 — OCI 레이어(tar · tar+gzip) 해제용(P8). 외부 의존 없음(외부 바이너리·새 패키지 금지).
 *
 * 메모리 안에서만 읽는다 — 디스크에 쓰지 않으므로 경로는 맵 키일 뿐이고, 경로 탈출·크기·파일 수 방어는
 * 호출부가 ZIP 설치와 같은 함수(`collectArchiveFiles`)로 건다.
 *
 * 지원: ustar/GNU/pax 일반 파일(`0`·NUL·`7`), 디렉토리(`5`, 건너뜀), pax 확장 헤더(`x` 의 path·size),
 * GNU 긴 이름(`L`). 링크(`1`·`2`)·장치·FIFO 는 **건너뛴다**(심링크로 다른 파일을 가리키는 설치 금지 — ZIP·로컬과 같음).
 * 숫자 필드의 base-256 표기·헤더 체크섬 불일치는 거절한다.
 *
 * @module agents/git-ingest/tar-reader
 */

const BLOCK = 512;

export interface TarEntry {
    path: string;
    data: Uint8Array;
}

function readString(buf: Uint8Array, off: number, len: number): string {
    let end = off;
    while (end < off + len && buf[end] !== 0) end++;
    return Buffer.from(buf.subarray(off, end)).toString('utf-8');
}

function readOctal(buf: Uint8Array, off: number, len: number, field: string): number {
    if (buf[off] & 0x80) throw new Error(`TAR_INVALID: base-256 ${field} 미지원`);
    const s = readString(buf, off, len).trim();
    if (s === '') return 0;
    if (!/^[0-7]+$/.test(s)) throw new Error(`TAR_INVALID: ${field} 필드 형식 오류`);
    const n = parseInt(s, 8);
    if (!Number.isSafeInteger(n)) throw new Error(`TAR_INVALID: ${field} 범위 초과`);
    return n;
}

function isZeroBlock(buf: Uint8Array, off: number): boolean {
    for (let i = off; i < off + BLOCK; i++) if (buf[i] !== 0) return false;
    return true;
}

function verifyChecksum(buf: Uint8Array, off: number): void {
    const stored = readOctal(buf, off + 148, 8, 'chksum');
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 0x20 : buf[off + i];
    if (sum !== stored) throw new Error('TAR_INVALID: 헤더 체크섬 불일치');
}

/** PURE: pax 확장 헤더 레코드(`<len> key=value\n`) 파싱 */
function parsePax(data: Uint8Array): Record<string, string> {
    const out: Record<string, string> = {};
    const text = Buffer.from(data).toString('utf-8');
    let i = 0;
    while (i < text.length) {
        const sp = text.indexOf(' ', i);
        if (sp < 0) break;
        const len = parseInt(text.slice(i, sp), 10);
        if (!Number.isFinite(len) || len <= 0 || i + len > text.length) throw new Error('TAR_INVALID: pax 레코드 형식 오류');
        const rec = text.slice(sp + 1, i + len - 1);
        const eq = rec.indexOf('=');
        if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
        i += len;
    }
    return out;
}

/**
 * PURE: tar 바이트 → 일반 파일 엔트리(등장 순서). `maxEntries` 를 넘는 헤더 수는 즉시 거절(엔트리 폭탄).
 * 경로는 앞 `./` 만 걷어낸 원문이다 — 탈출 판정은 호출부.
 */
export function readTar(buf: Uint8Array, opts: { maxEntries: number }): TarEntry[] {
    const out: TarEntry[] = [];
    let off = 0;
    let headers = 0;
    let pendingPath: string | undefined;
    let pendingSize: number | undefined;
    while (off + BLOCK <= buf.length) {
        if (isZeroBlock(buf, off)) break;
        if (++headers > opts.maxEntries * 4) throw new Error(`TAR_TOO_MANY_ENTRIES: > ${opts.maxEntries}`);
        verifyChecksum(buf, off);
        const type = String.fromCharCode(buf[off + 156] || 0x30);
        const headerSize = readOctal(buf, off + 124, 12, 'size');
        const isMeta = type === 'x' || type === 'g' || type === 'L';
        const size = isMeta ? headerSize : (pendingSize ?? headerSize);
        const dataOff = off + BLOCK;
        if (dataOff + size > buf.length) throw new Error('TAR_INVALID: 엔트리가 아카이브 끝을 넘는다');
        const data = buf.subarray(dataOff, dataOff + size);
        const next = dataOff + Math.ceil(size / BLOCK) * BLOCK;

        if (type === 'x') {           // pax 확장 헤더 — 다음 엔트리에 적용
            const pax = parsePax(data);
            if (pax.path !== undefined) pendingPath = pax.path;
            if (pax.size !== undefined) {
                if (!/^\d+$/.test(pax.size)) throw new Error('TAR_INVALID: pax size 형식 오류');
                pendingSize = Number(pax.size);
            }
            off = next;
            continue;
        }
        if (type === 'g') { off = next; continue; }     // pax 전역 헤더 — 경로·크기에 쓰지 않는다
        if (type === 'L') {           // GNU 긴 이름
            pendingPath = readString(data, 0, data.length);
            off = next;
            continue;
        }

        const name = readString(buf, off, 100);
        const magic = readString(buf, off + 257, 6);
        const prefix = magic.startsWith('ustar') ? readString(buf, off + 345, 155) : '';
        let path = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
        pendingPath = undefined;
        pendingSize = undefined;
        while (path.startsWith('./')) path = path.slice(2);

        if (type === '0' || type === '\0' || type === '7') {
            out.push({ path, data });
            if (out.length > opts.maxEntries) throw new Error(`TAR_TOO_MANY_ENTRIES: > ${opts.maxEntries}`);
        }
        // '5' 디렉토리 · '1'/'2' 링크 · 장치 · FIFO · 그 밖 — 건너뛴다
        off = next;
    }
    return out;
}
