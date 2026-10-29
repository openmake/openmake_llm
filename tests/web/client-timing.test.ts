/**
 * 클라이언트 타이밍 하한(2026-10-29 리뷰 M-1) — 비교 레인 종료 대기(WS_TERMINAL_WAIT_MS)는 생존 확인 시간
 * (WS_LIVENESS_TIMEOUT_MS)보다 길어야 한다. 짧으면 half-open 소켓에서 Stop 뒤 생존 확인이 소켓을 버리기 전에
 * 대기가 먼저 만료돼, 죽은 소켓에 중단을 보내고 생성을 잊는다(서버 생성은 유예까지 계속된다).
 * 설정은 모듈을 읽을 때 정해지므로 환경변수를 바꾼 뒤 동적으로 불러온다(파일마다 프로세스가 따로 돈다).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('종료 대기 시간이 생존 확인 시간보다 짧게 설정되면 생존 확인 시간 + 1초를 쓴다', async () => {
  process.env.NEXT_PUBLIC_WS_LIVENESS_TIMEOUT_MS = '10000';
  process.env.NEXT_PUBLIC_WS_TERMINAL_WAIT_MS = '5000';
  const { CLIENT_TIMING } = await import('../../apps/web/lib/config');
  assert.equal(CLIENT_TIMING.WS_LIVENESS_TIMEOUT_MS, 10_000);
  assert.equal(CLIENT_TIMING.WS_TERMINAL_WAIT_MS, 11_000);
});
