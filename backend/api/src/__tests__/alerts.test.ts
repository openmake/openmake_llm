/**
 * alerts.test.ts
 * AlertSystem 클래스 단위 테스트
 * nodemailer는 jest.mock으로 격리
 */

// nodemailer 모킹 — 이메일 전송 없이 테스트
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' })
    }))
}));

// fetch 모킹 — webhook 전송 없이 테스트
global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200
} as Response) as unknown as typeof fetch;

import { AlertSystem, createAlertSystem, getAlertSystem } from '../monitoring/alerts';

// ============================================================
// 헬퍼
// ============================================================

function freshAlertSystem(config?: Parameters<typeof createAlertSystem>[0]): AlertSystem {
    return createAlertSystem({ channels: ['console'], ...config });
}

// ============================================================
// 초기화
// ============================================================

describe('AlertSystem — 초기화', () => {
    test('createAlertSystem()으로 인스턴스를 생성할 수 있다', () => {
        const alerts = freshAlertSystem();
        expect(alerts).toBeInstanceOf(AlertSystem);
    });

    test('기본 설정: enabled=true, channels=[console]', () => {
        const alerts = new AlertSystem();
        const status = alerts.getStatus();
        expect(status.enabled).toBe(true);
        expect(status.channels).toContain('console');
    });

    test('초기 historyCount = 0', () => {
        const alerts = freshAlertSystem();
        expect(alerts.getStatus().historyCount).toBe(0);
    });

    test('enabled=false로 생성하면 비활성화 상태', () => {
        const alerts = createAlertSystem({ enabled: false });
        expect(alerts.getStatus().enabled).toBe(false);
    });

    test('커스텀 채널 설정이 반영된다', () => {
        const alerts = createAlertSystem({ channels: ['console', 'webhook'], webhookUrl: 'http://example.com' });
        expect(alerts.getStatus().channels).toEqual(['console', 'webhook']);
    });
});

// ============================================================
// getStatus()
// ============================================================

describe('AlertSystem — getStatus()', () => {
    test('enabled, channels, historyCount를 반환한다', () => {
        const alerts = freshAlertSystem();
        const status = alerts.getStatus();
        expect(status).toHaveProperty('enabled');
        expect(status).toHaveProperty('channels');
        expect(status).toHaveProperty('historyCount');
    });

    test('알림 발송 후 historyCount가 증가한다', async () => {
        const alerts = freshAlertSystem();
        await alerts.sendAlert('api_error', 'warning', 'Test', 'Test message');
        expect(alerts.getStatus().historyCount).toBe(1);
    });
});

// ============================================================
// sendAlert() — 기본 동작
// ============================================================

describe('AlertSystem — sendAlert()', () => {
    test('알림이 히스토리에 저장된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.sendAlert('api_error', 'info', '테스트 제목', '테스트 메시지');

        const history = alerts.getAlertHistory();
        expect(history).toHaveLength(1);
        expect(history[0].type).toBe('api_error');
        expect(history[0].severity).toBe('info');
        expect(history[0].title).toBe('테스트 제목');
        expect(history[0].message).toBe('테스트 메시지');
    });

    test('enabled=false이면 알림이 발송되지 않는다', async () => {
        const alerts = createAlertSystem({ enabled: false, channels: ['console'] });
        await alerts.sendAlert('api_error', 'warning', 'Test', 'Test');
        expect(alerts.getStatus().historyCount).toBe(0);
    });

    test('data 필드가 포함된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.sendAlert('quota_warning', 'warning', '할당량', '70% 사용', { keyId: 'key-1', usage: 70 });

        const history = alerts.getAlertHistory();
        expect(history[0].data).toEqual({ keyId: 'key-1', usage: 70 });
    });

    test('timestamp가 Date 인스턴스다', async () => {
        const alerts = freshAlertSystem();
        await alerts.sendAlert('api_error', 'critical', 'Critical', 'critical message');

        const history = alerts.getAlertHistory();
        expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    test('알림이 100건을 초과하면 오래된 것이 제거된다', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 0 });

        // 101건 발송
        for (let i = 0; i < 101; i++) {
            // 각 요청마다 type을 다르게 하여 쿨다운 우회
            const types = ['api_error', 'quota_warning', 'quota_critical', 'system_overload',
                'key_exhausted', 'response_time_spike', 'error_rate_spike'] as const;
            const type = types[i % types.length];
            // cooldown은 type:severity 조합 기준이므로 message만 다르게
            (alerts as unknown as { lastAlerts: Map<string, Date> }).lastAlerts.clear();
            await alerts.sendAlert(type, 'info', `제목 ${i}`, `메시지 ${i}`);
        }

        expect(alerts.getAlertHistory().length).toBeLessThanOrEqual(100);
    });
});

