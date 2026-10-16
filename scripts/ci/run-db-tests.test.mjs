/**
 * DB 테스트 실행기 요약 — 실행(통과·실패)과 skip 을 나눠 세고, 전부 skip 이면 ran 0(CI 가 실패로 본다).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB_TEST_PATH_PATTERN, exitCodeFor, formatSummary, summarizeJestReport } from './run-db-tests.mjs';

const file = (...statuses) => ({ assertionResults: statuses.map((status) => ({ status })) });

test('통과·실패만 "실행" 으로 센다 — pending(skip)·todo 는 따로', () => {
    assert.deepEqual(
        summarizeJestReport({ testResults: [file('passed', 'passed', 'failed'), file('pending', 'todo')] }),
        { ran: 3, passed: 2, failed: 1, skipped: 2, files: 2 },
    );
});

test('전부 skip 이면 ran 0 — TEST_DATABASE_URL 이 jest 에 닿지 않은 경우', () => {
    assert.equal(summarizeJestReport({ testResults: [file('pending', 'pending'), file('pending')] }).ran, 0);
});

test('빈 보고서도 0 으로 센다', () => {
    assert.deepEqual(summarizeJestReport({}), { ran: 0, passed: 0, failed: 0, skipped: 0, files: 0 });
});

test('요약 줄 형식 — CI 로그에서 이 줄로 skip 과 실행을 구분한다', () => {
    assert.equal(
        formatSummary({ ran: 33, passed: 33, failed: 0, skipped: 0, files: 7 }),
        'db tests ran: 33 (passed 33, failed 0, skipped 0, files 7)',
    );
});

test('종료 코드 — 전부 skip(ran 0)이면 jest 가 성공해도 1, jest 실패는 그 코드, 아니면 0', () => {
    const ran = (n) => ({ ran: n, passed: n, failed: 0, skipped: 0, files: 1 });
    assert.equal(exitCodeFor(0, ran(0)), 1);
    assert.equal(exitCodeFor(0, ran(33)), 0);
    assert.equal(exitCodeFor(1, ran(33)), 1);
    assert.equal(exitCodeFor(null, ran(33)), 1);
});

test('대상 패턴은 *.db.test.ts 만 고른다', () => {
    const re = new RegExp(DB_TEST_PATH_PATTERN);
    assert.equal(re.test('apps/api/src/addons/x/__tests__/knowledge.db.test.ts'), true);
    assert.equal(re.test('apps/api/src/addons/x/__tests__/knowledge.test.ts'), false);
    assert.equal(re.test('apps/api/src/db.test.helpers.ts'), false);
});
