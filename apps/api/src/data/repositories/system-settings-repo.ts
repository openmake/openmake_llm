/**
 * @module data/repositories/system-settings-repo
 * @description 운영 설정(system_settings) 저장소 — admin UI 관리, env 폴백.
 *
 * 민감 키(is_secret)의 value 는 utils/token-crypto SSoT (AES-256-GCM,
 * TOKEN_ENCRYPTION_KEY) 로 암호화 저장한다 — server-external-keys-repo 와 동일 패턴.
 *
 * @see db/migrations/092_system_settings.sql
 * @see config/system-settings-registry.ts (허용 키 화이트리스트)
 */
import { BaseRepository } from './base-repository';
import { encryptToken, decryptToken, isDecryptionFailure } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SystemSettingsRepo');

export interface SystemSettingRow {
    key: string;
    /** 평문 값 — 복호화 실패 시 null (호출자가 미설정 취급) */
    value: string | null;
    isSecret: boolean;
    updatedAt: Date;
}

interface DbRow {
    key: string;
    value: string;
    is_secret: boolean;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): SystemSettingRow {
    let value: string | null = row.value;
    if (row.is_secret) {
        const plain = decryptToken(row.value);
        // decryptToken 은 fail-open — 실패 시 암호문을 그대로 반환하므로 명시 판별.
        // 실패한 키는 null(미설정 취급) 로 돌려 env 폴백이 살아나게 한다.
        if (isDecryptionFailure(plain)) {
            logger.error(`설정 복호화 실패 (${row.key}) — TOKEN_ENCRYPTION_KEY 확인 필요, env 폴백으로 동작`);
            value = null;
        } else {
            value = plain;
        }
    }
    return { key: row.key, value, isSecret: row.is_secret, updatedAt: row.updated_at };
}

export class SystemSettingsRepository extends BaseRepository {
    /** 전체 설정 조회 (시크릿은 복호화, 실패 시 value=null) */
    async findAll(): Promise<SystemSettingRow[]> {
        const result = await this.query<DbRow>(`SELECT * FROM system_settings ORDER BY key`);
        return result.rows.map(toRow);
    }

    /** 등록/갱신 — 시크릿은 즉시 암호화 저장 */
    async upsert(key: string, value: string, isSecret: boolean, updatedBy: string | null): Promise<void> {
        const stored = isSecret ? encryptToken(value) : value;
        await this.query(
            `INSERT INTO system_settings (key, value, is_secret, updated_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                is_secret = EXCLUDED.is_secret,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()`,
            [key, stored, isSecret, updatedBy],
        );
    }

    /** 삭제 — env/기본값 폴백으로 복귀 */
    async deleteKey(key: string): Promise<boolean> {
        const result = await this.query(`DELETE FROM system_settings WHERE key = $1`, [key]);
        return (result.rowCount ?? 0) > 0;
    }
}