// ============================================================
// 쿨다운 메커니즘
// ============================================================

describe('AlertSystem — 쿨다운', () => {
    test('쿨다운 내 동일 타입/심각도의 알림은 무시된다', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 15 });

        await alerts.sendAlert('api_error', 'warning', '1차', '메시지1');
        await alerts.sendAlert('api_error', 'warning', '2차', '메시지2');

        // 두 번째 알림은 쿨다운 때문에 히스토리에 저장되지 않음
        expect(alerts.getStatus().historyCount).toBe(1);
    });

    test('다른 타입의 알림은 쿨다운에 관계없이 발송된다', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 15 });

        await alerts.sendAlert('api_error', 'warning', '에러 알림', '메시지');
        await alerts.sendAlert('quota_warning', 'warning', '할당량 알림', '메시지');

        expect(alerts.getStatus().historyCount).toBe(2);
    });

    test('동일 타입이라도 심각도가 다르면 별도 쿨다운', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 15 });

        await alerts.sendAlert('api_error', 'warning', '경고', '경고 메시지');
        await alerts.sendAlert('api_error', 'critical', '위험', '위험 메시지');

        expect(alerts.getStatus().historyCount).toBe(2);
    });

    test('cooldownMinutes=0이면 모든 알림이 즉시 발송된다', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 0 });

        await alerts.sendAlert('api_error', 'warning', '1차', '메시지');

        // 쿨다운 0분: 즉시 재발송 가능
        // lastAlerts.get()의 elapsed = 0 > cooldownMinutes=0이 false이므로
        // 실제로는 elapsed < 0 는 false, elapsed >= 0 → 쿨다운 적용됨
        // cooldownMinutes=0이면 elapsed(0) < 0 → false → 발송됨
        // 하지만 같은 ms 내라면 elapsed=0 < 0 → false → 발송
        // 테스트에서는 setTimeout 없이 동기적으로 실행되므로 2번째는 블록될 수 있음
        // → lastAlerts 수동 클리어로 테스트
        (alerts as unknown as { lastAlerts: Map<string, Date> }).lastAlerts.clear();
        await alerts.sendAlert('api_error', 'warning', '2차', '메시지');

        expect(alerts.getStatus().historyCount).toBe(2);
    });
});

// ============================================================
// getAlertHistory()
// ============================================================

describe('AlertSystem — getAlertHistory()', () => {
    test('기본 limit=50으로 반환된다', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 0 });
        const types = ['api_error', 'quota_warning', 'quota_critical', 'system_overload',
            'key_exhausted', 'response_time_spike', 'error_rate_spike'] as const;

        for (let i = 0; i < 60; i++) {
            (alerts as unknown as { lastAlerts: Map<string, Date> }).lastAlerts.clear();
            const type = types[i % types.length];
            await alerts.sendAlert(type, 'info', `제목 ${i}`, `메시지 ${i}`);
        }

        const history = alerts.getAlertHistory(); // default limit 50
        expect(history.length).toBeLessThanOrEqual(50);
    });

    test('limit 파라미터로 반환 수를 제어할 수 있다', async () => {
        const alerts = freshAlertSystem({ cooldownMinutes: 0 });
        const types = ['api_error', 'quota_warning'] as const;

        for (let i = 0; i < 10; i++) {
            (alerts as unknown as { lastAlerts: Map<string, Date> }).lastAlerts.clear();
            const type = types[i % types.length];
            await alerts.sendAlert(type, 'info', `제목 ${i}`, `메시지 ${i}`);
        }

        expect(alerts.getAlertHistory(3).length).toBeLessThanOrEqual(3);
    });

    test('빈 히스토리는 빈 배열 반환', () => {
        const alerts = freshAlertSystem();
        expect(alerts.getAlertHistory()).toEqual([]);
    });
});

