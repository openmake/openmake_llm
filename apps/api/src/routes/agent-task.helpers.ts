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
export function toPublicTask(t: Record<string, unknown>) {
    const { checkpoint, input_files, input_images, ...rest } = t;
    void input_images; // dataURL 배열 — 응답에서 제외(팽창 방지)
    const fileMetas = Array.isArray(input_files)
        ? (input_files as AgentTaskInputFile[]).map((f) => ({ name: f?.name, type: f?.type, size: f?.size }))
        : undefined;
    return { ...rest, ...(fileMetas ? { input_files: fileMetas } : {}), resumable: !!checkpoint && t.status === 'failed' };
}
