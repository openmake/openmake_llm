/**
 * ============================================================
 * Semantic Embedding Disk Cache
 * ============================================================
 *
 * 100명 에이전트 임베딩을 hash 키 기반 JSON 파일에 캐싱.
 * 동일 description+keywords 조합은 다음 실행 시 임베딩 호출 0회.
 *
 * 안전성 (Gemini 권고):
 * - atomic write (tmp 파일 + rename) — 부분 쓰기로 인한 손상 방지
 * - 동시 쓰기는 CLI 단독 가정 (서버 + CLI 동시 실행은 비권장)
 *
 * @module agents/semantic-cache
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('SemanticCache');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../cache/semantic-embeddings.json');

export interface SemanticCacheEntry {
    /** description+keywords sha256 (first 16 hex chars) */
    hash: string;
    /** 임베딩 벡터 */
    embedding: number[];
    /** 임베딩에 사용된 모델 (모델 변경 시 무효화 판단) */
    model: string;
    /** 캐시 작성 시각 */
    cachedAt: number;
}

export interface SemanticCacheFile {
    version: string;
    /** key: hash, value: 엔트리 */
    entries: Record<string, SemanticCacheEntry>;
}

const CACHE_FILE_VERSION = '1.0';

export function computeHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function loadCache(filePath: string = DEFAULT_CACHE_PATH): SemanticCacheFile {
    if (!fs.existsSync(filePath)) {
        return { version: CACHE_FILE_VERSION, entries: {} };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as SemanticCacheFile;
        if (parsed.version !== CACHE_FILE_VERSION) {
            logger.warn(`캐시 버전 불일치 (${parsed.version} vs ${CACHE_FILE_VERSION}) — 새로 시작`);
            return { version: CACHE_FILE_VERSION, entries: {} };
        }
        return parsed;
    } catch (e) {
        logger.warn('캐시 파일 손상, 새로 시작:', e instanceof Error ? e.message : e);
        return { version: CACHE_FILE_VERSION, entries: {} };
    }
}

/**
 * Atomic write — tmp 파일에 쓰고 rename으로 원자적 교체.
 * 쓰기 도중 프로세스 종료되어도 기존 파일이 손상되지 않음.
 */
export function saveCache(cache: SemanticCacheFile, filePath: string = DEFAULT_CACHE_PATH): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(cache), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    } catch (e) {
        // 실패 시 tmp 파일 정리
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
        throw e;
    }
}

/** 캐시 통계 (관측성용) */
export interface CacheUsageStats {
    /** 디스크 캐시에서 재사용된 엔트리 수 */
    cacheHits: number;
    /** 새로 임베딩한 엔트리 수 */
    cacheMisses: number;
    /** 모델 변경으로 무효화된 엔트리 수 */
    modelMismatches: number;
}

/**
 * 캐시에서 임베딩을 조회. 모델이 일치하지 않으면 미스로 간주.
 */
export function lookupEmbedding(
    cache: SemanticCacheFile,
    text: string,
    model: string
): { hit: boolean; embedding?: number[]; modelMismatch: boolean } {
    const hash = computeHash(text);
    const entry = cache.entries[hash];
    if (!entry) {
        return { hit: false, modelMismatch: false };
    }
    if (entry.model !== model) {
        return { hit: false, modelMismatch: true };
    }
    return { hit: true, embedding: entry.embedding, modelMismatch: false };
}

/**
 * 새 임베딩을 캐시에 저장.
 */
export function storeEmbedding(
    cache: SemanticCacheFile,
    text: string,
    embedding: number[],
    model: string
): void {
    const hash = computeHash(text);
    cache.entries[hash] = {
        hash,
        embedding,
        model,
        cachedAt: Date.now(),
    };
}

export const DEFAULT_SEMANTIC_CACHE_PATH = DEFAULT_CACHE_PATH;
