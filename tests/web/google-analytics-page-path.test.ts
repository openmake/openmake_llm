import assert from 'node:assert/strict';
import test from 'node:test';
import { gaPagePath } from '../../apps/web/components/google-analytics';

test('공유 경로 page_view 에는 query(token) 를 싣지 않는다', () => {
  assert.equal(gaPagePath('/shared/conversation/abc', 'token=secret'), '/shared/conversation/abc');
  assert.equal(gaPagePath('/shared/task/abc', 'token=secret&x=1'), '/shared/task/abc');
});

test('공유 밖 경로는 query 를 그대로 싣는다', () => {
  assert.equal(gaPagePath('/chat', 'id=1'), '/chat?id=1');
  assert.equal(gaPagePath('/chat', ''), '/chat');
});
