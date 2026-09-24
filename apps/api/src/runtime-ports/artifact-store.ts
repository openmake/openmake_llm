/**
 * Artifact Store 포트 — 생성 산출물의 저장·소유·접근 판정 (Base·Add-on 통합 P04, 2026-09-23).
 *
 * Base 소유 경계(계획서 4·12): 소유권·접근·용량·보존·일반 참조. Add-on 은 자기 요청 scope 의 저장만 할 수 있고
 * (`scopedArtifactStore`), 무관리 파일 경로를 발급받지 못한다. 신규 파일은 공개 정적 root 밖(비공개 디렉토리)에 쓰고
 * `generated_artifacts` 행을 **먼저** 만든다 — 행 없는 파일은 서빙되지 않는다.
 *
 * 접근 판정(`resolveArtifactForRead`):
 *   - 레코드 있음 → 소유자 본인·관리자·유효한 전달 티켓만. `deleted_at` 이면 없음. 소유자 NULL(게스트 생성)은 신원이 없어
 *     종전처럼 공개 — 코드로 묶을 소유자가 없는 유일한 예외이며 `guest_public` 으로 드러낸다.
 *   - 레코드 없음 + 공개 root 에 파일 있음 → **격리**(`isolated`): 소유권 미상 종전 파일은 지우지 않고 공개 접근만 끊는다(12.1, T27).
 *   - `reports/` 하위(예약 리포트 게시)는 이 포트의 대상이 아니다(핸들러가 static 으로 넘긴다).
 * 전달 티켓: bearer 전용 클라이언트(iOS)가 `<img>` 로 못 싣는 쿠키 대신 짧은 수명·경로 고정 HMAC 토큰을 쿼리(`t`)로 붙인다.
 *
 * @module runtime-ports/artifact-store
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { getConfig } from '../config';
import { GENERATED_ARTIFACT_LIMITS } from '../config/runtime-limits';
import { getPool } from '../data/models/unified-database';
import { GeneratedArtifactsRepository, type GeneratedArtifactRow } from '../data/repositories/generated-artifacts-repo';
import { locateGeneratedFile, newGeneratedFileName, writeGeneratedFilePrivate } from '../tools/generated-media';
import { createLogger } from '../utils/logger';

const logger = createLogger('ArtifactStore');

/** 클라이언트에 노출하는 참조 — 서버 레코드(owner·storage·hash)와 분리한다(계획서 12) */
export interface ArtifactRef {
    id: string;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    displayCategory?: 'image' | 'audio' | 'video';
    /** 전환 기간 호환 — 종전 마크다운이 참조하는 `/generated/<name>` */
    urlPath: string;
}

export interface SaveArtifactInput {
    kind: 'image' | 'audio' | 'video';
    prefix: string;
    ext: string;
    bytes: Buffer;
    mime: string;
}

export interface ArtifactScope {
    userId?: string;
    sessionId?: string;
    capability?: string;
}

/** Add-on 에 주는 좁은 인터페이스 — 자기 scope 로만 쓰고, 자기 scope 가 읽을 수 있는 것만 읽는다 */
export interface ScopedArtifactStore {
    save(input: SaveArtifactInput): Promise<ArtifactRef>;
    /** `/generated/<name>` 을 이 scope 가 읽어도 되면 바이트를 준다(소유자 불일치·삭제·격리는 throw) */
    read(urlPath: string, maxBytes: number): Promise<{ bytes: Buffer; mime: string; name: string }>;
}

const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
    webm: 'video/webm', mp4: 'video/mp4',
};

