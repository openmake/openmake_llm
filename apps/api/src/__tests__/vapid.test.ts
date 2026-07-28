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

    test('키 미설정 시 빈 문자열 반환', () => {
        mockGetConfig.mockReturnValue({
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        });

        const result = getVapidKeys();
        expect(result.publicKey).toBe('');
        expect(result.privateKey).toBe('');
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
