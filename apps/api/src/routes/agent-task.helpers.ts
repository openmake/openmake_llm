/**
 * Agent Task 라우트 공용 헬퍼 — agent-task.routes.ts 에서 분리 (600줄 CI 가드).
 *
 * @module routes/agent-task.helpers
 */
import { Request, Response } from 'express';
import { notFound } from '../utils/api-response';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { getUnifiedDatabase } from '../data/models/unified-database';
import type { AgentTaskInputFile } from '../services/AgentTaskService';

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
