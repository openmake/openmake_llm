/**
 * Legacy Capability Bridge — 기존 실행기를 **그대로** Registry 에 Base 소유로 등록한다 (P02, 2026-09-23).
 *
 * 전환 기간의 유일한 Base 등록 지점이다. 텍스트·비전·오디오·웹·분석 계열은 여기 남고, 미디어 생성(image → P04,
 * music → P06, video → P08)은 각 runtime add-on 으로 옮겨 가며 이 목록에서 빠진다 — 빠진 뒤 그 add-on 이 꺼지면
 * Registry 에 없으므로 Planner·토글·직접 API 세 경로 모두 명시 거절된다(T02·T23).
 * 정의(라벨·힌트·인자 키·상한)는 `config/capabilities.ts` 상수에서 만든다 — 이 PR 에서 그 파일은 줄이지 않는다.
 * 분석 계열(audio·music·video .analyze)은 네이티브 콘텐츠 파트 실행기(media-analyze)로 실행된다(2026-09-25).
 * `UNSUPPORTED_CAPABILITIES` 에 남은 것이 있으면 등록은 하되 실행이 `unsupported` 로 실패한다(등록됨 ≠ 실행기 있음).
 *
 * @module addon-host/legacy-capability-bridge
 */
import {
    CAPABILITIES, ASSIGNABLE_CAPABILITIES, PLANNABLE_CAPABILITIES, UNSUPPORTED_CAPABILITIES,
    CAPABILITY_LABELS_KO, CAPABILITY_PLANNER_HINTS, CAPABILITY_LIMITS, type Capability,
} from '../config/capabilities';
import { BASE_CAPABILITY_OWNER, type CapabilityDefinition, type CapabilityHandler } from '../capability-contract/types';
import { getCapabilityRegistry, registerCapabilities } from '../runtime-ports/capability-runtime';
import type { CapabilityExecutor, ExecContext } from '../services/orchestrator/types';
import { UnsupportedCapabilityError } from '../services/orchestrator/executors/unsupported-error';
import { textExecutor } from '../services/orchestrator/executors/text';
import { visionExecutor } from '../services/orchestrator/executors/vision';
import { audioTranscribeExecutor, audioSpeechExecutor } from '../services/orchestrator/executors/audio';
import { mediaAnalyzeExecutor } from '../services/orchestrator/executors/media-analyze';
import { webSearchExecutor } from '../services/orchestrator/executors/web';

/** 종전 `executors/index.ts` 의 정적 표 그대로 */
const LEGACY_EXECUTORS: Partial<Record<Capability, CapabilityExecutor>> = {
    'text.reason': textExecutor,
    'text.code': textExecutor,
    'vision.describe': visionExecutor,
    'vision.ocr': visionExecutor,
    'audio.transcribe': audioTranscribeExecutor,
    'audio.speech': audioSpeechExecutor,
    'audio.analyze': mediaAnalyzeExecutor,
    'music.analyze': mediaAnalyzeExecutor,
    'video.analyze': mediaAnalyzeExecutor,
    'web.search': webSearchExecutor,
};

/**
 * 계획 `input` 에 실을 수 있는 capability 별 추가 인자 — 종전 `PLAN_JSON_SCHEMA` 에 고정돼 있던 키(seconds·size·negative_prompt·
 * duration·lyrics)를 소유 capability 에 귀속시킨 것. 구조화 출력은 선언 안 된 키를 만들지 않으므로(2026-09-22) 여기 적어야 나온다.
 */
const PLAN_INPUT_KEYS: Partial<Record<Capability, Record<string, { type: 'string'; description?: string }>>> = {
    'image.generate': { size: { type: 'string' }, quality: { type: 'string' }, style: { type: 'string' } },
    'image.edit': { size: { type: 'string' } },
    'video.generate': { seconds: { type: 'string' }, size: { type: 'string' }, negative_prompt: { type: 'string' } },
    'music.generate': { duration: { type: 'string', description: 'seconds' }, lyrics: { type: 'string' } },
    'audio.speech': { voice: { type: 'string' }, format: { type: 'string' } },
};

