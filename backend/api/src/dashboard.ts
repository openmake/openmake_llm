/**
 * ============================================================
 * Dashboard Module - 대시보드 서버 팩토리
 * ============================================================
 *
 * DashboardServer 인스턴스를 생성하는 팩토리 함수를 제공합니다.
 * server.ts의 DashboardServer를 래핑하여 간편한 초기화 인터페이스를 노출합니다.
 *
 * @module dashboard
 * @description
 * - createDashboardServer() - 옵션 기반 대시보드 서버 생성
 * - DashboardServer re-export
 *
 * @requires server - DashboardServer 클래스
 */

import { DashboardServer } from './server';

/**
 * 대시보드 서버 생성 옵션
 * @property port - 대시보드 서버 포트 (선택, 기본값은 DashboardServer 내부 설정)
 */
interface DashboardOptions {
    port?: number;
}

/**
 * 대시보드 서버 인스턴스를 생성합니다.
 * @param options - 대시보드 서버 옵션 (포트 등)
 * @returns DashboardServer 인스턴스
 */
export function createDashboardServer(options?: DashboardOptions): DashboardServer {
    return new DashboardServer(options);
}

export { DashboardServer };
