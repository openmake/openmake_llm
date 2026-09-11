/**
 * @module services/orchestrator/executors
 * @description capability → executor 레지스트리. 검증된 어댑터가 없는 capability(UNSUPPORTED_CAPABILITIES)는
 * 배정과 무관하게 `unsupported` 로 명시 실패한다(미배정 `unassigned` 와 구분 — 둘 다 종합 답변에 사유로 실린다).
 */
import { UNSUPPORTED_CAPABILITIES, type Capability } from '../../../config/capabilities';
import type { CapabilityExecutor } from '../types';
import { textExecutor } from './text';
import { visionExecutor } from './vision';
import { imageGenerateExecutor, imageEditExecutor } from './image';
import { audioTranscribeExecutor, audioSpeechExecutor } from './audio';
import { videoGenerateExecutor } from './video';
import { webSearchExecutor } from './web';

export class UnsupportedCapabilityError extends Error {
    constructor(public readonly capability: Capability) {
        super(`${capability}: 검증된 provider 어댑터가 아직 없습니다 (unsupported)`);
    }
}

const REGISTRY: Partial<Record<Capability, CapabilityExecutor>> = {
    'text.reason': textExecutor,
    'text.code': textExecutor,
    'vision.describe': visionExecutor,
    'vision.ocr': visionExecutor,
    'image.generate': imageGenerateExecutor,
    'image.edit': imageEditExecutor,
    'audio.transcribe': audioTranscribeExecutor,
    'audio.speech': audioSpeechExecutor,
    'video.generate': videoGenerateExecutor,
    'web.search': webSearchExecutor,
};

export function executorFor(capability: Capability): CapabilityExecutor {
    if (UNSUPPORTED_CAPABILITIES.has(capability)) return async () => { throw new UnsupportedCapabilityError(capability); };
    const ex = REGISTRY[capability];
    if (!ex) return async () => { throw new UnsupportedCapabilityError(capability); };
    return ex;
}
