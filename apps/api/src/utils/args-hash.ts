/**
 * 도구 인자 해시 — 같은 도구 호출을 키 순서와 무관하게 알아보기 위한 키(승인 저장소·보안 감사 공용).
 *
 * @module utils/args-hash
 */
import { createHash } from 'crypto';

/** PURE: 객체 키를 정렬한 JSON — 같은 인자가 키 순서 때문에 다른 호출로 보이지 않게 한다(배열 순서는 의미가 있어 그대로). */
export function canonicalJson(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
}

/** PURE: 키를 정렬한 인자 JSON 의 sha256 hex. 인자가 없으면 `{}` 의 해시. */
export function hashToolArgs(args: Record<string, unknown> | undefined): string {
    return createHash('sha256').update(canonicalJson(args ?? {})).digest('hex');
}
