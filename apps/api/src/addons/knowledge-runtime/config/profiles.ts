/**
 * Knowledge 정책 프로필 해석 — 청크 크기·top-K·한도 같은 정책값은 코드 상수가 아니라 `knowledge_profiles` 행이다.
 * Space 는 `space` 프로필(없으면 기본)을 통해 chunker·retrieval·limits 프로필을 가리킨다.
 * 요청 오버라이드는 허용 목록 항목만, 프로필 상한 안에서만 받는다.
 *
 * @module addons/knowledge-runtime/config/profiles
 */
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';

export type ProfileKind = 'space' | 'chunker' | 'retrieval' | 'limits';

export interface ChunkerProfile { id: string; strategy: string; size: number; overlap: number }
export interface RetrievalProfile { id: string; topK: number; candidateCount: number; minSimilarity: number; maxContextChars: number; maxTopK: number }
export interface LimitsProfile {
    id: string;
    maxFileBytes: number;
    maxDocumentsPerSpace: number;
    maxSpacesPerScope: number;
    allowedMimeTypes: string[];
    purgeAfterDays: number;
    minCharsPerPdfPage: number;
    embedBatchSize: number;
    ingestConcurrency: number;
    jobLeaseMs: number;
    jobMaxAttempts: number;
    orgWriteRoles: string[];
}
export interface SpaceProfiles { chunker: ChunkerProfile; retrieval: RetrievalProfile; limits: LimitsProfile }

interface ProfileRow { id: string; kind: ProfileKind; config: Record<string, unknown>; is_default: boolean }

let cache: { at: number; rows: ProfileRow[] } | null = null;

async function rows(): Promise<ProfileRow[]> {
    if (cache && Date.now() - cache.at < KNOWLEDGE_RUNTIME.PROFILE_CACHE_TTL_MS) return cache.rows;
    const r = await kdb().query<ProfileRow>('SELECT id, kind, config, is_default FROM knowledge_profiles');
    cache = { at: Date.now(), rows: r.rows };
    return r.rows;
}

/** 관리자 변경 직후 반영용 */
export function clearProfileCache(): void {
    cache = null;
}

async function pick<T>(kind: ProfileKind, id?: string | null): Promise<T & { id: string }> {
    const all = await rows();
    const row = (id ? all.find((p) => p.id === id && p.kind === kind) : undefined) ?? all.find((p) => p.kind === kind && p.is_default);
    if (!row) throw new Error(`Knowledge 프로필 없음: ${kind}${id ? `(${id})` : ''}`);
    return { ...(row.config as T), id: row.id };
}

export async function getDefaultLimits(): Promise<LimitsProfile> {
    return pick<LimitsProfile>('limits');
}

/** Space 가 가리키는 프로필 묶음 — Space 에 지정이 없거나 가리킨 행이 없으면 기본 프로필 */
export async function resolveSpaceProfiles(spaceProfileId?: string | null): Promise<SpaceProfiles> {
    const space = await pick<{ chunker?: string; retrieval?: string; limits?: string }>('space', spaceProfileId);
    const [chunker, retrieval, limits] = await Promise.all([
        pick<ChunkerProfile>('chunker', space.chunker),
        pick<RetrievalProfile>('retrieval', space.retrieval),
        pick<LimitsProfile>('limits', space.limits),
    ]);
    return { chunker, retrieval, limits };
}

/** 요청 오버라이드(허용 항목: topK) — 1..maxTopK 로 자른다. 그 밖의 항목은 무시한다 */
export function applyRetrievalOverride(profile: RetrievalProfile, override?: { topK?: unknown }): RetrievalProfile {
    const raw = Number(override?.topK);
    if (!Number.isFinite(raw)) return profile;
    return { ...profile, topK: Math.min(profile.maxTopK, Math.max(1, Math.floor(raw))) };
}
