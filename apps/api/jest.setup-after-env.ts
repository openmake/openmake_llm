/**
 * Jest setupFilesAfterEnv — 테스트 프레임워크 설치 후 각 테스트 파일 앞에 실행.
 *
 * **단위 테스트에서 실제 DB 연결을 차단한다.**
 *
 * 배경: jest.setup.ts 가 `DATABASE_URL` 을 지워 "테스트는 운영 DB 를 건드리지 않는다"를
 * 의도했지만, `config/env.ts` 의 기본값(`postgresql://localhost:5432/openmake_llm`)이
 * 그 자리를 메워 **실제로는 로컬 DB 에 접속**하고 있었다. 그 연결이 테스트 종료 후까지
 * 살아남아, teardown 뒤 pg 가 `pgPass` 를 lazy require 하며 던지는 unhandled error 가
 * **무관한 다른 스위트에 귀속**돼 랜덤 실패를 만들었다 (2026-08-24 실측:
 * approval-gate·rate-limiter-behavior·spawn-agents 등이 번갈아 실패).
 *
 * 여기서는 소켓을 아예 열지 않도록 Pool/Client 를 거부 스텁으로 바꾼다. DB 가 필요한
 * 통합 테스트는 `TEST_DATABASE_URL` 을 주면 실제 pg 를 그대로 쓴다(그 변수가 없으면
 * 해당 스위트들은 스스로 describe.skip 하는 기존 관용구를 따른다).
 */
if (!process.env.TEST_DATABASE_URL) {
    jest.mock('pg', () => {
        const actual = jest.requireActual('pg');
        const reject = () => Promise.reject(
            new Error('단위 테스트에서는 DB 에 연결하지 않습니다 (TEST_DATABASE_URL 로 활성화)'),
        );
        class BlockedPool {
            query() { return reject(); }
            connect() { return reject(); }
            end() { return Promise.resolve(); }
            /** pg.Pool 은 EventEmitter — 'error' 핸들러 등록만 받고 아무것도 하지 않는다 */
            on() { return this; }
            off() { return this; }
            removeAllListeners() { return this; }
        }
        class BlockedClient extends BlockedPool {
            release() { /* no-op */ }
        }
        return { ...actual, Pool: BlockedPool, Client: BlockedClient };
    });
}

export {};
