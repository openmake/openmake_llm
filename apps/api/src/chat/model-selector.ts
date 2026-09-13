/**
 * ============================================================
 * Model Selector - 질문 유형 분류와 기본 모델 선택
 * ============================================================
 *
 * 사용자 질문을 9가지 QueryType으로 분류하고 단일 로컬 모델(llmDefaultModel)을 돌려줍니다.
 * 분류는 관측 전용이며 모델·샘플링을 바꾸지 않습니다.
 *
 * @module chat/model-selector
 * @description
 * - 질문 유형 분류: fast-path + 정규식/키워드 분류(query-classifier) — LLM 호출 없음
 * - 모델 기능 확인: checkModelCapability() — 프리셋·부팅 프로브 실측 기반
 *
 * 흐름:
 * 1. detectFastPath() / classifyQuery() - QueryType 분류 + 신뢰도 계산
 * 2. selectOptimalModel() - 분류 결과와 llmDefaultModel 반환
 *
 * @see sockets/ws-chat-handler.ts - selectOptimalModel() 소비
 */

import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { getModelPresets } from '../config/model-presets';
import { matchCapabilityPreset, resolveLocalCapabilities } from '../config/model-defaults';
import { findLocalModel } from '../config/local-models';

const logger = createLogger('ModelSelector');

import type { QueryType, ModelSelection } from './model-selector-types';

import { classifyQuery } from './query-classifier';
// Fast-path: 짧은 인사·단답형 즉시 분기
import { detectFastPath } from './fast-path-detector';


// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형을 분류하고 단일 로컬 모델(llmDefaultModel)로 응답합니다.
 *
 * Phase B Phase 2-A (2026-05-26): LLM classifier 분기 제거 — fast-path + regex
 * 만 사용. LLM round-trip 0회 보장. 2026-08-23: 분류 결과로 샘플링을 튜닝하던
 * options 계산도 제거 — 유일 소비자가 model 만 쓰고 옵션을 버려 죽어 있었고,
 * 분류로 동작을 바꾸는 것은 Phase B 가 되돌린 방향이다. 분류는 관측 전용으로 남는다.
 *
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부 (true면 vision 유형으로 강제 전환)
 * @returns 모델 선택 결과
 */
export async function selectOptimalModel(
    query: string,
    hasImages?: boolean,
): Promise<ModelSelection> {
    const config = getConfig();

    let classifiedType: QueryType;
    let classifiedConfidence: number;
    let classifierSource: 'regex' | 'cache' | 'llm';

    // ── Short-circuit 1: Fast-path (인사·단답형) ──
    const fastPath = detectFastPath(query);
    if (fastPath.matched) {
        classifiedType = 'chat';
        classifiedConfidence = 1.0;
        classifierSource = 'regex';
        logger.info(`Fast-path 매칭(${fastPath.reason}) — queryType=chat`);
    } else {
        // ── Regex 분류 (단일 경로) ──
        const regexResult = classifyQuery(query);
        classifiedType = regexResult.type;
        classifiedConfidence = regexResult.confidence;
        classifierSource = 'regex';
    }

    if (hasImages) {
        classifiedType = 'vision';
    }

    logger.info(`질문 유형: ${classifiedType} (신뢰도: ${(classifiedConfidence * 100).toFixed(0)}%)`);

    const localModel = config.llmDefaultModel;

    return {
        model: localModel,
        reason: `${classifiedType} → ${localModel}`,
        queryType: classifiedType,
        supportsToolCalling: true,
        supportsThinking: true,
        supportsVision: true,
        classifiedConfidence,
        classifierSource,
    };
}

// ============================================================
// 모델 호환성 체크
// ============================================================

/**
 * 모델이 특정 기능을 지원하는지 확인합니다.
 * MODEL_PRESETS에서 모델명을 검색하여 해당 기능 플래그를 반환합니다.
 * 
 * @param modelName - 확인할 모델명
 * @param capability - 확인할 기능 ('toolCalling' | 'thinking' | 'vision' | 'streaming')
 * @returns 해당 기능 지원 여부
 */
export function checkModelCapability(
    modelName: string,
    capability: 'toolCalling' | 'thinking' | 'vision' | 'streaming'
): boolean {
    const lowerModel = modelName.toLowerCase();

    // 1차: 게이팅 경로(local-llm-provider.getCapabilities)와 **동일한 SoT** —
    // env override → 프리셋 → 부팅 프로브 실측. 프리셋 미등록 모델도 여기서 실측이 반영된다.
    const preset = matchCapabilityPreset(lowerModel);
    const probed = findLocalModel(modelName)?.probedCapabilities;
    if (preset || probed) {
        return resolveLocalCapabilities(lowerModel, probed)[capability];
    }

    // 2차: profile fallback (generic 'local-llm' 프리셋) — preset 미등록이나
    // defaultModel 과 관련된 모델명에 대한 포괄 기본값.
    for (const preset of Object.values(getModelPresets())) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) ||
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities[capability];
        }
    }

    // 3차: 알 수 없는 모델은 보수적 기본값 반환
    const defaults: Record<string, boolean> = {
        toolCalling: true,
        thinking: false,
        vision: false,
        streaming: true,
    };
    return defaults[capability] ?? false;
}
