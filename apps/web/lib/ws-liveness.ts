/**
 * 채팅 WebSocket 생존 확인 (2026-10-29) — 서버 sockets/ws-app-ping 과 페어.
 *
 * 네트워크가 바뀌면 소켓이 half-open 이 된다. 브라우저 코드는 프로토콜 ping 을 볼 수 없고 FIN 도 오지 않아
 * `onclose` 가 1~2분 늦게 오며, 그 사이 보낸 중단·승인 응답은 죽은 소켓으로 사라진다.
 * 그래서 마지막 수신 뒤 intervalMs 가 지나면 앱 수준 ping 을 보내고, timeoutMs 안에 아무것도 받지 못하면
 * onDead 를 한 번 부른다(호출자가 그 소켓을 버리고 재연결한다). 어떤 수신이든 살아 있다는 뜻이다.
 *
 * 소켓 하나에 하나씩 만든다 — onDead 뒤(또는 stop 뒤)에는 아무것도 하지 않는다.
 * 순수 모듈: 타이머·시계를 주입할 수 있다(테스트).
 *
 * @module lib/ws-liveness
 */

export interface WsLivenessTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface WsLivenessOptions {
  /** 마지막 수신 뒤 이만큼 조용하면 ping */
  intervalMs: number;
  /** ping 뒤 이만큼 아무 수신도 없으면 죽은 소켓 */
  timeoutMs: number;
  sendPing: () => void;
  onDead: () => void;
  timers?: WsLivenessTimers;
}

export interface WsLiveness {
  /** 소켓 OPEN 직후 */
  start(): void;
  /** 소켓을 정리할 때 — 이후 무동작 */
  stop(): void;
  /** 어떤 메시지든 받았을 때 — 살아 있음 */
  noteInbound(): void;
  /** 즉시 ping(네트워크 복귀·탭 복귀) — timeoutMs 안 응답이 없으면 onDead */
  probe(): void;
}

const DEFAULT_TIMERS: WsLivenessTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createWsLiveness(opts: WsLivenessOptions): WsLiveness {
  const timers = opts.timers ?? DEFAULT_TIMERS;
  let running = false;
  let lastInbound = 0;
  let idleTimer: unknown = null;
  let deadline: unknown = null;

  const clearAll = () => {
    if (idleTimer !== null) timers.clearTimeout(idleTimer);
    if (deadline !== null) timers.clearTimeout(deadline);
    idleTimer = null;
    deadline = null;
  };

  const ping = () => {
    if (!running || deadline !== null) return; // 이미 응답을 기다리는 중
    try {
      opts.sendPing();
    } catch {
      /* 닫히는 소켓 — 응답 없음으로 판정된다 */
    }
    deadline = timers.setTimeout(() => {
      deadline = null;
      if (!running) return;
      running = false;
      clearAll();
      opts.onDead();
    }, opts.timeoutMs);
  };

  // 수신마다 타이머를 다시 걸지 않고, 깨어났을 때 남은 시간만큼 다시 잔다(토큰 스트림 중 타이머 갱신 비용 없음).
  const scheduleIdle = (delay: number) => {
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      if (!running) return;
      const quiet = timers.now() - lastInbound;
      if (quiet >= opts.intervalMs) {
        ping();
        scheduleIdle(opts.intervalMs);
      } else {
        scheduleIdle(opts.intervalMs - quiet);
      }
    }, delay);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastInbound = timers.now();
      scheduleIdle(opts.intervalMs);
    },
    stop() {
      running = false;
      clearAll();
    },
    noteInbound() {
      lastInbound = timers.now();
      if (deadline !== null) {
        timers.clearTimeout(deadline);
        deadline = null;
      }
    },
    probe() {
      ping();
    },
  };
}
