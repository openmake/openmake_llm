/**
 * vapid.test.ts
 * VAPID 키 관리 유틸리티 테스트
 */

const mockSetVapidDetails = jest.fn();
const mockGenerateVAPIDKeys = jest.fn(() => ({
    publicKey: 'generated-public-key',
    privateKey: 'generated-private-key'
}));

jest.mock('web-push', () => ({
    default: {
        setVapidDetails: mockSetVapidDetails,
        generateVAPIDKeys: mockGenerateVAPIDKeys
    },
    setVapidDetails: mockSetVapidDetails,
    generateVAPIDKeys: mockGenerateVAPIDKeys
}));

jest.mock('../config/env', () => ({
    getConfig: jest.fn()
}));

const mockWarn = jest.fn();
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ warn: mockWarn, info: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

import { getConfig } from '../config/env';
import { getVapidKeys, generateVapidKeys } from '../utils/vapid';

const mockGetConfig = getConfig as jest.Mock;

describe('getVapidKeys', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('공개키/비밀키 모두 있으면 setVapidDetails 호출', () => {
        mockGetConfig.mockReturnValue({
            vapidPublicKey: 'pub-key',
            vapidPrivateKey: 'priv-key',
            vapidSubject: 'mailto:admin@example.com'
        });

        const result = getVapidKeys();

        expect(mockSetVapidDetails).toHaveBeenCalledWith(
            'mailto:admin@example.com',
            'pub-key',
            'priv-key'
        );
        expect(result.publicKey).toBe('pub-key');
        expect(result.privateKey).toBe('priv-key');
        expect(result.subject).toBe('mailto:admin@example.com');
        expect(result.enabled).toBe(true);
    });

    test('공개키 없으면 setVapidDetails 호출 안 함', () => {
        mockGetConfig.mockReturnValue({
            vapidPublicKey: '',
            vapidPrivateKey: 'priv-key',
            vapidSubject: 'mailto:admin@example.com'
        });

        getVapidKeys();
        expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });

    test('비밀키 없으면 setVapidDetails 호출 안 함', () => {
        mockGetConfig.mockReturnValue({
            vapidPublicKey: 'pub-key',
            vapidPrivateKey: '',
            vapidSubject: 'mailto:admin@example.com'
        });

        getVapidKeys();
        expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });

    test('연락처(VAPID_SUBJECT)가 비면 키가 있어도 푸시를 켜지 않는다(기본값 없음)', () => {
        mockGetConfig.mockReturnValue({
            vapidPublicKey: 'test-public-key',
            vapidPrivateKey: 'test-private-key',
            vapidSubject: ''
        });

        expect(getVapidKeys().enabled).toBe(false);
        expect(mockSetVapidDetails).not.toHaveBeenCalled();
        // 꺼졌다는 사실은 한 번만 알린다(부팅 때 1회 — 이후 호출은 조용히)
        getVapidKeys();
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn.mock.calls[0][0]).toContain('VAPID_SUBJECT');
    });

    test('키 미설정 시 빈 문자열 반환', () => {
        mockGetConfig.mockReturnValue({
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        });

        const result = getVapidKeys();
        expect(result.publicKey).toBe('');
        expect(result.privateKey).toBe('');
        expect(result.enabled).toBe(false);
    });
});

describe('generateVapidKeys', () => {
    test('새 키 쌍 생성 후 반환', () => {
        const result = generateVapidKeys();
        expect(result.publicKey).toBe('generated-public-key');
        expect(result.privateKey).toBe('generated-private-key');
        expect(mockGenerateVAPIDKeys).toHaveBeenCalled();
    });
});
