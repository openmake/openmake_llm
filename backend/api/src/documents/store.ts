/**
 * Document Store
 * 업로드된 문서 저장소
 * 
 * 🔒 보안 강화: TTL 기반 자동 정리로 메모리 누수 방지
 */

import { DocumentResult } from './index';

// 문서 TTL 설정 (기본: 1시간)
const DOCUMENT_TTL_MS = parseInt(process.env.DOCUMENT_TTL_HOURS || '1') * 60 * 60 * 1000;
const MAX_DOCUMENTS = parseInt(process.env.MAX_UPLOADED_DOCUMENTS || '100');

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
    forEach(callbackfn: (value: DocumentResult, key: string, map: DocumentStore) => void, thisArg?: any): void;
    entries(): IterableIterator<[string, DocumentResult]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<DocumentResult>;
    [Symbol.iterator](): IterableIterator<[string, DocumentResult]>;
}

/**
 * 🔒 TTL 기반 Document Map
 * Map과 호환되는 인터페이스를 제공하며 TTL 기반 자동 정리 기능 포함
 * 
 * Note: Map을 직접 상속하지 않고 래퍼 패턴 사용 (Node.js 25+ TypeScript 호환성)
 */
class TTLDocumentMap implements DocumentStore {
    private store: Map<string, StoredDocument> = new Map();

    constructor() {
        // 정리 스케줄러 (10분마다 실행)
        setInterval(() => this.cleanupExpired(), 10 * 60 * 1000);
    }

    /**
     * 🔒 만료된 문서 정리
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
        
        if (cleanedCount > 0) {
            console.log(`[DocumentStore] 🧹 만료된 문서 ${cleanedCount}개 정리됨 (현재 ${this.store.size}개)`);
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
        }
        
        console.log(`[DocumentStore] 🧹 용량 초과로 ${toRemove.length}개 문서 제거됨`);
    }

    // Map 호환 인터페이스 구현
    get(key: string): DocumentResult | undefined {
        const stored = this.store.get(key);
        if (!stored) return undefined;
        
        // 접근 시간 갱신 (LRU)
        stored.lastAccessedAt = Date.now();
        return stored.document;
    }

    set(key: string, value: DocumentResult): this {
        const now = Date.now();
        this.store.set(key, {
            document: value,
            createdAt: now,
            lastAccessedAt: now
        });
        
        this.enforceMaxDocuments();
        console.log(`[DocumentStore] 📄 문서 저장: ${key} (총 ${this.store.size}개)`);
        return this;
    }

    delete(key: string): boolean {
        return this.store.delete(key);
    }

    has(key: string): boolean {
        return this.store.has(key);
    }

    clear(): void {
        this.store.clear();
    }

    get size(): number {
        return this.store.size;
    }

    forEach(callbackfn: (value: DocumentResult, key: string, map: DocumentStore) => void, thisArg?: any): void {
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
