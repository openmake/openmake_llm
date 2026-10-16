// e2e 픽스처의 DB 접속은 TEST_DATABASE_URL(이름이 _test 로 끝나는 격리 DB)만 쓴다 — 개발 DB(DATABASE_URL)로 대체하지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pgConfig } from '../../tests/e2e/helpers/gdpr-fixtures.ts';

function withEnv(env, fn) {
    const saved = { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

test('pgConfig: TEST_DATABASE_URL 이 없으면 DATABASE_URL 이 있어도 던지고, .env.e2e 에 넣으라고 안내한다', () => {
    withEnv({ TEST_DATABASE_URL: undefined, DATABASE_URL: 'postgresql://u:p@localhost:5432/openmake_llm' }, () => {
        assert.throws(() => pgConfig(), (e) => e.message.includes('TEST_DATABASE_URL') && e.message.includes('tests/e2e/.env.e2e'));
    });
});

test('pgConfig: DB 이름이 _test 로 끝나지 않으면 던진다', () => {
    withEnv({ TEST_DATABASE_URL: 'postgresql://u:p@localhost:5432/openmake_llm', DATABASE_URL: undefined }, () => {
        assert.throws(() => pgConfig(), /_test/);
    });
});

test('pgConfig: _test 로 끝나는 TEST_DATABASE_URL 은 그대로 쓴다', () => {
    const url = 'postgresql://u:p@localhost:5432/openmake_llm_test';
    withEnv({ TEST_DATABASE_URL: url, DATABASE_URL: 'postgresql://u:p@localhost:5432/dev' }, () => {
        assert.deepEqual(pgConfig(), { connectionString: url });
    });
});
