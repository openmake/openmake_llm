/**
 * music-runtime — capability 정의 (Base·Add-on 통합 P06, 2026-09-23). ID·라벨·인자 키·상한은 종전 Base 정의와 같다.
 * @module addons/music-runtime/definition
 */
import { CAPABILITY_LIMITS, PLAN_CONVERSATION_TEXT_MARKER } from '../../config/capabilities';
import type { CapabilityDefinition } from '../../capability-contract/types';

export const MUSIC_GENERATE_DEFINITION: CapabilityDefinition = {
    id: 'music.generate',
    contractVersion: 1,
    assignable: true,
    plannable: true,
    display: { label: '음악 생성', group: 'music', order: 52 },
    plannerHint: `노래·배경음악을 만들어 달라고 할 때 (가사는 input.lyrics — 대화에 이미 있는 가사는 옮겨 적지 말고 "${PLAN_CONVERSATION_TEXT_MARKER}", 길이는 input.duration)`,
    inputSchema: { type: 'object', properties: { duration: { type: 'string', description: 'seconds' }, lyrics: { type: 'string' } } },
    settingsSchema: { type: 'object', properties: { duration: { type: 'string', maxLength: CAPABILITY_LIMITS.PARAM_VALUE_MAX_CHARS } } },
    execution: { mode: 'sync', timeoutMs: CAPABILITY_LIMITS.MUSIC_WAIT_MS, supportsCancellation: true },
    output: { mimeTypes: ['audio/mpeg'] },
};
