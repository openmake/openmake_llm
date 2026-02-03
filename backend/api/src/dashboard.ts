/**
 * Dashboard Module
 * DashboardServer를 server.ts에서 re-export
 */

import { DashboardServer } from './server';

interface DashboardOptions {
    port?: number;
}

export function createDashboardServer(options?: DashboardOptions): DashboardServer {
    return new DashboardServer(options);
}

export { DashboardServer };