const TIMEOUTS: Partial<Record<Capability, number>> = {
    'image.generate': CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, 'image.edit': CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS,
    'vision.describe': CAPABILITY_LIMITS.VISION_TIMEOUT_MS, 'vision.ocr': CAPABILITY_LIMITS.VISION_TIMEOUT_MS,
    'audio.speech': CAPABILITY_LIMITS.TTS_TIMEOUT_MS, 'audio.transcribe': CAPABILITY_LIMITS.STT_TIMEOUT_MS,
    'audio.analyze': CAPABILITY_LIMITS.MEDIA_ANALYZE_TIMEOUT_MS, 'music.analyze': CAPABILITY_LIMITS.MEDIA_ANALYZE_TIMEOUT_MS,
    'video.analyze': CAPABILITY_LIMITS.MEDIA_ANALYZE_TIMEOUT_MS,
    'video.generate': CAPABILITY_LIMITS.VIDEO_WAIT_MS, 'music.generate': CAPABILITY_LIMITS.MUSIC_WAIT_MS,
};

const OUTPUT_MIME: Partial<Record<Capability, readonly string[]>> = {
    'image.generate': ['image/png'], 'image.edit': ['image/png'],
    'audio.speech': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac'],
    'video.generate': ['video/mp4', 'video/webm'], 'music.generate': ['audio/mpeg'],
};

const GROUP_ORDER: Record<string, number> = { text: 0, vision: 1, image: 2, audio: 3, music: 4, video: 5, web: 6 };

/** PURE: config 상수 한 벌에서 capability 정의를 만든다 — 웹·Planner·검증이 같은 정의를 본다 */
export function legacyCapabilityDefinition(id: Capability): CapabilityDefinition {
    const group = id.split('.')[0];
    const paramKeys = CAPABILITY_LIMITS.PARAM_KEYS[id] ?? [];
    return {
        id,
        contractVersion: 1,
        assignable: ASSIGNABLE_CAPABILITIES.includes(id),
        plannable: PLANNABLE_CAPABILITIES.includes(id),
        display: { label: CAPABILITY_LABELS_KO[id], group, order: (GROUP_ORDER[group] ?? 9) * 10 + CAPABILITIES.indexOf(id) },
        plannerHint: CAPABILITY_PLANNER_HINTS[id],
        inputSchema: { type: 'object', properties: { ...(PLAN_INPUT_KEYS[id] ?? {}) } },
        settingsSchema: {
            type: 'object',
            properties: Object.fromEntries(paramKeys.map(k => [k, { type: 'string', maxLength: CAPABILITY_LIMITS.PARAM_VALUE_MAX_CHARS }])),
        },
        execution: { mode: id === 'video.generate' ? 'job' : 'sync', timeoutMs: TIMEOUTS[id] ?? CAPABILITY_LIMITS.TEXT_TIMEOUT_MS, supportsCancellation: true },
        output: { mimeTypes: OUTPUT_MIME[id] ?? ['text/plain'] },
    };
}

function legacyHandler(id: Capability): CapabilityHandler {
    const ex = UNSUPPORTED_CAPABILITIES.has(id) ? undefined : LEGACY_EXECUTORS[id];
    // legacy 실행기는 ExecContext(+targets)를 받는다 — executor.ts 가 Base 소유에 한해 targets 를 덧붙인다
    return { execute: ex ? (task, ctx) => ex(task, ctx as unknown as ExecContext) : (async () => { throw new UnsupportedCapabilityError(id); }) };
}

/**
 * Base 가 소유하는 capability — 전환이 끝난 미디어 생성 ID 는 여기서 빠진다(그 소유 add-on 만 등록한다).
 * P04 부터 image.generate·image.edit 은 image-runtime, P06 music.generate 는 music-runtime, P08 video.generate 는 video-runtime
 * 소유다(분석 계열 audio.analyze·music.analyze·video.analyze 는 Base 실행기로 남는다) —
 * 그 add-on 이 꺼지면 Registry 에 없어 세 경로 모두 거절된다.
 */
export const LEGACY_BRIDGE_CAPABILITIES: readonly Capability[] = CAPABILITIES.filter(c => !c.startsWith('image.') && c !== 'music.generate' && c !== 'video.generate');

let bridged = false;

/** 멱등 — 첫 호출에만 등록한다. 호스트 부팅이 add-on 런타임보다 먼저 부르고, 실행 shim 도 안전망으로 부른다 */
export function ensureLegacyCapabilityBridge(): void {
    if (bridged) return;
    const registry = getCapabilityRegistry();
    const missing = LEGACY_BRIDGE_CAPABILITIES.filter(id => !registry.has(id));
    if (missing.length > 0) {
        registerCapabilities(BASE_CAPABILITY_OWNER, missing.map(id => ({ definition: legacyCapabilityDefinition(id), handler: legacyHandler(id) })));
    }
    bridged = true;
}

/** 테스트 정리용 — 다음 `ensure` 가 다시 등록한다(Registry 초기화와 짝) */
export function resetLegacyCapabilityBridgeForTest(): void {
    bridged = false;
}
