/**
 * .env 파일 파서 — env.ts 에서 분리 (600줄 CI 가드).
 * KEY=VALUE 라인만 해석하고 빈 줄/주석(#)은 건너뛴다.
 *
 * @module config/env-file
 */
import * as fs from 'fs';

export function parseEnvFile(filePath: string): Record<string, string> {
    const env: Record<string, string> = {};

    if (!fs.existsSync(filePath)) {
        return env;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // 빈 줄이나 주석 건너뛰기
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
            const key = trimmed.substring(0, equalIndex).trim();
            const value = trimmed.substring(equalIndex + 1).trim();
            env[key] = value;
        }
    }

    return env;
}
