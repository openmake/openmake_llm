/**
 * ============================================================
 * Alert System - 시스템 알림 및 경고 관리
 * ============================================================
 *
 * API 할당량 경고, 시스템 이상 감지, 에러율 급증 등의 이벤트를
 * 콘솔, 이메일, Webhook 채널로 발송하는 알림 시스템입니다.
 *
 * @module monitoring/alerts
 * @description
 * - 다중 채널 알림 발송 (console, email, webhook)
 * - 심각도 기반 분류 (info, warning, critical)
 * - 7가지 알림 타입 (할당량, API 에러, 시스템 과부하, 키 소진, 응답 시간, 에러율)
 * - 쿨다운 메커니즘으로 중복 알림 방지 (기본 15분)
 * - 알림 히스토리 보관 (최대 100건)
 * - Nodemailer 기반 이메일 발송
 * - 싱글톤 패턴으로 전역 인스턴스 관리
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type { Pool } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('AlertSystem');

/** 알림 발송 채널 타입 */
type AlertChannel = 'console' | 'email' | 'webhook';

/** 알림 심각도 레벨 */
type AlertSeverity = 'info' | 'warning' | 'critical';

/** 알림 이벤트 타입 */
type AlertType =
    | 'quota_warning'
    | 'quota_critical'
    | 'api_error'
    | 'system_overload'
    | 'key_exhausted'
    | 'response_time_spike'
    | 'error_rate_spike';

/**
 * 알림 메시지 인터페이스
 *
 * @interface AlertMessage
 */
interface AlertMessage {
    /** 알림 이벤트 타입 */
    type: AlertType;
    /** 심각도 레벨 */
    severity: AlertSeverity;
    /** 알림 제목 */
    title: string;
    /** 알림 상세 메시지 */
    message: string;
    /** 추가 데이터 (키ID, 사용률 등) */
    data?: Record<string, any>;
    /** 알림 발생 시점 */
    timestamp: Date;
}

/**
 * 알림 시스템 설정 인터페이스
 *
 * @interface AlertConfig
 */
interface AlertConfig {
    /** 알림 시스템 활성화 여부 */
    enabled: boolean;
    /** 사용할 알림 채널 목록 */
    channels: AlertChannel[];
    /** 이메일 발송 설정 (SMTP) */
    emailConfig?: {
        /** SMTP 서버 호스트 */
        host: string;
        /** SMTP 서버 포트 */
        port: number;
        /** TLS/SSL 사용 여부 */
        secure: boolean;
        /** SMTP 인증 정보 */
        auth: {
            /** SMTP 사용자명 */
            user: string;
            /** SMTP 비밀번호 */
            pass: string;
        };
        /** 알림 수신자 이메일 목록 */
        recipients: string[];
    };
    /** Webhook 발송 URL */
    webhookUrl?: string;
    /** 알림 발동 임계값 설정 */
    thresholds: {
        /** 할당량 경고 임계값 (%, 기본 70%) */
        quotaWarningPercent: number;
        /** 할당량 위험 임계값 (%, 기본 90%) */
        quotaCriticalPercent: number;
        /** 응답 시간 임계값 (ms, 기본 5000ms) */
        responseTimeMs: number;
        /** 에러율 임계값 (%, 기본 10%) */
        errorRatePercent: number;
    };
    /** 중복 알림 방지 쿨다운 시간 (분, 기본 15분) */
    cooldownMinutes: number;
}

/**
 * 알림 시스템 클래스
 *
 * 다중 채널(콘솔, 이메일, Webhook)로 알림을 발송하며,
 * 쿨다운 메커니즘으로 동일 타입/심각도의 중복 알림을 방지합니다.
 * 알림 히스토리는 최대 100건까지 보관합니다.
 *
 * @class AlertSystem
 */
