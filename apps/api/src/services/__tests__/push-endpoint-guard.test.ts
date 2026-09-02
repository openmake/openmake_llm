/**
 * Web Push endpoint 아웃바운드 검증 (2026-09-02 보안 리뷰 L1 — blind SSRF 차단)
 */
import { assertPushEndpointAllowed } from '../push-endpoint-guard';
import { ValidationError } from '../../utils/error-handler';

const resolveTo = (address: string) => async () => ({ address });

describe('assertPushEndpointAllowed', () => {
    it('loopback 으로 풀리는 endpoint 는 거부', async () => {
        await expect(assertPushEndpointAllowed('https://evil.example/x', resolveTo('127.0.0.1'))).rejects.toThrow(ValidationError);
    });
    it('link-local(메타데이터) 으로 풀리는 endpoint 는 거부', async () => {
        await expect(assertPushEndpointAllowed('https://evil.example/x', resolveTo('169.254.169.254'))).rejects.toThrow(ValidationError);
    });
    it('사설 대역으로 풀리는 endpoint 는 거부', async () => {
        await expect(assertPushEndpointAllowed('https://evil.example/x', resolveTo('10.0.0.5'))).rejects.toThrow(ValidationError);
    });
    it('http 스킴은 거부 (DNS 조회 전)', async () => {
        const resolver = jest.fn(resolveTo('1.2.3.4'));
        await expect(assertPushEndpointAllowed('http://fcm.googleapis.com/x', resolver)).rejects.toThrow(ValidationError);
        expect(resolver).not.toHaveBeenCalled();
    });
    it('URL 이 아니면 거부', async () => {
        await expect(assertPushEndpointAllowed('not a url', resolveTo('1.2.3.4'))).rejects.toThrow(ValidationError);
    });
    it('공인 IP 로 풀리는 https endpoint 는 통과', async () => {
        await expect(assertPushEndpointAllowed('https://fcm.googleapis.com/fcm/send/abc', resolveTo('142.250.0.1'))).resolves.toBeUndefined();
    });
});
