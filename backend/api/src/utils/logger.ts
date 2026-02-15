/**
 * ============================================================
 * Logger - Winston 기반 통합 로깅 시스템
 * ============================================================
 *
 * 애플리케이션 전역에서 사용되는 구조화된 로깅 시스템입니다.
 * 콘솔 출력과 파일 로깅을 동시에 지원하며, 카테고리별 로거를 생성할 수 있습니다.
 *
 * @module utils/logger
 * @description
 * - 콘솔: 컬러 포맷, 시:분:초 타임스탬프
 * - 파일: error.log (에러 전용), combined.log (전체), 각 5MB/5파일 로테이션
 * - 카테고리 로거: createLogger('CategoryName')으로 [Category] 접두사 자동 추가
 * - 로그 레벨: 환경변수 LOG_LEVEL (기본: info)
 */

import winston from 'winston';
import path from 'path';
import { getConfig } from '../config/env';

const logDir = path.join(__dirname, '../../logs');

// 커스텀 포맷
const customFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `[${timestamp}] ${level.toUpperCase()}: ${message} ${metaStr}`;
    })
);

// 콘솔 포맷 (컬러)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp }) => {
        return `[${timestamp}] ${level}: ${message}`;
    })
);

// 로거 생성
export const logger = winston.createLogger({
    level: getConfig().logLevel,
    format: customFormat,
    transports: [
        // 콘솔 출력
        new winston.transports.Console({
            format: consoleFormat
        }),
        // 에러 로그 파일
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // 전체 로그 파일
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

/**
 * 카테고리별 로거를 생성합니다.
 * 각 로그 메시지에 [category] 접두사가 자동으로 추가됩니다.
 *
 * @param category - 로거 카테고리명 (예: 'AuthController', 'ConversationDB')
 * @returns debug, info, warn, error 메서드를 가진 로거 객체
 *
 * @example
 * const log = createLogger('MyService');
 * log.info('서비스 시작됨');  // [HH:mm:ss] INFO: [MyService] 서비스 시작됨
 */
export function createLogger(category: string) {
    return {
        debug: (msg: string, meta?: unknown) => logger.debug(`[${category}] ${msg}`, meta),
        info: (msg: string, meta?: unknown) => logger.info(`[${category}] ${msg}`, meta),
        warn: (msg: string, meta?: unknown) => logger.warn(`[${category}] ${msg}`, meta),
        error: (msg: string, meta?: unknown) => logger.error(`[${category}] ${msg}`, meta)
    };
}

export default logger;
