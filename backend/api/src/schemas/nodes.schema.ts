/**
 * ============================================================
 * Nodes Schema - 클러스터 노드 Zod 검증 스키마
 * ============================================================
 *
 * 클러스터 노드 추가 요청의 유효성을 검증하는 Zod 스키마와
 * 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/nodes.schema
 */
import { z } from 'zod';

/**
 * 클러스터 노드 추가 스키마
 * @property {string} host - 노드 호스트 주소 (필수, 1~253자)
 * @property {number} port - 노드 포트 번호 (필수, 1~65535)
 * @property {string} [name] - 노드 식별 이름 (선택)
 */
export const addClusterNodeSchema = z.object({
    host: z.string().min(1, 'host는 필수입니다').max(253),
    port: z.number().int('port는 정수여야 합니다').min(1).max(65535),
    name: z.string().max(100).optional()
});

/** 클러스터 노드 추가 요청 TypeScript 타입 */
export type AddClusterNodeInput = z.infer<typeof addClusterNodeSchema>;
