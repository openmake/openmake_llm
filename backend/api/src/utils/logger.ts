/**
 * 🆕 통합 로깅 시스템
 * Winston 기반 구조화된 로깅
 */

import winston from 'winston';
import path from 'path';

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
    level: process.env.LOG_LEVEL || 'info',
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

// 카테고리별 로거 생성
export function createLogger(category: string) {
    return {
        debug: (msg: string, meta?: any) => logger.debug(`[${category}] ${msg}`, meta),
        info: (msg: string, meta?: any) => logger.info(`[${category}] ${msg}`, meta),
        warn: (msg: string, meta?: any) => logger.warn(`[${category}] ${msg}`, meta),
        error: (msg: string, meta?: any) => logger.error(`[${category}] ${msg}`, meta)
    };
}

export default logger;
