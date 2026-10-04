/**
 * 실행 소유권 owner 이름 — 같은 호스트에서 따로 뜨는 프로세스는 OMK_LEASE_INSTANCE 로 서버와 다른 이름을 쓴다.
 */
describe('leaseOwner', () => {
    const env = { ...process.env };
    afterEach(() => { process.env = { ...env }; jest.resetModules(); });

    function load(): string {
        let owner = '';
        jest.isolateModules(() => { owner = (require('../lease-owner') as typeof import('../lease-owner')).leaseOwner(); });
        return owner;
    }

    it('기본은 호스트명:PM2 인스턴스 번호(없으면 0)', () => {
        delete process.env.OMK_LEASE_INSTANCE; delete process.env.NODE_APP_INSTANCE;
        expect(load()).toMatch(/:0$/);
        process.env.NODE_APP_INSTANCE = '3';
        expect(load()).toMatch(/:3$/);
    });

    it('OMK_LEASE_INSTANCE 가 있으면 그것이 우선한다 — 서버(0)와 다른 이름이 된다', () => {
        process.env.NODE_APP_INSTANCE = '0';
        process.env.OMK_LEASE_INSTANCE = 'eval-4242';
        expect(load()).toMatch(/:eval-4242$/);
    });
});
