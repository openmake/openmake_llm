/**
 * 🆕 알림 시스템
 * 할당량 경고, 시스템 이상 감지 알림
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('AlertSystem');

// 알림 채널 타입
type AlertChannel = 'console' | 'email' | 'webhook';

// 알림 심각도
type AlertSeverity = 'info' | 'warning' | 'critical';

// 알림 타입
type AlertType =
    | 'quota_warning'
    | 'quota_critical'
    | 'api_error'
    | 'system_overload'
    | 'key_exhausted'
    | 'response_time_spike'
    | 'error_rate_spike';

// 알림 메시지 인터페이스
interface AlertMessage {
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    message: string;
    data?: Record<string, any>;
    timestamp: Date;
}

// 알림 설정 인터페이스
interface AlertConfig {
    enabled: boolean;
    channels: AlertChannel[];
    webhookUrl?: string;
    thresholds: {
        quotaWarningPercent: number;   // 70%
        quotaCriticalPercent: number;  // 90%
        responseTimeMs: number;        // 5000ms
        errorRatePercent: number;      // 10%
    };
    cooldownMinutes: number;  // 중복 알림 방지 (분)
}

/**
 * 알림 시스템 클래스
 */
export class AlertSystem {
    private config: AlertConfig;
    private lastAlerts: Map<string, Date> = new Map();
    private alertHistory: AlertMessage[] = [];

    constructor(config?: Partial<AlertConfig>) {
        this.config = {
            enabled: config?.enabled ?? true,
            channels: config?.channels ?? ['console'],
            thresholds: {
                quotaWarningPercent: config?.thresholds?.quotaWarningPercent ?? 70,
                quotaCriticalPercent: config?.thresholds?.quotaCriticalPercent ?? 90,
                responseTimeMs: config?.thresholds?.responseTimeMs ?? 5000,
                errorRatePercent: config?.thresholds?.errorRatePercent ?? 10
            },
            cooldownMinutes: config?.cooldownMinutes ?? 15,
            webhookUrl: config?.webhookUrl
        };

        logger.info('알림 시스템 초기화됨', { channels: this.config.channels });
    }

    /**
     * 알림 발송
     */
    async sendAlert(
        type: AlertType,
        severity: AlertSeverity,
        title: string,
        message: string,
        data?: Record<string, any>
    ): Promise<void> {
        if (!this.config.enabled) return;

        // 쿨다운 체크
        const alertKey = `${type}:${severity}`;
        const lastAlert = this.lastAlerts.get(alertKey);
        if (lastAlert) {
            const elapsed = (Date.now() - lastAlert.getTime()) / 1000 / 60;
            if (elapsed < this.config.cooldownMinutes) {
                logger.debug(`알림 쿨다운 중: ${alertKey} (${this.config.cooldownMinutes - elapsed}분 남음)`);
                return;
            }
        }

        const alert: AlertMessage = {
            type,
            severity,
            title,
            message,
            data,
            timestamp: new Date()
        };

        // 히스토리 저장
        this.alertHistory.push(alert);
        if (this.alertHistory.length > 100) {
            this.alertHistory.shift();
        }

        // 마지막 알림 시간 기록
        this.lastAlerts.set(alertKey, new Date());

        // 각 채널로 발송
        for (const channel of this.config.channels) {
            await this.sendToChannel(channel, alert);
        }
    }

    /**
     * 채널별 알림 발송
     */
    private async sendToChannel(channel: AlertChannel, alert: AlertMessage): Promise<void> {
        try {
            switch (channel) {
                case 'console':
                    this.sendConsoleAlert(alert);
                    break;
                case 'webhook':
                    await this.sendWebhookAlert(alert);
                    break;
            }
        } catch (error) {
            logger.error(`알림 발송 실패 (${channel}):`, error);
        }
    }

    /**
     * 콘솔 알림
     */
    private sendConsoleAlert(alert: AlertMessage): void {
        const emoji = alert.severity === 'critical' ? '🚨' :
            alert.severity === 'warning' ? '⚠️' : 'ℹ️';

        console.log(`\n${emoji} [${alert.severity.toUpperCase()}] ${alert.title}`);
        console.log(`   ${alert.message}`);
        if (alert.data) {
            console.log(`   데이터:`, JSON.stringify(alert.data, null, 2));
        }
        console.log();
    }

    /**
     * Webhook 알림
     */
    private async sendWebhookAlert(alert: AlertMessage): Promise<void> {
        if (!this.config.webhookUrl) return;

        const payload = {
            type: alert.type,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            data: alert.data,
            timestamp: alert.timestamp.toISOString()
        };

        const response = await fetch(this.config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook 응답 오류: ${response.status}`);
        }

        logger.info(`Webhook 알림 발송: ${alert.title}`);
    }

    // ================================================
    // 편의 메서드 - 특정 알림 타입
    // ================================================

    /**
     * 할당량 경고 알림
     */
    async alertQuotaWarning(keyId: string, usagePercent: number, remaining: number): Promise<void> {
        await this.sendAlert(
            'quota_warning',
            'warning',
            'API 할당량 경고',
            `API 키 ${keyId}의 사용량이 ${usagePercent}%에 도달했습니다.`,
            { keyId, usagePercent, remaining }
        );
    }

    /**
     * 할당량 위험 알림
     */
    async alertQuotaCritical(keyId: string, usagePercent: number, remaining: number): Promise<void> {
        await this.sendAlert(
            'quota_critical',
            'critical',
            'API 할당량 위험',
            `API 키 ${keyId}의 사용량이 ${usagePercent}%에 도달했습니다! 즉시 조치 필요!`,
            { keyId, usagePercent, remaining }
        );
    }

    /**
     * 키 소진 알림
     */
    async alertKeyExhausted(keyId: string): Promise<void> {
        await this.sendAlert(
            'key_exhausted',
            'critical',
            'API 키 소진',
            `API 키 ${keyId}의 할당량이 모두 소진되었습니다. 다른 키로 전환합니다.`,
            { keyId }
        );
    }

    /**
     * 응답시간 급증 알림
     */
    async alertResponseTimeSpike(avgResponseTime: number, threshold: number): Promise<void> {
        await this.sendAlert(
            'response_time_spike',
            'warning',
            '응답 시간 급증',
            `평균 응답 시간이 ${avgResponseTime}ms로 임계값(${threshold}ms)을 초과했습니다.`,
            { avgResponseTime, threshold }
        );
    }

    /**
     * 에러율 급증 알림
     */
    async alertErrorRateSpike(errorRate: number, threshold: number): Promise<void> {
        await this.sendAlert(
            'error_rate_spike',
            'critical',
            '에러율 급증',
            `에러율이 ${errorRate}%로 임계값(${threshold}%)을 초과했습니다.`,
            { errorRate, threshold }
        );
    }

    /**
     * 알림 히스토리 조회
     */
    getAlertHistory(limit: number = 50): AlertMessage[] {
        return this.alertHistory.slice(-limit);
    }

    /**
     * 알림 시스템 상태 조회
     */
    getStatus(): { enabled: boolean; channels: AlertChannel[]; historyCount: number } {
        return {
            enabled: this.config.enabled,
            channels: this.config.channels,
            historyCount: this.alertHistory.length
        };
    }
}

// 싱글톤 인스턴스
let alertSystemInstance: AlertSystem | null = null;

export function getAlertSystem(): AlertSystem {
    if (!alertSystemInstance) {
        alertSystemInstance = new AlertSystem();
    }
    return alertSystemInstance;
}

export function createAlertSystem(config?: Partial<AlertConfig>): AlertSystem {
    return new AlertSystem(config);
}
