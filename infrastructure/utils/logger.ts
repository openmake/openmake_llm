/**
 * Infrastructure Logger
 * 경량 콘솔 기반 로거 (Winston 의존성 없음)
 */

export function createLogger(category: string) {
    const prefix = `[${category}]`;
    return {
        debug: (msg: string, meta?: unknown) => {
            if (process.env.LOG_LEVEL === 'debug') {
                console.debug(`${prefix} ${msg}`, meta !== undefined ? meta : '');
            }
        },
        info: (msg: string, meta?: unknown) => console.log(`${prefix} ${msg}`, meta !== undefined ? meta : ''),
        warn: (msg: string, meta?: unknown) => console.warn(`${prefix} ${msg}`, meta !== undefined ? meta : ''),
        error: (msg: string, meta?: unknown) => console.error(`${prefix} ${msg}`, meta !== undefined ? meta : ''),
    };
}

export default createLogger;
