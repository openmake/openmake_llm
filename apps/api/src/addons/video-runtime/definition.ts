/**
 * video-runtime — capability 정의 (Base·Add-on 통합 P08, 2026-09-23). ID·라벨·인자 키는 종전 Base 정의와 같다(T07).
 * @module addons/video-runtime/definition
 */
import { CAPABILITY_LIMITS } from '../../config/capabilities';
import type { CapabilityDefinition } from '../../capability-contract/types';

export const VIDEO_GENERATE_DEFINITION: CapabilityDefinition = {
    id: 'video.generate',
    contractVersion: 1,
    assignable: true,
    plannable: true,
    display: { label: '영상 생성', group: 'video', order: 63 },
    plannerHint: '짧은 영상을 만들어 달라고 할 때',
    inputSchema: { type: 'object', properties: { seconds: { type: 'string' }, size: { type: 'string' }, negative_prompt: { type: 'string' } } },
    settingsSchema: {
        type: 'object',
        properties: {
            size: { type: 'string', maxLength: CAPABILITY_LIMITS.PARAM_VALUE_MAX_CHARS },
            seconds: { type: 'string', maxLength: CAPABILITY_LIMITS.PARAM_VALUE_MAX_CHARS },
        },
    },
    execution: { mode: 'job', timeoutMs: CAPABILITY_LIMITS.VIDEO_WAIT_MS, supportsCancellation: false },
    output: { mimeTypes: ['video/mp4', 'video/webm'] },
};
