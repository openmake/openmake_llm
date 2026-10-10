import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MigrationRunner');

interface MigrationFile {
    version: string;
    filename: string;
    absolutePath: string;
    sql: string;
    checksum: string;
}

interface AppliedMigrationRow {
    version: string;
    filename: string;
    applied_at: Date | string;
    checksum: string | null;
}

interface MigrationStatus {
    version: string;
    filename: string;
    applied: boolean;
    appliedAt: string | null;
    checksum: string | null;
}

/** 풀과 전용 연결 어느 쪽으로도 문장을 보낼 수 있게 하는 최소 형태 */
type Queryable = Pick<Pool, 'query'>;

/**
 * 마이그레이션 전용 연결 — 풀에서 연결 하나를 받아 그 세션의 statement_timeout 을 풀고 `fn` 을 돌린다.
 *
 * 공용 풀은 statement_timeout(기본 30초)이 걸려 있어 긴 백필 마이그레이션이 부팅 중 타임아웃 →
 * Fail-Fast exit → 재시작 루프가 된다. advisory lock 대기도 같은 제한에 걸리므로 lock 보다 먼저 푼다.
 * 끝나면(성공·실패 모두) 세션 기본값으로 원복하고 반납한다. 원복에 실패하면 제한이 풀린 연결이
 * 풀로 돌아가지 않도록 폐기한다.
 */
async function withMigrationClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let restored = false;
    try {
        await client.query('SET statement_timeout = 0');
        return await fn(client);
    } finally {
        try {
            // 풀 설정의 statement_timeout 은 접속 시 세션 기본값으로 들어가므로 RESET 이 그 값으로 되돌린다
            await client.query('RESET statement_timeout');
            restored = true;
        } catch (error: unknown) {
            logger.warn('statement_timeout 원복 실패 — 연결을 폐기합니다:', error);
        }
        client.release(!restored);
    }
}

/**
 * 마이그레이션 실행기.
 *
 * 기본은 코어 스키마(`db/migrations`)이고, add-on 은 자기 패키지 안의 `migrations/` 를 **자기 네임스페이스**로
 * 적용한다(2026-09-19, §10-5). 네임스페이스가 있으면 `migration_versions.version` 이 `addon:<id>:NNN` 이 되어
 * 코어 순번과 절대 충돌하지 않고, add-on 이 설치되지 않은 DB 에는 그 테이블이 아예 없다.
 */
export class MigrationRunner {
    private readonly namespace?: string;
    private readonly dirOverride?: string;

    constructor(private pool: Pool, opts: { namespace?: string; dir?: string } = {}) {
        this.namespace = opts.namespace;
        this.dirOverride = opts.dir;
    }

    /** 이 실행기가 관리하는 version 접두 — 코어는 없음(기존 행 호환), add-on 은 `addon:<id>:` */
    private versionKey(fileVersion: string): string {
        return this.namespace ? `${this.namespace}:${fileVersion}` : fileVersion;
    }

    async ensureMigrationTable(db: Queryable = this.pool): Promise<void> {
        await db.query(`
            CREATE TABLE IF NOT EXISTS migration_versions (
                id SERIAL PRIMARY KEY,
                version VARCHAR(255) NOT NULL UNIQUE,
                filename VARCHAR(255) NOT NULL,
                applied_at TIMESTAMPTZ DEFAULT NOW(),
                checksum VARCHAR(64)
            );
        `);
    }

    async getAppliedMigrations(db: Queryable = this.pool): Promise<string[]> {
        await this.ensureMigrationTable(db);
        const result = await db.query<{ version: string }>(
            'SELECT version FROM migration_versions ORDER BY version ASC'
        );
        return result.rows.map((row) => row.version);
    }

    /**
     * pending 마이그레이션 적용. `client` 를 주면 그 연결(호출자가 lock·timeout 을 관리)에서,
     * 안 주면 전용 연결을 직접 받아 statement_timeout 없이 실행한다.
     */
    async applyPending(client?: PoolClient): Promise<{ applied: string[]; skipped: string[] }> {
        if (client) {
            return this.applyPendingOn(client);
        }
        return withMigrationClient(this.pool, (own) => this.applyPendingOn(own));
    }

    private async applyPendingOn(client: PoolClient): Promise<{ applied: string[]; skipped: string[] }> {
        await this.ensureMigrationTable(client);
        const migrationFiles = this.loadMigrationFiles();
        const appliedVersions = new Set(await this.getAppliedMigrations(client));
        const applied: string[] = [];
        const skipped: string[] = [];

        if (migrationFiles.length === 0) {
            logger.info('No migration files found. Nothing to apply.');
            return { applied, skipped };
        }

        for (const migration of migrationFiles) {
            if (appliedVersions.has(migration.version)) {
                skipped.push(migration.filename);
                logger.info(`Skipping already applied migration ${migration.filename}`);
                continue;
            }

            try {
                logger.info(`Applying migration ${migration.filename}`);
                await client.query('BEGIN');
                await client.query(migration.sql);
                // 일부 SQL 파일이 자체적으로 ON CONFLICT INSERT를 포함 (legacy 패턴)
                // → runner의 INSERT도 ON CONFLICT DO NOTHING으로 만들어 중복 INSERT를 흡수
                // (자체 INSERT가 없는 파일은 runner INSERT가 정상 적용됨)
                await client.query(
                    `INSERT INTO migration_versions (version, filename, checksum) VALUES ($1, $2, $3)
                     ON CONFLICT (version) DO NOTHING`,
                    [migration.version, migration.filename, migration.checksum]
                );
                await client.query('COMMIT');
                applied.push(migration.filename);
                logger.info(`Applied migration ${migration.filename}`);
            } catch (error: unknown) {
                await client.query('ROLLBACK');
                logger.error(`Failed migration ${migration.filename}:`, error);
                throw error;
            }
        }

        logger.info(`Migration run complete. Applied: ${applied.length}, Skipped: ${skipped.length}`);
        return { applied, skipped };
    }

