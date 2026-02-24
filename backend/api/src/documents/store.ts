/**
 * Document Store
 * 업로드된 문서 저장소
 * 
 * 🔒 보안 강화: TTL 기반 자동 정리로 메모리 누수 방지
 * 📦 PostgreSQL write-through cache: DB를 primary store로 사용하고
 *    인메모리 Map을 read cache로 유지하여 빠른 동기 읽기를 보장합니다.
 */

import { DocumentResult } from './index';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { getPool } from '../data/models/unified-database';
import type { Pool } from 'pg';

const logger = createLogger('DocumentStore');

// 문서 TTL 설정 (기본: 1시간)
const DOCUMENT_TTL_MS = getConfig().documentTtlHours * 60 * 60 * 1000;
const MAX_DOCUMENTS = getConfig().maxUploadedDocuments;

interface StoredDocument {
    document: DocumentResult;
    createdAt: number;
    lastAccessedAt: number;
}

/**
 * DocumentStore 인터페이스 - Map과 호환되는 최소한의 인터페이스
 */
export interface DocumentStore {
    get(key: string): DocumentResult | undefined;
    set(key: string, value: DocumentResult): this;
    delete(key: string): boolean;
    has(key: string): boolean;
    clear(): void;
    readonly size: number;
    forEach(callbackfn: (value: DocumentResult, key: string, map: DocumentStore) => void, thisArg?: unknown): void;
    entries(): IterableIterator<[string, DocumentResult]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<DocumentResult>;
    [Symbol.iterator](): IterableIterator<[string, DocumentResult]>;
}

// ============================================
// DB helper: fire-and-forget async operations
// All DB errors are caught and logged silently
// so the in-memory cache always remains functional.
// ============================================

/**
 * Safely obtain the pg Pool. Returns null when the pool is not yet
 * available (e.g. during early startup or in test environments).
 */
function safeGetPool(): Pool | null {
    try {
        return getPool();
    } catch {
        return null;
    }
}

