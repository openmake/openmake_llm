/**
 * @module services/system-settings-service
 * @description 운영 설정(system_settings) 해석·전파 서비스.
 *
 * DB 설정을 읽어 config 로더의 overlay(applySettingsOverlay)로 주입한다.
 * 우선순위: DB > env(.env/process.env) > 기본값. 소비자 대다수가 per-call
 * getConfig() 라 overlay 교체(=resetConfig)만으로 반영되고, AlertSystem 만
 * 싱글톤 생성자에서 1회 읽으므로 reloadWebhookChannels() 훅을 함께 호출한다.
 *
 * 부팅 배선: server.ts 가 마이그레이션 자동 적용 직후 loadAndApply() 를 호출
 * (fail-open — DB 조회 실패 시 env 만으로 부팅 지속).
 *
 * @see config/system-settings-registry.ts (허용 키 화이트리스트)
 * @see docs/superpowers/plans/2026-08-12-system-settings-admin-ui.md
 */
import { applySettingsOverlay, readRawEnvValue } from '../config/env';
import {
    SETTING_DEFS_BY_KEY,
    SYSTEM_SETTINGS_REGISTRY,
    type SettingGroup,
} from '../config/system-settings-registry';
import { SystemSettingsRepository } from '../data/repositories/system-settings-repo';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('SystemSettingsService');

/** 설정 1건의 조회 뷰 — 시크릿은 값 미포함 (write-only) */
export interface SettingView {
    key: string;
    group: SettingGroup;
    secret: boolean;
    requiresRestart: boolean;
    /** 유효값의 출처 — db(설정됨) / env(.env·process.env 상속) / default */
    source: 'db' | 'env' | 'default';
    /** 값 존재 여부 (시크릿 포함) */
    isSet: boolean;
    /** 비시크릿 키의 표시값 (db 또는 env 값). 시크릿은 항상 미포함 */
    value?: string;
}

export class SystemSettingsService {
    private repo: SystemSettingsRepository;
    /** 마지막 적용 overlay 스냅샷 — describe() 출처 판별용 (시크릿 값 포함, 외부 미노출) */
    private snapshot: Record<string, string> = {};

    constructor(repo?: SystemSettingsRepository) {
        this.repo = repo ?? new SystemSettingsRepository(getPool());
    }

    /**
     * DB 설정을 읽어 config overlay 로 적용하고 소비자 훅을 갱신합니다.
     * fail-open: DB 조회 실패 시 기존 overlay 유지(부팅 시엔 빈 overlay = env 동작).
     */
    async loadAndApply(): Promise<void> {
        const rows = await this.repo.findAll();
        const overlay: Record<string, string> = {};
        for (const row of rows) {
            if (!SETTING_DEFS_BY_KEY.has(row.key)) {
                logger.warn(`레지스트리에 없는 설정 키 무시: ${row.key}`);
                continue;
            }
            if (row.value === null) continue; // 복호화 실패 — repo 가 이미 로깅, env 폴백
            overlay[row.key] = row.value;
        }
        this.snapshot = overlay;
        applySettingsOverlay(overlay);
        await this.refreshConsumers();
        logger.info(`시스템 설정 적용됨 — DB 설정 ${Object.keys(overlay).length}건`);
    }

    /**
     * 설정 일괄 저장 (키·형식 검증은 라우트 zod + registry 에서 선행) 후 재적용.
     * @returns 재시작 후 반영되는 키 목록
     */
    async update(entries: Record<string, string>, updatedBy: string | null): Promise<{ requiresRestart: string[] }> {
        const requiresRestart: string[] = [];
        for (const [key, value] of Object.entries(entries)) {
            const def = SETTING_DEFS_BY_KEY.get(key);
            if (!def) throw new Error(`허용되지 않은 설정 키: ${key}`);
            await this.repo.upsert(key, value, def.secret, updatedBy);
            if (def.requiresRestart) requiresRestart.push(key);
        }
        await this.loadAndApply();
        return { requiresRestart };
    }

    /** 설정 삭제 — env/기본값 폴백으로 복귀 */
    async reset(key: string): Promise<boolean> {
        if (!SETTING_DEFS_BY_KEY.has(key)) throw new Error(`허용되지 않은 설정 키: ${key}`);
        const deleted = await this.repo.deleteKey(key);
        if (deleted) await this.loadAndApply();
        return deleted;
    }

    /** 전체 설정 조회 뷰 — 시크릿 값은 절대 포함하지 않는다 */
    describe(): SettingView[] {
        return SYSTEM_SETTINGS_REGISTRY.map((def) => {
            const dbValue = this.snapshot[def.key];
            const envValue = readRawEnvValue(def.key);
            const source: SettingView['source'] =
                dbValue !== undefined ? 'db' : envValue !== undefined ? 'env' : 'default';
            const effective = dbValue ?? envValue;
            return {
                key: def.key,
                group: def.group,
                secret: def.secret,
                requiresRestart: def.requiresRestart,
                source,
                isSet: effective !== undefined && effective !== '',
                ...(def.secret ? {} : effective !== undefined ? { value: effective } : {}),
            };
        });
    }

    /**
     * 싱글톤이 생성자에서 config 를 1회 읽는 소비자 갱신.
     * 현재는 AlertSystem(webhook 채널) 1곳 — 새 훅 추가 시 여기에 배선.
     * fail-open: 훅 실패가 설정 적용 자체를 죽이지 않는다.
     */
    private async refreshConsumers(): Promise<void> {
        try {
            const { getAlertSystem } = await import('../monitoring/alerts');
            getAlertSystem().reloadWebhookChannels();
        } catch (err) {
            logger.warn(`설정 소비자 갱신 실패 (무시): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

let instance: SystemSettingsService | null = null;

export function getSystemSettingsService(): SystemSettingsService {
    if (!instance) instance = new SystemSettingsService();
    return instance;
}
