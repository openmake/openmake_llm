/**
 * ============================================================
 * KeyPool - API 키 로딩 및 풀 관리
 * ============================================================
 *
 * 환경변수에서 API 키를 동적 로드하고, 키 배열 및 모델 매핑을 관리합니다.
 * 라운드로빈 기반 키 선택과 인덱스별 키 접근을 제공합니다.
 *
 * @module ollama/key-pool
 */

import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('KeyPool');

/**
 * API 키 풀 관리자
 *
 * API 키의 로딩, 저장, 인덱스 기반 접근을 담당합니다.
 * 쿨다운/실패 로직은 포함하지 않습니다.
 */
export class KeyPool {
    /** 등록된 API 키 배열 */
    private keys: string[] = [];
    /** 각 키에 대응하는 모델 이름 배열 (인덱스 매핑) */
    private models: string[] = [];
    /** SSH 키 (Ollama SSH 터널링용, 선택적) */
    private sshKey: string | undefined;
    /** 라운드로빈 포인터 */
    private roundRobinIndex = 0;

    constructor(config?: { keys?: string[]; models?: string[]; sshKey?: string }) {
        const envConfig = getConfig();

        try {
            if (config?.keys && config.keys.length > 0) {
                this.keys = this.sanitizeKeys(config.keys, 'config');
            } else {
                this.keys = this.loadKeysFromEnv();
            }
        } catch (error) {
            logger.warn(`API 키 초기화 실패, 빈 키 목록으로 진행: ${(error instanceof Error ? error.message : String(error))}`);
            this.keys = [];
        }

        if (this.keys.length === 0) {
            logger.warn('유효한 API 키가 구성되지 않았습니다. 인증 없이 요청을 시도합니다.');
        }

        if (config?.models && config.models.length > 0) {
            this.models = config.models;
        } else {
            this.models = envConfig.ollamaModels || [];
        }

        this.sshKey = config?.sshKey || envConfig.ollamaSshKey || undefined;

        logger.info(`초기화됨 - ${this.keys.length}개 API 키, ${this.models.length}개 모델 등록`);
        this.keys.forEach((key, idx) => {
            const model = this.models[idx] || envConfig.ollamaDefaultModel || 'default';
            logger.info(`  Key ${idx + 1}: ****${key.substring(key.length - 4)} → Model: ${model}`);
        });
    }

    /**
     * 원시 키 배열에서 빈 문자열, 비문자열 등 유효하지 않은 키를 필터링합니다.
     */
    private sanitizeKeys(rawKeys: string[], source: string): string[] {
        const sanitized: string[] = [];
        rawKeys.forEach((rawKey, idx) => {
            if (typeof rawKey !== 'string') {
                logger.warn(`${source} key ${idx + 1} 무시됨: 문자열이 아닙니다.`);
                return;
            }

            const trimmed = rawKey.trim();
            if (!trimmed) {
                logger.warn(`${source} key ${idx + 1} 무시됨: 비어있거나 공백입니다.`);
                return;
            }

            sanitized.push(trimmed);
        });
        return sanitized;
    }

    /**
     * 환경변수에서 동적으로 API 키 로드
     * OLLAMA_API_KEY_1, OLLAMA_API_KEY_2, ... OLLAMA_API_KEY_N 순서로 탐색
     * 레거시 지원: OLLAMA_API_KEY_PRIMARY, OLLAMA_API_KEY_SECONDARY
     */
    private loadKeysFromEnv(): string[] {
        const keys: string[] = [];

        const numberedKeys = Object.entries(process.env)
            .map(([name, value]) => {
                const match = /^OLLAMA_API_KEY_(\d+)$/.exec(name);
                if (!match) return null;
                return { index: Number.parseInt(match[1], 10), value };
            })
            .filter((entry): entry is { index: number; value: string | undefined } => entry !== null)
            .sort((a, b) => a.index - b.index);

        for (const entry of numberedKeys) {
            if (typeof entry.value !== 'string' || entry.value.trim() === '') {
                logger.warn(`env OLLAMA_API_KEY_${entry.index} 무시됨: 비어있거나 공백입니다.`);
                continue;
            }
            keys.push(entry.value.trim());
        }

        // 레거시 형식 지원 (새 형식에 키가 없을 때만)
        if (keys.length === 0) {
            const cfg = getConfig();
            const primary = cfg.ollamaApiKeyPrimary || cfg.ollamaApiKey;
            const secondary = cfg.ollamaApiKeySecondary;

            if (typeof primary === 'string') {
                if (primary.trim() !== '') {
                    keys.push(primary.trim());
                } else {
                    logger.warn('env legacy primary key 무시됨: 비어있거나 공백입니다.');
                }
            }
            if (typeof secondary === 'string') {
                if (secondary.trim() !== '') {
                    keys.push(secondary.trim());
                } else {
                    logger.warn('env legacy secondary key 무시됨: 비어있거나 공백입니다.');
                }
            }
        }

        return keys;
    }

    /** 전체 키 개수 */
    getTotalKeys(): number {
        return this.keys.length;
    }

    /** API 키가 설정되어 있는지 확인 */
    hasValidKey(): boolean {
        return this.keys.length > 0;
    }

    /** 특정 인덱스의 API 키 반환 */
    getKeyByIndex(index: number): string {
        if (index < 0 || index >= this.keys.length) return '';
        return this.keys[index];
    }

    /** 특정 인덱스의 모델 반환 */
    getModelByIndex(index: number): string {
        if (index < 0 || index >= this.models.length) {
            return getConfig().ollamaDefaultModel;
        }
        return this.models[index];
    }

    /** SSH 키 반환 */
    getSshKey(): string | undefined {
        return this.sshKey;
    }

    /** 특정 인덱스의 Authorization 헤더 생성 */
    getAuthHeadersForIndex(index: number): Record<string, string> {
        if (index < 0 || index >= this.keys.length) return {};
        return {
            'Authorization': `Bearer ${this.keys[index]}`
        };
    }

    /** 키 마스킹 (로그용) */
    getMaskedKey(index: number): string {
        const key = this.getKeyByIndex(index);
        if (!key) return '(empty)';
        return key.substring(0, 8) + '...';
    }

    /**
     * 라운드로빈으로 다음 키 인덱스를 반환합니다.
     * isAvailable 콜백으로 쿨다운 등 외부 조건을 체크합니다.
     *
     * @param isAvailable - 키 인덱스가 사용 가능한지 판단하는 콜백
     * @param excludeIndex - 제외할 키 인덱스 (선택적)
     * @returns 사용 가능한 키 인덱스, 없으면 -1
     */
    getNextAvailableKey(isAvailable: (index: number) => boolean, excludeIndex?: number): number {
        if (this.keys.length === 0) return -1;

        for (let attempt = 0; attempt < this.keys.length; attempt++) {
            const idx = (this.roundRobinIndex + attempt) % this.keys.length;

            if (idx === excludeIndex) continue;

            if (isAvailable(idx)) {
                this.roundRobinIndex = (idx + 1) % this.keys.length;
                return idx;
            }
        }

        return -1;
    }

    /**
     * 모든 키의 상태 정보 반환
     */
    getKeyInfos(): { index: number; model: string }[] {
        const defaultModel = getConfig().ollamaDefaultModel;
        return this.keys.map((_, idx) => ({
            index: idx,
            model: this.models[idx] || defaultModel
        }));
    }
}
