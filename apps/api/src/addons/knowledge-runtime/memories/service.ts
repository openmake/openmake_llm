/**
 * Space 메모리 서비스 — 읽기는 Space 읽기 인가, 쓰기는 Space 쓰기 인가(scope 정책). 라우트는 이 함수만 부른다.
 * 항목 수·항목당 문자 수 상한은 knowledge_profiles.limits 데이터(폴백 config/injection.ts).
 *
 * @module addons/knowledge-runtime/memories/service
 */
import type { KnowledgeSpaceMemory } from '@openmake/shared-types';
import { AppError } from '../../../utils/error-handler';
import { actorFor } from '../config/scope-policy';
import { getDefaultLimits } from '../config/profiles';
import { resolveInjectionLimits } from '../config/injection';
import { getSpaceScopeRow } from '../spaces/repository';
import * as repo from './repository';

function toMemory(row: repo.MemoryRow): KnowledgeSpaceMemory {
    return { id: row.id, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** Space 읽기 인가를 확인한다(없으면 404 — 존재 누출 금지). */
async function assertSpaceAccess(userId: string, spaceId: string, mode: 'read' | 'write'): Promise<void> {
    const actor = await actorFor(userId);
    const space = await getSpaceScopeRow(actor, spaceId, mode);
    if (!space) throw new AppError('프로젝트', 404, true, 'NOT_FOUND');
}

export async function listMemories(userId: string, spaceId: string): Promise<KnowledgeSpaceMemory[]> {
    await assertSpaceAccess(userId, spaceId, 'read');
    const rows = await repo.listMemoryRows(spaceId);
    return rows.map(toMemory);
}

/** 항목당 문자 수 상한(정책) 검사 — 하드 캡(zod)과 별개로 프로필 값으로 다시 본다. */
async function assertWithinCharLimit(content: string): Promise<void> {
    const limits = resolveInjectionLimits(await getDefaultLimits());
    if (content.length > limits.maxMemoryCharsPerItem) {
        throw new AppError(`메모리 1건 길이 상한(${limits.maxMemoryCharsPerItem}자)을 초과했습니다`, 400, true, 'VALIDATION_ERROR');
    }
}

export async function addMemory(userId: string, spaceId: string, content: string): Promise<KnowledgeSpaceMemory> {
    await assertSpaceAccess(userId, spaceId, 'write');
    await assertWithinCharLimit(content);
    const limits = resolveInjectionLimits(await getDefaultLimits());
    const existing = await repo.countActiveMemories(spaceId);
    if (existing >= limits.maxMemoryItems) {
        throw new AppError(`메모리 항목 수 상한(${limits.maxMemoryItems})을 초과했습니다`, 409, true, 'MEMORY_LIMIT_EXCEEDED');
    }
    const row = await repo.insertMemory(spaceId, content, userId);
    return toMemory(row);
}

export async function updateMemory(userId: string, spaceId: string, memId: string, content: string): Promise<KnowledgeSpaceMemory> {
    await assertSpaceAccess(userId, spaceId, 'write');
    await assertWithinCharLimit(content);
    const row = await repo.updateMemoryContent(spaceId, memId, content);
    if (!row) throw new AppError('메모리', 404, true, 'NOT_FOUND');
    return toMemory(row);
}

export async function deleteMemory(userId: string, spaceId: string, memId: string): Promise<void> {
    await assertSpaceAccess(userId, spaceId, 'write');
    const ok = await repo.softDeleteMemory(spaceId, memId);
    if (!ok) throw new AppError('메모리', 404, true, 'NOT_FOUND');
}
