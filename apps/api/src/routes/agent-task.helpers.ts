/**
 * Agent Task 라우트 공용 헬퍼 — agent-task.routes.ts 에서 분리 (600줄 CI 가드).
 *
 * @module routes/agent-task.helpers
 */
import { Request, Response } from 'express';
import { notFound } from '../utils/api-response';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { LOCAL_BRIDGE } from '../config/local-bridge';
import { getLocalBridgeRegistry } from '../services/local-bridge/registry';
import type { AgentTaskInputFile } from '../services/AgentTaskService';

/**
 * executor='local' 작업 생성 전 검증 — 기능 게이트/디바이스 연결/폴더 선택(102).
 * folderRel 은 deviceId 지정 시에만 유효하며, 디바이스가 folders 열거로 스스로 보고한
 * 값만 통과(세션 캐시 검증) — 웹발 임의 경로가 디바이스로 내려가지 않는 불변식.
 * 문제 시 사용자 메시지 반환, 정상이면 null.
 */
export function validateLocalExecutorInput(userId: string, deviceId?: string, folderRel?: string): string | null {
    if (!LOCAL_BRIDGE.ENABLED) return '로컬 실행 기능이 비활성화되어 있습니다 (LOCAL_EXECUTOR_ENABLED)';
    if (!getLocalBridgeRegistry().getDevice(userId, deviceId)) {
        return deviceId
            ? `지정한 디바이스(${deviceId.slice(0, 12)}…)가 연결되어 있지 않습니다 — 디바이스에서 폴더를 다시 연결하세요`
            : '연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 먼저 연결하세요';
    }
    if (folderRel) {
        if (!deviceId) return 'folderRel 은 deviceId 와 함께 지정해야 합니다';
        if (!getLocalBridgeRegistry().isEnumeratedFolder(userId, deviceId, folderRel)) {
            return '디바이스가 보고하지 않은 폴더입니다 — 폴더 목록을 다시 조회한 뒤 선택하세요';
        }
    }
    return null;
}

/** 소유권 검증 후 작업 반환 — 없거나 권한 없으면 응답 종료하고 undefined 반환 */
export async function loadOwnedTask(req: Request, res: Response, taskId: string) {
    const db = getUnifiedDatabase();
    const task = await db.getAgentTask(taskId);
    if (!task) {
        res.status(404).json(notFound('작업을 찾을 수 없습니다.'));
        return undefined;
    }
    assertResourceOwnerOrAdmin(String(task.user_id), String(req.user!.id), req.user!.role || 'user');
    return task;
}

/** 응답용 변환: 큰 checkpoint/input_files/input_images 본문 제거 + resumable 플래그(중단된 작업에 체크포인트 존재).
 *  input_files 는 내용(content/data)을 뺀 메타(name/type/size)만 노출 — 목록/상세 응답 팽창 방지. */
/**
 * 목록 필터 — CLI `openmake-code tasks` 가 "이 디바이스의 로컬 작업"만 보게 하려고 둔 부가 필터.
 * 본인(또는 admin viewAll) 범위 안에서만 거르므로 권한 변화가 없다. 값이 없으면 통과.
 * PURE: 라우트 밖에서 단위테스트 대상.
 */
export function filterTaskList<T extends { executor?: string | null; device_id?: string | null; status?: string }>(
    tasks: T[],
    q: { executor?: unknown; deviceId?: unknown; status?: unknown },
): T[] {
    const executor = typeof q.executor === 'string' && q.executor ? q.executor : null;
    const deviceId = typeof q.deviceId === 'string' && q.deviceId ? q.deviceId : null;
    // status 는 콤마 목록 허용 (예: failed,cancelled)
    const statuses = typeof q.status === 'string' && q.status
        ? new Set(q.status.split(',').map(s => s.trim()).filter(Boolean))
        : null;
    return tasks.filter(t =>
        (!executor || t.executor === executor) &&
        (!deviceId || t.device_id === deviceId) &&
        (!statuses || (t.status !== undefined && statuses.has(t.status))),
    );
}

export function toPublicTask(t: Record<string, unknown>) {
    const { checkpoint, input_files, input_images, ...rest } = t;
    void input_images; // dataURL 배열 — 응답에서 제외(팽창 방지)
    const fileMetas = Array.isArray(input_files)
        ? (input_files as AgentTaskInputFile[]).map((f) => ({ name: f?.name, type: f?.type, size: f?.size }))
        : undefined;
    return { ...rest, ...(fileMetas ? { input_files: fileMetas } : {}), resumable: !!checkpoint && t.status === 'failed' };
}

/**
 * 로컬 실행 작업 생성 감사 — 사용자 머신에서 도구가 실행되는 보안 관련 행위라 어느
 * 디바이스·폴더로 위임됐는지 이력을 남긴다 (축1 plan 6단계. CRITICAL_ACTIONS 미등록 =
 * 알림 없음·기록만). fire-and-forget — 실패는 생성 결과에 영향 없음.
 */
export async function auditLocalTaskCreate(
    userId: string, taskId: string, deviceId?: string, folderRel?: string,
): Promise<void> {
    try {
        const { getAuditService } = await import('../services/AuditService');
        await getAuditService().logAudit({
            action: 'agent_task_local_create',
            userId,
            resourceType: 'agent_task',
            resourceId: taskId,
            details: { deviceId, folderRel: folderRel ?? null },
        });
    } catch { /* 감사 실패가 작업 생성을 되돌리지 않는다 */ }
}
