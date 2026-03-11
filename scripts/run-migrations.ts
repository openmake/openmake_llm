/**
 * ============================================================
 * DB Migration Auto-Runner
 * ============================================================
 *
 * services/database/migrations/ 디렉토리의 SQL 마이그레이션을
 * 자동으로 감지하고 미적용 항목을 순서대로 실행합니다.
 *
 * 실행 방법:
 *   npx ts-node scripts/run-migrations.ts
 *   npm run migrate
 *
 * 동작 방식:
 *   1. migration_versions 테이블 존재 확인 (없으면 생성)
 *   2. 적용된 버전 목록 조회
 *   3. 미적용 .sql 파일을 파일명 순으로 정렬
 *   4. 트랜잭션 내에서 순차 실행
 *   5. 실행 결과 기록
 *
 * @module scripts/run-migrations
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// ─── 설정 ───
const MIGRATIONS_DIR = path.resolve(__dirname, '../services/database/migrations');
const DATABASE_URL = process.env.DATABASE_URL;

// PostgreSQL 연결 설정
function createPool(): Pool {
    if (DATABASE_URL) {
        return new Pool({ connectionString: DATABASE_URL });
    }

    return new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        database: process.env.PGDATABASE || 'openmake_llm',
        user: process.env.PGUSER || process.env.USER || 'postgres',
        password: process.env.PGPASSWORD || undefined,
    });
}

// ─── 마이그레이션 버전 테이블 보장 ───
async function ensureMigrationTable(pool: Pool): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS migration_versions (
            id SERIAL PRIMARY KEY,
            version VARCHAR(255) NOT NULL UNIQUE,
            filename VARCHAR(255) NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            checksum VARCHAR(64)
        )
    `);
}

// ─── 적용된 버전 조회 ───
async function getAppliedVersions(pool: Pool): Promise<Set<string>> {
    const result = await pool.query<{ version: string }>(
        'SELECT version FROM migration_versions ORDER BY version ASC'
    );
    return new Set(result.rows.map((row) => row.version));
}

// ─── 마이그레이션 파일 목록 ───
interface MigrationFile {
    version: string;
    filename: string;
    filepath: string;
}

function getMigrationFiles(): MigrationFile[] {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        console.error(`❌ 마이그레이션 디렉토리를 찾을 수 없습니다: ${MIGRATIONS_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort(); // 파일명 기준 사전순 정렬 (000, 001, 002, ...)

    return files.map((filename) => {
        // 버전 추출: 파일명 앞의 숫자 부분 (예: 002_vector_type_migration.sql → "002")
        const match = filename.match(/^(\d+)/);
        const version = match ? match[1] : filename.replace('.sql', '');

        return {
            version,
            filename,
            filepath: path.join(MIGRATIONS_DIR, filename),
        };
    });
}

// ─── 마이그레이션 실행 ───
async function runMigrations(): Promise<void> {
    const pool = createPool();

    try {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('▶ DB Migration Runner');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  디렉토리: ${MIGRATIONS_DIR}`);

        // 1. 테이블 보장
        await ensureMigrationTable(pool);

        // 2. 적용된 버전 조회
        const applied = await getAppliedVersions(pool);
        console.log(`  적용 완료: ${applied.size}개 버전 (${[...applied].join(', ') || 'none'})`);

        // 3. 미적용 파일 필터링
        const allFiles = getMigrationFiles();
        const pending = allFiles.filter((f) => !applied.has(f.version));

        if (pending.length === 0) {
            console.log('\n  ✅ 모든 마이그레이션이 이미 적용되어 있습니다.');
            return;
        }

        console.log(`  미적용: ${pending.length}개 파일\n`);

        // 4. 순차 실행
        let successCount = 0;
        for (const migration of pending) {
            const sql = fs.readFileSync(migration.filepath, 'utf-8');
            console.log(`  ▶ ${migration.filename} (v${migration.version})...`);

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // SQL 실행
                await client.query(sql);

                // 버전 기록 (중복 방지: 마이그레이션 SQL 자체에서 INSERT하는 경우 대비)
                await client.query(
                    `INSERT INTO migration_versions (version, filename)
                     VALUES ($1, $2)
                     ON CONFLICT (version) DO NOTHING`,
                    [migration.version, migration.filename]
                );

                await client.query('COMMIT');
                console.log(`    ✅ 적용 완료`);
                successCount++;
            } catch (error: unknown) {
                await client.query('ROLLBACK');
                const message = error instanceof Error ? error.message : String(error);
                console.error(`    ❌ 실패: ${message}`);
                console.error(`    롤백 완료. 이후 마이그레이션 중단.`);
                process.exit(1);
            } finally {
                client.release();
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  ✅ ${successCount}/${pending.length} 마이그레이션 적용 완료`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } finally {
        await pool.end();
    }
}

// ─── 실행 ───
runMigrations().catch((error: unknown) => {
    console.error('마이그레이션 러너 오류:', error);
    process.exit(1);
});
