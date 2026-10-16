/**
 * DB 통합 테스트(*.db.test.ts) 실행기 — CI Gate 1.5 와 로컬 `npm run test:db` (설계 D3).
 *
 * jest 를 --runInBand(같은 DB 를 쓰는 파일끼리 경합하지 않게)·--json 으로 돌리고, 실제로 실행된 테스트 수를
 * "db tests ran: N" 으로 남긴다 — skip(describe.skip: TEST_DATABASE_URL 이 테스트에 닿지 않은 경우)과 구분하기 위해서다.
 * 실패: TEST_DATABASE_URL 없음 · jest 실패 · 보고서 없음 · 실행 0건.
 *
 * 사용: TEST_DATABASE_URL=postgresql://…/openmake_llm_test npm run test:db   (DB 준비: scripts/setup-test-db.sh)
 * @module scripts/ci/run-db-tests
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** jest --testPathPatterns 값 — 파일 이름 규약 `*.db.test.ts` */
export const DB_TEST_PATH_PATTERN = '\\.db\\.test\\.ts$';

/** PURE: jest --json 보고서 → 실행(통과+실패)·통과·실패·건너뜀(passed·failed 밖의 모든 상태 — pending·todo·skipped·disabled)·파일 수 */
export function summarizeJestReport(report) {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const files = report.testResults ?? [];
    for (const file of files) {
        for (const assertion of file.assertionResults ?? []) {
            if (assertion.status === 'passed') passed += 1;
            else if (assertion.status === 'failed') failed += 1;
            else skipped += 1;
        }
    }
    return { ran: passed + failed, passed, failed, skipped, files: files.length };
}

/** PURE: 요약 한 줄 */
export function formatSummary(s) {
    return `db tests ran: ${s.ran} (passed ${s.passed}, failed ${s.failed}, skipped ${s.skipped}, files ${s.files})`;
}

/** PURE: 종료 코드 — jest 가 실패했으면 그 코드(신호로 끝나 null 이면 1), 실행 0건(전부 skip)이면 1, 아니면 0 */
export function exitCodeFor(jestStatus, summary) {
    if (jestStatus !== 0) return jestStatus ?? 1;
    return summary.ran === 0 ? 1 : 0;
}

function main() {
    if (!process.env.TEST_DATABASE_URL) {
        console.error('TEST_DATABASE_URL 이 없습니다 — DB 테스트는 전용 테스트 DB 에서만 돈다(scripts/setup-test-db.sh 참고)');
        return 1;
    }
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dir = mkdtempSync(join(tmpdir(), 'omk-db-tests-'));
    const reportPath = join(dir, 'jest-report.json');
    try {
        const jest = spawnSync(process.execPath, [
            join(root, 'node_modules', 'jest', 'bin', 'jest.js'),
            '-c', 'apps/api/jest.config.js',
            '--runInBand',
            '--testPathPatterns', DB_TEST_PATH_PATTERN,
            '--json', `--outputFile=${reportPath}`,
        ], { cwd: root, stdio: 'inherit', env: process.env });
        let summary;
        try {
            summary = summarizeJestReport(JSON.parse(readFileSync(reportPath, 'utf8')));
        } catch (err) {
            console.error(`jest 보고서를 읽지 못했습니다(${reportPath}): ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
        console.log(formatSummary(summary));
        if (jest.status === 0 && summary.ran === 0) {
            console.error('DB 테스트가 하나도 실행되지 않았습니다(전부 skip) — TEST_DATABASE_URL 이 jest 에 닿는지 확인하세요');
        }
        return exitCodeFor(jest.status, summary);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main();
}
