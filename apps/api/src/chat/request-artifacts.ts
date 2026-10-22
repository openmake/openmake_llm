/**
 * 채팅 응답 artifact 후처리 — request-handler.ts 에서 분리 (max-lines 가드).
 * - `<artifact>` 블록 추출·영속화 후 본문을 [[artifact:id]] placeholder 로 정리
 * - 실체 없는 유령 placeholder 제거
 *
 * @module chat/request-artifacts
 */
import { getPool } from '../data/models/unified-database';
import { extractAndStripArtifacts, findArtifactPlaceholderIds, stripArtifactPlaceholders } from '../llm/artifact-parser';
import { takeReportSource } from '../services/chat-service/report-block';
import { ArtifactRepository, ArtifactSizeError, type ArtifactKind } from '../data/repositories/artifact-repository';
import { createLogger } from '../utils/logger';
import type { ChatUserContext, ChatResult } from './request-handler-types';

// 로그 모듈명은 분리 전과 같게 둔다(운영 로그 검색 호환).
const log = createLogger('ChatRequestHandler');

export async function persistResponseArtifacts(
    response: string,
    currentSessionId: string,
    userContext: ChatUserContext,
): Promise<{ cleanedResponse: string; extractedArtifacts: NonNullable<ChatResult['artifacts']> }> {
    // 6. Artifacts 후처리 (2026-05-26): 응답에서 `<artifact>...</artifact>` 블록 분리.
    // - artifacts 테이블에 영속화 (같은 id 면 version 자동 증가)
    // - message 본문은 [[artifact:id]] placeholder 로 정리 — 다음 턴 prompt 에 본문 미포함
    // - 추출된 artifact 목록을 result.artifacts 로 노출 → ws-handler 가 WS 이벤트로 발행
    let cleanedResponse = response;
    const extractedArtifacts: ChatResult['artifacts'] = [];
    try {
        const { cleanedContent, artifacts } = extractAndStripArtifacts(response);
        if (artifacts.length > 0) {
            const repo = new ArtifactRepository(getPool());
            for (const a of artifacts) {
                // Harness 결정론 검증 게이트: 깨진 산출물을 비차단으로 surface (저장은 계속).
                if (a.validation && a.validation.checked && !a.validation.valid) {
                    log.warn(`[Artifact] 구문 검증 실패 id=${a.id} kind=${a.kind} lang=${a.lang}: ${a.validation.issues.join('; ')}`);
                }
                try {
                    // 보고서 아티팩트면 reportdata 원본을 함께 영속 — docx 등 구조 기반 export 용.
                    const sourceData = takeReportSource(a.id);
                    const row = await repo.insertArtifact({
                        artifactId: a.id,
                        sessionId: currentSessionId,
                        userId: userContext.authenticatedUserId,
                        kind: a.kind as ArtifactKind,
                        title: a.title,
                        language: a.lang,
                        content: a.content,
                        ...(sourceData ? { sourceData } : {}),
                    });
                    log.info(`[Artifact] saved id=${a.id} v=${row.version} kind=${a.kind} bytes=${a.content.length}`);
                    extractedArtifacts.push({
                        id: row.artifact_id,
                        kind: row.kind,
                        title: row.title,
                        lang: row.language,
                        version: row.version,
                        content: row.content,
                    });
                } catch (e) {
                    if (e instanceof ArtifactSizeError) {
                        log.warn(`[Artifact] 20MB 초과 — id=${a.id} skip`);
                    } else {
                        log.warn(`[Artifact] INSERT 실패 id=${a.id}: ${e instanceof Error ? e.message : e}`);
                    }
                }
            }
            cleanedResponse = cleanedContent;
        }
    } catch (e) {
        log.warn(`[Artifact] 후처리 실패 (continue): ${e instanceof Error ? e.message : e}`);
    }

    // 6.5 유령 placeholder 가드 (2026-07-21): 소형 모델이 히스토리의 [[artifact:id]]
    // 표기를 모방해 실체 없는 placeholder 를 직접 출력하는 경우가 있다 (Discord 경로
    // 실측 — 응답 전체가 placeholder 한 줄, artifacts 미생성). 이번 턴 추출분에도
    // 세션 영속분에도 없는 id 는 본문에서 제거해 클라이언트 원문 노출을 막는다.
    try {
        const extractedIds = new Set(extractedArtifacts.map((a) => a.id));
        const candidateIds = findArtifactPlaceholderIds(cleanedResponse)
            .filter((id) => !extractedIds.has(id));
        if (candidateIds.length > 0) {
            const repo = new ArtifactRepository(getPool());
            const ghostIds: string[] = [];
            for (const id of candidateIds) {
                const versions = await repo.listVersionsByArtifactId(currentSessionId, id);
                if (versions.length === 0) ghostIds.push(id);
            }
            if (ghostIds.length > 0) {
                log.warn(`[Artifact] 유령 placeholder 제거 (모델 모방 출력): ${ghostIds.join(', ')}`);
                cleanedResponse = stripArtifactPlaceholders(cleanedResponse, ghostIds).trim()
                    || '죄송합니다. 요청하신 산출물 생성에 실패했습니다. 다시 한번 요청해 주세요.';
            }
        }
    } catch (e) {
        log.warn(`[Artifact] 유령 placeholder 가드 실패 (continue): ${e instanceof Error ? e.message : e}`);
    }
    return { cleanedResponse, extractedArtifacts };
}
