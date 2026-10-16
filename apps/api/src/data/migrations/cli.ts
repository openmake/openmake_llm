#!/usr/bin/env ts-node

// Load environment variables BEFORE any other imports (config 검증이 일찍 일어남)
import * as dotenv from 'dotenv';
import * as pathModule from 'path';
dotenv.config({ path: pathModule.resolve(__dirname, '../../../../../.env') });

import { closeDatabase, getPool, getUnifiedDatabase } from '../models/unified-database';
import { applyAddonMigrationsWithLock, MigrationRunner, summarizeAddonMigrations } from './runner';

const COMMANDS = ['status', 'migrate', 'migrate:addons'] as const;
type Command = typeof COMMANDS[number];

function isCommand(value: string | undefined): value is Command {
    return value !== undefined && (COMMANDS as readonly string[]).includes(value);
}

function printUsage(): void {
    console.log('Usage:');
    console.log('  npx ts-node apps/api/src/data/migrations/cli.ts status');
    console.log('  npx ts-node apps/api/src/data/migrations/cli.ts migrate');
    console.log('  npx ts-node apps/api/src/data/migrations/cli.ts migrate:addons');
}

/**
 * 내장 add-on 마이그레이션 — 부팅 ④ 와 같은 대상 선택(`selectMigrationTargets`: components.migrations + database:addon 권한)과
 * 같은 잠금(`applyAddonMigrationsWithLock`)을 쓴다. 대상은 env(`ADDON_BUILTIN_DISABLED`)로 켜진 add-on 이고 DB 의도는 보지 않는다
 * (테스트 DB·수동 복구용 — 부팅은 계속 의도까지 본다). 코어 `migrate` 뒤에 돌린다. 하나라도 실패하면 종료 코드 1.
 */
async function migrateAddons(): Promise<void> {
    const { enabledBuiltinAddons } = await import('../../addon-host/builtin-registry');
    const { selectMigrationTargets } = await import('../../addon-host');
    const { targets, denied } = selectMigrationTargets(enabledBuiltinAddons());
    const outcomes = await applyAddonMigrationsWithLock(getPool(), targets);
    const { lines, ok } = summarizeAddonMigrations(denied, outcomes);
    for (const line of lines) console.log(line);
    if (!ok) process.exitCode = 1;
}

async function run(): Promise<void> {
    const command = process.argv[2];

    if (!isCommand(command)) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    await getUnifiedDatabase().ensureReady();

    if (command === 'migrate:addons') {
        await migrateAddons();
        return;
    }

    const runner = new MigrationRunner(getPool());

    if (command === 'status') {
        const statuses = await runner.status();

        if (statuses.length === 0) {
            console.log('No migration files found.');
            return;
        }

        console.log('Migration status:');
        for (const item of statuses) {
            const marker = item.applied ? '[applied]' : '[pending]';
            const appliedAt = item.appliedAt ? ` at ${item.appliedAt}` : '';
            console.log(`${marker} ${item.version} ${item.filename}${appliedAt}`);
        }
        return;
    }

    const result = await runner.applyPending();
    console.log(`Applied migrations: ${result.applied.length}`);
    if (result.applied.length > 0) {
        for (const filename of result.applied) {
            console.log(`  + ${filename}`);
        }
    }

    console.log(`Skipped migrations: ${result.skipped.length}`);
    if (result.skipped.length > 0) {
        for (const filename of result.skipped) {
            console.log(`  - ${filename}`);
        }
    }
}

run()
    .catch((error: unknown) => {
        console.error('Migration CLI failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDatabase();
    });
