/**
 * ============================================================
 * Worker Logger - 경량 콘솔 기반 로거
 * ============================================================
 *
 * Winston 의존성 없이 콘솔 API만 사용하는 경량 로거입니다.
 * 카테고리 접두사를 자동 추가하며, LOG_LEVEL 환경 변수로
 * debug 레벨 출력을 제어합니다.
 *
 * @module workers/utils/logger
 * @description 제공하는 함수:
 * - createLogger(category) - 카테고리별 로거 인스턴스 생성
 *
 * @description 로그 레벨:
 * - debug - LOG_LEVEL=debug일 때만 출력
 * - info  - 항상 출력 (console.log)
 * - warn  - 항상 출력 (console.warn)
 * - error - 항상 출력 (console.error)
 */

/**
 * 카테고리 접두사가 포함된 경량 로거 인스턴스를 생성합니다.
 * @param category - 로그 메시지에 표시할 카테고리명 (예: 'RequestQueue')
 * @returns debug, info, warn, error 메서드를 가진 로거 객체
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