    async status(): Promise<MigrationStatus[]> {
        await this.ensureMigrationTable();
        const migrationFiles = this.loadMigrationFiles();
        const appliedRows = await this.pool.query<AppliedMigrationRow>(
            'SELECT version, filename, applied_at, checksum FROM migration_versions ORDER BY version ASC'
        );

        const appliedByVersion = new Map<string, AppliedMigrationRow>();
        for (const row of appliedRows.rows) {
            appliedByVersion.set(row.version, row);
        }

        return migrationFiles.map((file) => {
            const applied = appliedByVersion.get(file.version);
            return {
                version: file.version,
                filename: file.filename,
                applied: Boolean(applied),
                appliedAt: applied ? this.normalizeAppliedAt(applied.applied_at) : null,
                checksum: applied?.checksum ?? null
            };
        });
    }

    private normalizeAppliedAt(value: Date | string): string {
        if (value instanceof Date) {
            return value.toISOString();
        }
        return value;
    }

    private loadMigrationFiles(): MigrationFile[] {
        const migrationsDir = this.resolveMigrationsDir();
        const files = fs
            .readdirSync(migrationsDir)
            .filter((name) => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name))
            .sort((a, b) => this.compareMigrationFilenames(a, b));

        return files.map((filename) => {
            const absolutePath = path.join(migrationsDir, filename);
            const sql = fs.readFileSync(absolutePath, 'utf8');
            const version = this.versionKey(filename.split('_')[0]);

            return {
                version,
                filename,
                absolutePath,
                sql,
                checksum: crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
            };
        });
    }

    private compareMigrationFilenames(a: string, b: string): number {
        const aVersion = parseInt(a.split('_')[0], 10);
        const bVersion = parseInt(b.split('_')[0], 10);

        if (aVersion !== bVersion) {
            return aVersion - bVersion;
        }

        return a.localeCompare(b);
    }

    private resolveMigrationsDir(): string {
        if (this.dirOverride) {
            if (!fs.existsSync(this.dirOverride) || !fs.statSync(this.dirOverride).isDirectory()) {
                throw new Error(`Migrations directory not found: ${this.dirOverride}`);
            }
            return this.dirOverride;
        }
        const candidates = [
            path.resolve(process.cwd(), 'db/migrations'),
            path.resolve(__dirname, '../../../../../db/migrations'),
            path.resolve(__dirname, '../../../../db/migrations')
        ];

        for (const candidatePath of candidates) {
            if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
                return candidatePath;
            }
        }

        throw new Error(
            `Unable to locate migrations directory. Checked: ${candidates.join(', ')}`
        );
    }
}

/**
 * add-on 마이그레이션 적용 — 켜진 add-on 이 자기 패키지의 `migrations/` 를 자기 네임스페이스로 적용한다.
 *
 * 코어 마이그레이션 **뒤에**, 팩 콘텐츠 설치 **앞에** 돈다(테이블이 있어야 시드가 들어간다).
 * 한 add-on 의 실패는 그 add-on 만 막고 나머지는 계속한다 — 부팅을 죽이지 않는다(fail-open).
 * 코어와 같은 advisory lock 을 쓰므로 다중 인스턴스에서도 직렬화된다.
 */
export async function applyAddonMigrationsWithLock(
    pool: Pool,
    addons: ReadonlyArray<{ id: string; dir: string }>,
): Promise<Array<{ id: string; applied: string[]; error?: string }>> {
    if (addons.length === 0) return [];
    const out: Array<{ id: string; applied: string[]; error?: string }> = [];
    await withMigrationClient(pool, async (client) => {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        try {
            for (const addon of addons) {
                try {
                    const runner = new MigrationRunner(pool, { namespace: `addon:${addon.id}`, dir: addon.dir });
                    const { applied } = await runner.applyPending(client);
                    out.push({ id: addon.id, applied });
                } catch (err) {
                    out.push({ id: addon.id, applied: [], error: err instanceof Error ? err.message : String(err) });
                }
            }
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        }
    });
    return out;
}

/** 마이그레이션 직렬화용 전역 advisory lock 키 (앱 전역 유일 고정값 — "omlm" 의 hex). */
const MIGRATION_ADVISORY_LOCK_KEY = 0x6f6d6c6d;

/**
 * 부팅 시 pending 마이그레이션을 자동 적용한다 (advisory lock 으로 다중 인스턴스 직렬화).
 *
 * 부팅 init(002-schema.sql)은 baseline 테이블만 생성하므로, migrations/ 의 증분 스키마를
 * 여기서 적용해야 artifacts/user_agents/mcp_server_catalog/skill_* 등이 완성된다.
 * 여러 인스턴스가 동시에 부팅해도 pg_advisory_lock 으로 한 번에 하나만 실행하고,
 * 나머지는 락 획득 시점에 이미 적용 완료 상태 → 전부 skip 된다. (마이그레이션은
 * 전부 멱등 IF NOT EXISTS 이므로 락 없이 재실행돼도 안전하지만, 락으로 경합 로그를 줄인다.)
 */
export async function applyPendingWithLock(
    pool: Pool
): Promise<{ applied: string[]; skipped: string[] }> {
    return withMigrationClient(pool, async (client) => {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        try {
            return await new MigrationRunner(pool).applyPending(client);
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        }
    });
}