export class AlertSystem {
    /** 알림 시스템 설정 */
    private config: AlertConfig;
    /** Nodemailer 이메일 전송기 */
    private transporter: Transporter | null = null;
    /** 알림 타입별 마지막 발송 시간 (쿨다운 체크용) */
    private lastAlerts: Map<string, Date> = new Map();
    /** 알림 히스토리 (최대 100건) */
    private alertHistory: AlertMessage[] = [];
    /** PostgreSQL Pool (alert_history DB 영속화용) */
    private pool: Pool | null = null;

    /**
     * AlertSystem 인스턴스를 생성합니다.
     *
     * 기본값: enabled=true, channels=['console'], cooldown=15분
     * emailConfig가 제공되면 Nodemailer 전송기를 자동 초기화합니다.
     *
     * @param config - 알림 설정 (부분 지정 가능, 미지정 항목은 기본값 사용)
     */
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
            emailConfig: config?.emailConfig,
            webhookUrl: config?.webhookUrl
        };

        // 이메일 전송기 설정
        if (this.config.emailConfig) {
            this.transporter = nodemailer.createTransport({
                host: this.config.emailConfig.host,
                port: this.config.emailConfig.port,
                secure: this.config.emailConfig.secure,
                auth: this.config.emailConfig.auth
            });
        }

        logger.info('알림 시스템 초기화됨', { channels: this.config.channels });
    }

    /**
     * PostgreSQL Pool을 주입하여 alert_history 테이블에 영속화를 활성화합니다.
     *
     * @param pool - pg Pool 인스턴스
     */
    setPool(pool: Pool): void {
        this.pool = pool;
        logger.info('AlertSystem: DB 영속화 활성화됨');
    }

    /**
     * 알림을 발송합니다.
     *
     * 쿨다운 기간 내 동일 타입/심각도의 알림은 무시됩니다.
     * 설정된 모든 채널로 순차 발송합니다.
     *
     * @param type - 알림 이벤트 타입
     * @param severity - 심각도 레벨
     * @param title - 알림 제목
     * @param message - 알림 상세 메시지
     * @param data - 추가 데이터 (선택)
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

        // DB 영속화 (pool이 주입된 경우)
        if (this.pool) {
            this.pool.query(
                'INSERT INTO alert_history (type, severity, title, message, data) VALUES ($1, $2, $3, $4, $5)',
                [alert.type, alert.severity, alert.title, alert.message,
                 alert.data !== undefined ? JSON.stringify(alert.data) : null]
            ).catch((err: Error) => logger.error('[AlertSystem] alert_history DB 저장 실패:', err));
        }

        // 마지막 알림 시간 기록
        this.lastAlerts.set(alertKey, new Date());

        // 각 채널로 발송
        for (const channel of this.config.channels) {
            await this.sendToChannel(channel, alert);
        }
    }

    /**
     * 지정된 채널로 알림을 발송합니다.
     *
     * @param channel - 발송 채널 (console/email/webhook)
     * @param alert - 알림 메시지 객체
     * @throws 채널 발송 실패 시 에러를 로깅하고 계속 진행
     */
    private async sendToChannel(channel: AlertChannel, alert: AlertMessage): Promise<void> {
        try {
            switch (channel) {
                case 'console':
                    this.sendConsoleAlert(alert);
                    break;
                case 'email':
                    await this.sendEmailAlert(alert);
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
     * 콘솔에 알림을 출력합니다.
     *
     * 심각도에 따라 이모지를 다르게 표시합니다.
     *
     * @param alert - 알림 메시지 객체
     */
    private sendConsoleAlert(alert: AlertMessage): void {
        const emoji = alert.severity === 'critical' ? '🚨' :
            alert.severity === 'warning' ? '⚠️' : 'ℹ️';

        logger.info(`\n${emoji} [${alert.severity.toUpperCase()}] ${alert.title}`);
        logger.info(`   ${alert.message}`);
        if (alert.data) {
            logger.info(`   데이터:`, JSON.stringify(alert.data, null, 2));
        }
    }

    /**
     * 이메일로 알림을 발송합니다.
     *
     * Nodemailer를 통해 HTML 형식의 알림 이메일을 전송합니다.
     * 전송기 또는 수신자가 설정되지 않으면 무시합니다.
     *
     * @param alert - 알림 메시지 객체
     */
    private async sendEmailAlert(alert: AlertMessage): Promise<void> {
        if (!this.transporter || !this.config.emailConfig?.recipients) return;

        const html = `
            <h2>${alert.severity === 'critical' ? '🚨' : '⚠️'} ${alert.title}</h2>
            <p>${alert.message}</p>
            ${alert.data ? `<pre>${JSON.stringify(alert.data, null, 2)}</pre>` : ''}
            <p><small>시간: ${alert.timestamp.toISOString()}</small></p>
        `;

        await this.transporter.sendMail({
            from: this.config.emailConfig.auth.user,
            to: this.config.emailConfig.recipients.join(', '),
            subject: `[Ollama LLM] ${alert.severity.toUpperCase()}: ${alert.title}`,
            html
        });

        logger.info(`이메일 알림 발송: ${alert.title}`);
    }

    /**
     * Webhook으로 알림을 발송합니다.
     *
     * JSON 페이로드를 POST 요청으로 전송합니다.
     * webhookUrl이 설정되지 않으면 무시합니다.
     *
     * @param alert - 알림 메시지 객체
     * @throws Webhook 응답이 2xx가 아닌 경우 에러
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
     * API 할당량 경고 알림을 발송합니다.
     *
     * @param keyId - API 키 식별자
     * @param usagePercent - 현재 사용률 (%)
     * @param remaining - 남은 할당량
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
     * API 할당량 위험 알림을 발송합니다 (즉시 조치 필요).
     *
     * @param keyId - API 키 식별자
     * @param usagePercent - 현재 사용률 (%)
     * @param remaining - 남은 할당량
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
     * API 키 할당량 소진 알림을 발송합니다.
     *
     * @param keyId - 소진된 API 키 식별자
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
     * 응답 시간 급증 알림을 발송합니다.
     *
     * @param avgResponseTime - 현재 평균 응답 시간 (ms)
     * @param threshold - 임계값 (ms)
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
     * 에러율 급증 알림을 발송합니다.
     *
     * @param errorRate - 현재 에러율 (%)
     * @param threshold - 임계값 (%)
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
     * 알림 히스토리를 조회합니다.
     *
     * @param limit - 반환할 최대 알림 수 (기본값: 50)
     * @returns 최근 알림 메시지 배열
     */
    getAlertHistory(limit: number = 50): AlertMessage[] {
        return this.alertHistory.slice(-limit);
    }

    /**
     * 알림 시스템 상태를 조회합니다.
     *
     * @returns 활성화 여부, 채널 목록, 히스토리 건수
     */
    getStatus(): { enabled: boolean; channels: AlertChannel[]; historyCount: number } {
        return {
            enabled: this.config.enabled,
            channels: this.config.channels,
            historyCount: this.alertHistory.length
        };
    }
}

/** 싱글톤 인스턴스 */
let alertSystemInstance: AlertSystem | null = null;

/**
 * AlertSystem 싱글톤 인스턴스를 반환합니다.
 *
 * 최초 호출 시 기본 설정으로 인스턴스를 생성하고, 이후 동일 인스턴스를 재사용합니다.
 *
 * @returns AlertSystem 싱글톤 인스턴스
 */
export function getAlertSystem(): AlertSystem {
    if (!alertSystemInstance) {
        alertSystemInstance = new AlertSystem();
    }
    return alertSystemInstance;
}

/**
 * 커스텀 설정으로 새로운 AlertSystem 인스턴스를 생성합니다.
 *
 * 싱글톤과 별개로 독립적인 인스턴스가 필요할 때 사용합니다.
 *
 * @param config - 알림 설정 (부분 지정 가능)
 * @returns 새로운 AlertSystem 인스턴스
 */
export function createAlertSystem(config?: Partial<AlertConfig>): AlertSystem {
    return new AlertSystem(config);
}
