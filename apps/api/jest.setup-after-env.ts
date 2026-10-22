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
} else {
    // TEST_DATABASE_URL 이 있으면 jest.setup.ts 가 DATABASE_URL 을 그 값으로 덮어, getPool() 을 거치는 코드가 실제 풀을
    // 연다(UnifiedDatabase 생성자가 스키마 초기화까지 바로 시작). 스위트가 그 풀을 닫지 않으면 승인 저장 같은
    // fire-and-forget 쿼리가 큐에 남아, Jest 가 환경을 해제한 뒤 pg-pool 이 새 클라이언트를 만들며 `net` 을
    // require 하다 "require after the Jest environment has been torn down" unhandled error 로 러너 프로세스가 죽는다
    // (2026-10-23 CI dev-checks 실측: --runInBand 로 돌던 runtime.test.ts 에서 exit 1 — 위 2026-08-24 와 같은 부류).
    //
    // 여기서는 만들어진 Pool 을 전부 기억해 두었다가 파일마다 afterAll 에서 닫아, 해제 전에 소켓을 거둔다.
    // pg 수준에서 잡는 이유: unified-database 모듈을 여기서 require 하면 fs 등을 mock 한 스위트에서 logger 가 깨지고
    // (validation.test.ts 실측), jest.resetModules 뒤 새로 만들어진 싱글톤은 닿지 않는다. 풀을 만들지 않은 스위트는 no-op.
    const mockPools: Array<{ ending: boolean; end: () => Promise<void> }> = [];
    jest.mock('pg', () => {
        const actual = jest.requireActual('pg');
        class TrackedPool extends actual.Pool {
            constructor(...args: unknown[]) {
                super(...args);
                mockPools.push(this);
            }
            /** 두 번 end 해도 던지지 않는다 — 아래 afterAll(설정 파일의 훅이 스위트 최상위 afterAll 보다 먼저 돈다)이 닫은 풀을 스위트가 다시 닫을 수 있다. */
            end(cb?: (err?: Error) => void) {
                if (this.ending) { cb?.(); return Promise.resolve(); }
                return super.end(cb);
            }
        }
        return { ...actual, Pool: TrackedPool };
    });
    afterAll(async () => {
        await Promise.all(mockPools.splice(0).map((pool) => (pool.ending ? undefined : pool.end())));
    }, 30_000);
}

export {};
