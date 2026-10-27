/**
 * 부팅 순서 회귀 가드(보안 점검 A11) — UserManager 초기화(관리자 승격·계정 보장)는 마이그레이션 자동 적용 뒤다.
 *
 * 승격 UPDATE 가 users.tokens_valid_after(194)를, 계정 생성이 users_id_seq(009)를 쓴다. 순서가 뒤집히면 첫 업그레이드
 * 부팅에서 승격 계정의 이전 토큰이 끊기지 않는다. DashboardServer.start() 는 DB·LLM·add-on 을 모두 띄워 단위 테스트로
 * 돌릴 수 없어, 기존 경계 테스트(addon-boundary 등)처럼 소스 순서를 정적으로 검사한다.
 */
import { readFileSync } from 'fs';
import * as path from 'path';

const SERVER_SRC = readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');

describe('server.ts 부팅 순서', () => {
    it('getUserManager() 호출은 applyPendingWithLock 뒤에만 있다', () => {
        const migrate = SERVER_SRC.indexOf('await applyPendingWithLock(');
        const calls = [...SERVER_SRC.matchAll(/getUserManager\(\)\.ensureReady\(\)/g)].map((m) => m.index ?? -1);
        expect(migrate).toBeGreaterThan(-1);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBeGreaterThan(migrate);
    });

    it('UserManager 초기화 전에 다른 getUserManager() 호출이 없다(첫 호출이 초기화를 시작한다)', () => {
        const migrate = SERVER_SRC.indexOf('await applyPendingWithLock(');
        const code = SERVER_SRC.slice(0, migrate).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
        expect(code.join('\n')).not.toMatch(/getUserManager\s*\(/);
    });

    it('UserManager 초기화는 listen 보다 먼저다', () => {
        const init = SERVER_SRC.indexOf('getUserManager().ensureReady()');
        const listen = SERVER_SRC.indexOf('.listen(');
        expect(init).toBeGreaterThan(-1);
        expect(listen).toBeGreaterThan(init);
    });
});
