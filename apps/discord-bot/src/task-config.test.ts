/**
 * /task 설정 해석 — 잘못된 값이 조용히 위험한 쪽으로 켜지지 않게 고정한다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config, parseTaskApprovalPolicy, parseTaskExecutor } from './config';

test('실행 위치는 local 만 그대로 받고 그 밖은 sandbox', () => {
    assert.equal(parseTaskExecutor('local'), 'local');
    assert.equal(parseTaskExecutor(undefined), 'sandbox');
    assert.equal(parseTaskExecutor(''), 'sandbox');
    assert.equal(parseTaskExecutor('LOCAL'), 'sandbox');
    assert.equal(parseTaskExecutor('host'), 'sandbox');
});

test('승인 방식은 high-risk·none 만 그대로 받고 그 밖은 all(전부 승인)', () => {
    assert.equal(parseTaskApprovalPolicy('high-risk'), 'high-risk');
    assert.equal(parseTaskApprovalPolicy('none'), 'none');
    assert.equal(parseTaskApprovalPolicy(undefined), 'all');
    assert.equal(parseTaskApprovalPolicy(''), 'all');
    assert.equal(parseTaskApprovalPolicy('NONE'), 'all');
    assert.equal(parseTaskApprovalPolicy('skip'), 'all');
});

test('환경 변수가 없으면 기능이 꺼져 있고 안전한 기본값이다', () => {
    assert.deepEqual(config.taskAllowedUsers, []);
    assert.equal(config.taskExecutor, 'sandbox');
    assert.equal(config.taskApprovalPolicy, 'all');
    assert.equal(config.taskPollMs, 5_000);
    assert.equal(config.taskWatchMaxMs, 7_200_000);
});