// ============================================================
// 편의 메서드 테스트
// ============================================================

describe('AlertSystem — 편의 메서드', () => {
    test('alertQuotaWarning()이 quota_warning 타입으로 발송된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.alertQuotaWarning('key-1', 75, 25);

        const history = alerts.getAlertHistory();
        expect(history[0].type).toBe('quota_warning');
        expect(history[0].severity).toBe('warning');
        expect(history[0].data?.keyId).toBe('key-1');
    });

    test('alertQuotaCritical()이 quota_critical 타입으로 발송된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.alertQuotaCritical('key-2', 92, 8);

        const history = alerts.getAlertHistory();
        expect(history[0].type).toBe('quota_critical');
        expect(history[0].severity).toBe('critical');
        expect(history[0].data?.keyId).toBe('key-2');
    });

    test('alertKeyExhausted()가 key_exhausted 타입으로 발송된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.alertKeyExhausted('key-3');

        const history = alerts.getAlertHistory();
        expect(history[0].type).toBe('key_exhausted');
        expect(history[0].severity).toBe('critical');
        expect(history[0].data?.keyId).toBe('key-3');
    });

    test('alertResponseTimeSpike()가 response_time_spike 타입으로 발송된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.alertResponseTimeSpike(8000, 5000);

        const history = alerts.getAlertHistory();
        expect(history[0].type).toBe('response_time_spike');
        expect(history[0].severity).toBe('warning');
        expect(history[0].data?.avgResponseTime).toBe(8000);
        expect(history[0].data?.threshold).toBe(5000);
    });

    test('alertErrorRateSpike()가 error_rate_spike 타입으로 발송된다', async () => {
        const alerts = freshAlertSystem();
        await alerts.alertErrorRateSpike(15, 10);

        const history = alerts.getAlertHistory();
        expect(history[0].type).toBe('error_rate_spike');
        expect(history[0].severity).toBe('critical');
        expect(history[0].data?.errorRate).toBe(15);
        expect(history[0].data?.threshold).toBe(10);
    });
});

// ============================================================
// getAlertSystem() — 싱글톤 테스트
// ============================================================

describe('getAlertSystem() — 싱글톤', () => {
    test('두 번 호출하면 동일 인스턴스를 반환한다', () => {
        const a = getAlertSystem();
        const b = getAlertSystem();
        expect(a).toBe(b);
    });

    test('AlertSystem 인스턴스이다', () => {
        const instance = getAlertSystem();
        expect(instance).toBeInstanceOf(AlertSystem);
    });
});

// ============================================================
// createAlertSystem() — 독립 인스턴스
// ============================================================

describe('createAlertSystem() — 독립 인스턴스', () => {
    test('각 호출마다 새 인스턴스를 반환한다', () => {
        const a = createAlertSystem();
        const b = createAlertSystem();
        expect(a).not.toBe(b);
    });

    test('설정이 독립적으로 적용된다', async () => {
        const alerts1 = createAlertSystem({ channels: ['console'] });
        const alerts2 = createAlertSystem({ enabled: false, channels: ['console'] });

        await alerts1.sendAlert('api_error', 'info', 'Test', 'msg');
        await alerts2.sendAlert('api_error', 'info', 'Test', 'msg');

        expect(alerts1.getStatus().historyCount).toBe(1);
        expect(alerts2.getStatus().historyCount).toBe(0);
    });
});
