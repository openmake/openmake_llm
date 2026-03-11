#!/usr/bin/env ts-node

import { closeDatabase, getPool, getUnifiedDatabase } from '../models/unified-database';
import { MigrationRunner } from './runner';

function printUsage(): void {
    console.log('Usage:');
    console.log('  npx ts-node backend/api/src/data/migrations/cli.ts status');
    console.log('  npx ts-node backend/api/src/data/migrations/cli.ts migrate');
}

async function run(): Promise<void> {
    const command = process.argv[2];

    if (!command || (command !== 'status' && command !== 'migrate')) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    await getUnifiedDatabase().ensureReady();
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
