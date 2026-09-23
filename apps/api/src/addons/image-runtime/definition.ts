/**
 * image-runtime — capability 정의 (Base·Add-on 통합 P04, 2026-09-23).
 * ID·라벨·인자 키·상한은 종전 Base 정의와 같다(전환 전후 Planner·설정 화면이 같은 것을 본다, T07).
 *
 * @module addons/image-runtime/definition
 */
import { CAPABILITY_LIMITS } from '../../config/capabilities';
import type { CapabilityDefinition } from '../../capability-contract/types';

const settings = (keys: readonly string[]) => ({
    type: 'object',
    properties: Object.fromEntries(keys.map(k => [k, { type: 'string', maxLength: CAPABILITY_LIMITS.PARAM_VALUE_MAX_CHARS }])),
});

export const IMAGE_GENERATE_DEFINITION: CapabilityDefinition = {
    id: 'image.generate',
    contractVersion: 1,
    assignable: true,
    plannable: true,
    display: { label: '이미지 생성', group: 'image', order: 26 },
    plannerHint: '새 이미지를 그려/만들어 달라고 할 때',
    inputSchema: { type: 'object', properties: { size: { type: 'string' }, quality: { type: 'string' }, style: { type: 'string' } } },
    settingsSchema: settings(['size', 'quality', 'style']),
    execution: { mode: 'sync', timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, supportsCancellation: true },
    output: { mimeTypes: ['image/png'] },
};

export const IMAGE_EDIT_DEFINITION: CapabilityDefinition = {
    id: 'image.edit',
    contractVersion: 1,
    assignable: true,
    plannable: true,
    display: { label: '이미지 편집', group: 'image', order: 27 },
    plannerHint: '기존 이미지(첨부 또는 직전 생성)를 수정·변형해 달라고 할 때 — refs 로 원본 지정',
    inputSchema: { type: 'object', properties: { size: { type: 'string' } } },
    settingsSchema: settings(['size']),
    execution: { mode: 'sync', timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, supportsCancellation: true },
    output: { mimeTypes: ['image/png'] },
};
