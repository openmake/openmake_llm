/**
 * Knowledge 원본 파일 저장 — 비공개 디렉터리에만 둔다(공개 정적 루트 금지). DB 에는 상대 `storage_ref`(= versionId) 만 남는다.
 * 저장 규약은 앱의 다른 비공개 업로드(agent-task: `<cwd>/data/…`)를 따른다.
 *
 * storage_ref 는 저장소 내부 상대 키다 — 경로 탈출을 막기 위해 항상 basename 만 취한다(versionId 는 전역 유니크 uuid).
 * 수집 파이프라인/worker 는 `readStoredFile`·`deleteStoredFile` 로 이 원본을 읽고 정리한다.
 *
 * @module addons/knowledge-runtime/documents/storage
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { KNOWLEDGE_RUNTIME } from '../constants';

/** 원본 저장 루트(절대 경로) — env 미설정 시 <cwd>/data/knowledge-storage. */
function storageRoot(): string {
    return resolve(KNOWLEDGE_RUNTIME.STORAGE_DIR || join(process.cwd(), 'data', 'knowledge-storage'));
}

/** storage_ref → 저장소 루트 안의 안전한 절대 경로. basename 만 취해 경로 탈출을 막는다. */
export function resolveStoredPath(storageRef: string): string {
    return join(storageRoot(), basename(storageRef));
}

/** sha256(원본 바이트) — 파일명이 아니라 내용으로 중복을 판정한다. */
export function contentHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 원본을 저장하고 storage_ref(= versionId)를 돌려준다. versionId 는 서버 생성 uuid 만 온다(경로 주입 불가).
 * 업로드 서비스가 versionId 를 먼저 정하고, 그 값으로 저장 경로와 버전 행을 일치시킨다.
 */
export async function storeOriginal(_spaceId: string, versionId: string, buffer: Buffer): Promise<string> {
    await mkdir(storageRoot(), { recursive: true });
    await writeFile(resolveStoredPath(versionId), buffer, { flag: 'wx' });
    return versionId;
}

/** 원본 파일 읽기(수집 파이프라인). */
export async function readStoredFile(storageRef: string): Promise<Buffer> {
    return readFile(resolveStoredPath(storageRef));
}

/** 원본 파일 삭제(cleanup) — 없으면 무시. */
export async function deleteStoredFile(storageRef: string): Promise<void> {
    await rm(resolveStoredPath(storageRef), { force: true }).catch(() => undefined);
}