export function mimeForExt(ext: string): string {
    return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** 실제 바이트로 MIME 을 확인한다 — 이름만 믿지 않는다(계획서 12). 모르면 null(거절하지 않고 확장자 값을 쓴다) */
export function sniffMime(bytes: Buffer): string | null {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (bytes.length >= 6 && /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
    if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
    if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
    if (bytes.length >= 3 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'audio/mpeg';
    if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return bytes.toString('ascii', 8, 12).startsWith('M4A') ? 'audio/mp4' : 'video/mp4';
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
    return null;
}

/** 저장 — 레코드 먼저, 파일은 그 다음(파일만 있고 레코드 없는 상태를 만들지 않는다). HTML 등 능동 콘텐츠는 받지 않는다 */
export async function saveGeneratedArtifact(scope: ArtifactScope, input: SaveArtifactInput): Promise<ArtifactRef> {
    if (input.bytes.length === 0) throw new Error('빈 산출물은 저장하지 않습니다');
    if (input.bytes.length > GENERATED_ARTIFACT_LIMITS.MAX_BYTES) throw new Error(`산출물이 너무 큽니다 (${input.bytes.length}B > ${GENERATED_ARTIFACT_LIMITS.MAX_BYTES}B)`);
    const sniffed = sniffMime(input.bytes);
    const mime = sniffed ?? (input.mime || mimeForExt(input.ext));
    if (!/^(image|audio|video)\//.test(mime)) throw new Error(`허용되지 않는 산출물 형식: ${mime}`);
    const fileName = newGeneratedFileName(input.prefix, input.ext);
    const sha256 = crypto.createHash('sha256').update(input.bytes).digest('hex');
    const row = await new GeneratedArtifactsRepository(getPool()).insert({
        fileName, ownerUserId: scope.userId ?? null, sessionId: scope.sessionId ?? null, mime, sizeBytes: input.bytes.length, sha256,
        storage: 'private', capability: scope.capability ?? null,
    });
    const { urlPath } = writeGeneratedFilePrivate(fileName, input.bytes);
    return { id: String(row.id), mimeType: mime, fileName, sizeBytes: input.bytes.length, displayCategory: input.kind, urlPath };
}

export type ArtifactReadVerdict =
    | { ok: true; absPath: string; mime: string; row: GeneratedArtifactRow | null; reason: 'owner' | 'admin' | 'ticket' | 'guest_public' }
    | { ok: false; status: 401 | 403 | 404; reason: 'not_found' | 'deleted' | 'auth_required' | 'forbidden' | 'isolated' };

export interface ArtifactViewer {
    userId?: string;
    isAdmin?: boolean;
    /** 전달 티켓(쿼리 `t`) */
    ticket?: string;
}

/**
 * 읽기 판정 — 백엔드 직결과 Next rewrite 경유가 **같은 함수**를 지난다(T28).
 */
export async function resolveArtifactForRead(name: string, viewer: ArtifactViewer): Promise<ArtifactReadVerdict> {
    const located = locateGeneratedFile(name);
    if (!located) return { ok: false, status: 404, reason: 'not_found' };
    let row: GeneratedArtifactRow | null = null;
    try {
        row = await new GeneratedArtifactsRepository(getPool()).getByFileName(name);
    } catch (err) {
        // 소유 레코드를 읽지 못하면 내려주지 않는다(정책 없음으로 해석하지 않는다)
        logger.warn(`산출물 레코드 조회 실패 — 거절: ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, status: 403, reason: 'forbidden' };
    }
    if (!row) {
        // 소유권 미상 종전 파일 — 삭제하지 않고 공개 접근만 끊는다(관리자 복구 대상)
        return { ok: false, status: 403, reason: 'isolated' };
    }
    if (row.deletedAt) return { ok: false, status: 404, reason: 'deleted' };
    const mime = row.mime || mimeForExt(name.split('.').pop() ?? '');
    if (row.ownerUserId === null) return { ok: true, absPath: located.absPath, mime, row, reason: 'guest_public' };
    if (viewer.ticket && verifyDeliveryTicket(name, viewer.ticket)) return { ok: true, absPath: located.absPath, mime, row, reason: 'ticket' };
    if (!viewer.userId) return { ok: false, status: 401, reason: 'auth_required' };
    if (viewer.isAdmin) return { ok: true, absPath: located.absPath, mime, row, reason: 'admin' };
    if (viewer.userId === row.ownerUserId) return { ok: true, absPath: located.absPath, mime, row, reason: 'owner' };
    return { ok: false, status: 403, reason: 'forbidden' };
}

/* ── 전달 티켓 — HMAC(JWT_SECRET) · 파일명 고정 · 만료 ── */

function ticketSecret(): string {
    return getConfig().jwtSecret;
}

export function issueDeliveryTicket(name: string, now = Date.now()): string {
    const exp = now + GENERATED_ARTIFACT_LIMITS.TICKET_TTL_MS;
    const sig = crypto.createHmac('sha256', ticketSecret()).update(`${name}|${exp}`).digest('base64url');
    return `${exp}.${sig}`;
}

export function verifyDeliveryTicket(name: string, ticket: string, now = Date.now()): boolean {
    const [expStr, sig] = ticket.split('.');
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || !sig || now > exp) return false;
    const expected = crypto.createHmac('sha256', ticketSecret()).update(`${name}|${exp}`).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Add-on 실행 문맥에 주는 scoped 구현 */
export function scopedArtifactStore(scope: ArtifactScope): ScopedArtifactStore {
    return {
        save: (input) => saveGeneratedArtifact(scope, input),
        async read(urlPath, maxBytes) {
            const m = /^\/generated\/([A-Za-z0-9._-]+)$/.exec(urlPath.trim());
            if (!m) throw new Error(`찾을 수 없는 파일: ${urlPath}`);
            const v = await resolveArtifactForRead(m[1], { userId: scope.userId });
            if (!v.ok) throw new Error(`파일 '${urlPath}' 에 접근할 수 없습니다 (${v.reason})`);
            const size = fs.statSync(v.absPath).size;
            if (size > maxBytes) throw new Error(`파일 '${urlPath}' 가 너무 큽니다 (${size}B > ${maxBytes}B)`);
            return { bytes: fs.readFileSync(v.absPath), mime: v.mime, name: m[1] };
        },
    };
}