function dbUpsertDocument(docId: string, document: DocumentResult, createdAt: number, lastAccessedAt: number): void {
    const pool = safeGetPool();
    if (!pool) return;

    const expiresAt = new Date(lastAccessedAt + DOCUMENT_TTL_MS).toISOString();
    const createdAtIso = new Date(createdAt).toISOString();
    const lastAccessedAtIso = new Date(lastAccessedAt).toISOString();

    pool.query(
        `INSERT INTO uploaded_documents (doc_id, document, created_at, last_accessed_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (doc_id) DO UPDATE SET
             document = EXCLUDED.document,
             last_accessed_at = EXCLUDED.last_accessed_at,
             expires_at = EXCLUDED.expires_at`,
        [docId, JSON.stringify(document), createdAtIso, lastAccessedAtIso, expiresAt]
    ).catch(err => {
        logger.warn(`[DocumentStore/DB] upsert failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function dbUpdateLastAccessed(docId: string, lastAccessedAt: number): void {
    const pool = safeGetPool();
    if (!pool) return;

    const lastAccessedAtIso = new Date(lastAccessedAt).toISOString();
    const expiresAt = new Date(lastAccessedAt + DOCUMENT_TTL_MS).toISOString();

    pool.query(
        `UPDATE uploaded_documents SET last_accessed_at = $1, expires_at = $2 WHERE doc_id = $3`,
        [lastAccessedAtIso, expiresAt, docId]
    ).catch(err => {
        logger.warn(`[DocumentStore/DB] update last_accessed failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function dbDeleteDocument(docId: string): void {
    const pool = safeGetPool();
    if (!pool) return;

    pool.query(`DELETE FROM uploaded_documents WHERE doc_id = $1`, [docId]).catch(err => {
        logger.warn(`[DocumentStore/DB] delete failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function dbDeleteAllDocuments(): void {
    const pool = safeGetPool();
    if (!pool) return;

    pool.query(`DELETE FROM uploaded_documents`).catch(err => {
        logger.warn(`[DocumentStore/DB] clear failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function dbCleanupExpired(): void {
    const pool = safeGetPool();
    if (!pool) return;

    pool.query(`DELETE FROM uploaded_documents WHERE expires_at < NOW()`).catch(err => {
        logger.warn(`[DocumentStore/DB] cleanup expired failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * Async DB read — warms the in-memory cache on cache miss.
 * Called fire-and-forget from get(); the current get() returns undefined,
 * but the next get() will find the document in cache.
 */
function dbWarmCache(docId: string, cache: Map<string, StoredDocument>): void {
    const pool = safeGetPool();
    if (!pool) return;

    pool.query(
        `SELECT document, created_at, last_accessed_at FROM uploaded_documents WHERE doc_id = $1 AND expires_at > NOW()`,
        [docId]
    ).then(result => {
        if (result.rows.length === 0) return;
        const row = result.rows[0] as { document: DocumentResult; created_at: string; last_accessed_at: string };

        // Only warm if still absent from cache (avoid overwriting a fresher entry)
        if (!cache.has(docId)) {
            const doc: DocumentResult = typeof row.document === 'string'
                ? JSON.parse(row.document) as DocumentResult
                : row.document;
            cache.set(docId, {
                document: doc,
                createdAt: new Date(row.created_at).getTime(),
                lastAccessedAt: new Date(row.last_accessed_at).getTime()
            });
            logger.info(`[DocumentStore/DB] cache warmed for ${docId}`);
        }
    }).catch(err => {
        logger.warn(`[DocumentStore/DB] warm cache failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * 🔒 TTL 기반 Document Map
 * Map과 호환되는 인터페이스를 제공하며 TTL 기반 자동 정리 기능 포함
 * 
 * PostgreSQL write-through cache:
 * - set(): 캐시 + DB 동시 기록
 * - get(): 캐시 우선, 미스 시 비동기 DB 조회로 캐시 워밍
 * - delete(): 캐시 + DB 동시 삭제
 * - cleanupExpired(): 캐시 + DB 동시 정리
 * 
 * Note: Map을 직접 상속하지 않고 래퍼 패턴 사용 (Node.js 25+ TypeScript 호환성)
 */
class TTLDocumentMap implements DocumentStore {
    private store: Map<string, StoredDocument> = new Map();
    private cleanupTimer: ReturnType<typeof setInterval>;

    constructor() {
        // 정리 스케줄러 (10분마다 실행)
        this.cleanupTimer = setInterval(() => this.cleanupExpired(), 10 * 60 * 1000);
        // unref() - 타이머가 프로세스 종료를 막지 않도록 설정
        if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
            (this.cleanupTimer as NodeJS.Timeout).unref();
        }
    }

    /**
     * 정리 스케줄러 중지 (서버 종료 시)
     */
    dispose(): void {
        clearInterval(this.cleanupTimer);
    }

    /**
     * 🔒 만료된 문서 정리 (캐시 + DB)
     */
    private cleanupExpired(): void {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [id, stored] of this.store.entries()) {
            if (now - stored.lastAccessedAt > DOCUMENT_TTL_MS) {
                this.store.delete(id);
                cleanedCount++;
            }
        }
        
        // DB에서도 만료된 행 삭제 (fire-and-forget)
        dbCleanupExpired();
        
        if (cleanedCount > 0) {
            logger.info(`[DocumentStore] 만료된 문서 ${cleanedCount}개 정리됨 (현재 ${this.store.size}개)`);
        }
    }

    /**
     * 🔒 최대 개수 초과 시 가장 오래된 문서 제거 (LRU 방식)
     */
    private enforceMaxDocuments(): void {
        if (this.store.size <= MAX_DOCUMENTS) return;
        
        const entries = Array.from(this.store.entries())
            .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
        
        const toRemove = entries.slice(0, this.store.size - MAX_DOCUMENTS);
        for (const [id] of toRemove) {
            this.store.delete(id);
            dbDeleteDocument(id);
        }
        
        logger.info(`[DocumentStore] 용량 초과로 ${toRemove.length}개 문서 제거됨`);
    }

    // Map 호환 인터페이스 구현
    get(key: string): DocumentResult | undefined {
        const stored = this.store.get(key);
        if (!stored) {
            // Cache miss — fire async DB read to warm cache for next call
            dbWarmCache(key, this.store);
            return undefined;
        }
        
        // 접근 시간 갱신 (LRU)
        stored.lastAccessedAt = Date.now();
        // DB에도 접근 시간 갱신 (fire-and-forget)
        dbUpdateLastAccessed(key, stored.lastAccessedAt);
        return stored.document;
    }

    set(key: string, value: DocumentResult): this {
        const now = Date.now();
        this.store.set(key, {
            document: value,
            createdAt: now,
            lastAccessedAt: now
        });
        
        // DB에도 기록 (fire-and-forget write-through)
        dbUpsertDocument(key, value, now, now);
        
        this.enforceMaxDocuments();
        logger.info(`[DocumentStore] 문서 저장: ${key} (총 ${this.store.size}개)`);
        return this;
    }

    delete(key: string): boolean {
        const result = this.store.delete(key);
        // DB에서도 삭제 (fire-and-forget)
        dbDeleteDocument(key);
        return result;
    }

    has(key: string): boolean {
        return this.store.has(key);
    }

    clear(): void {
        this.store.clear();
        // DB에서도 전체 삭제 (fire-and-forget)
        dbDeleteAllDocuments();
    }

    get size(): number {
        return this.store.size;
    }

    forEach(callbackfn: (value: DocumentResult, key: string, map: DocumentStore) => void, thisArg?: unknown): void {
        for (const [key, stored] of this.store.entries()) {
            callbackfn.call(thisArg, stored.document, key, this);
        }
    }

    entries(): IterableIterator<[string, DocumentResult]> {
        const self = this;
        return (function* () {
            for (const [key, stored] of self.store.entries()) {
                yield [key, stored.document] as [string, DocumentResult];
            }
        })();
    }

    keys(): IterableIterator<string> {
        return this.store.keys();
    }

    values(): IterableIterator<DocumentResult> {
        const self = this;
        return (function* () {
            for (const stored of self.store.values()) {
                yield stored.document;
            }
        })();
    }

    [Symbol.iterator](): IterableIterator<[string, DocumentResult]> {
        return this.entries();
    }

    get [Symbol.toStringTag](): string {
        return 'TTLDocumentMap';
    }

    // 🔒 추가 유틸리티 메서드
    getStats(): { total: number; oldestAgeMinutes: number; newestAgeMinutes: number; ttlHours: number } {
        if (this.store.size === 0) {
            return { total: 0, oldestAgeMinutes: 0, newestAgeMinutes: 0, ttlHours: DOCUMENT_TTL_MS / 1000 / 60 / 60 };
        }
        
        const now = Date.now();
        let oldest = now;
        let newest = 0;
        
        for (const stored of this.store.values()) {
            if (stored.createdAt < oldest) oldest = stored.createdAt;
            if (stored.createdAt > newest) newest = stored.createdAt;
        }
        
        return {
            total: this.store.size,
            oldestAgeMinutes: Math.round((now - oldest) / 1000 / 60),
            newestAgeMinutes: Math.round((now - newest) / 1000 / 60),
            ttlHours: DOCUMENT_TTL_MS / 1000 / 60 / 60
        };
    }
}

// 현재 업로드된 문서 저장 (싱글톤)
export const uploadedDocuments: DocumentStore = new TTLDocumentMap();
