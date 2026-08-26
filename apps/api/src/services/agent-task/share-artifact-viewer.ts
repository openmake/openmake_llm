/**
 * 공유된 작업의 산출물 뷰어 — 격리 오리진(artifacts.openmake.cc)에 정적 페이지로 export.
 *
 * 왜 채팅 아티팩트 게시(`artifact_publications`)를 재사용하지 않는가:
 *   작업 아티팩트는 `agent_task_steps(step_type='artifact')` JSON 으로만 남고 `artifacts`
 *   테이블에 들어가지 않는다(운영 실측 27개 id → 매칭 0건). 두 테이블 모두 `session_id` 가
 *   `conversation_sessions` 를 FK 로 걸고 있어 작업에는 붙일 세션이 없다(`agent_tasks` 에
 *   session 컬럼 자체가 없다). 합성 세션 행을 만드는 방법은 세션 정리(오래된 세션 prune)가
 *   CASCADE 로 게시본을 지워버려 위험하다.
 *
 * 그래서 **공유의 일부로** 다룬다: pubId 를 shareId 에서 유도하고, 인가는 공유 자체의
 * 규칙(link 토큰·로그인·소유자)으로 판정한 뒤 서명 접근토큰을 발급한다. 공유 해제 시
 * export 를 지우므로 토큰이 남아 있어도 404 다.
 *
 * HTML·SVG 산출물이 이 경로의 핵심이다 — 공유 문서 본문에는 담지 않고(텍스트만 렌더),
 * 격리 오리진에서만 실행시킨다. 그 격리가 아티팩트 뷰어를 별도 오리진에 둔 이유다.
 *
 * @module services/agent-task/share-artifact-viewer
 */
import { ARTIFACT_VIEWER } from '../../config/artifact-viewer';
import { exportPublication, removePublication, resolveAuthorLabel } from '../artifact-viewer-service';
import type { ShareArtifact } from './share-document';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ShareArtifactViewer');

/** pubId 접두사 — viewer-authz 가 이 접두사로 "작업 공유 산출물" 분기를 판정한다. */
export const SHARE_VIEWER_PREFIX = 'share-';

/**
 * 산출물 뷰어 pubId. nginx 의 `^/a/[A-Za-z0-9-]+/` 를 만족해야 하므로 하이픈만 쓴다
 * (shareId 는 UUID). index 는 스냅샷 배열 순서 — 재게시해도 같은 순서면 같은 URL 이다.
 */
export function shareViewerPubId(shareId: string, index: number): string {
    return `${SHARE_VIEWER_PREFIX}${shareId}-${index}`;
}

/** pubId → shareId. 형식이 아니면 null(= 이 경로 소관이 아님). */
export function parseShareViewerPubId(pubId: string): { shareId: string; index: number } | null {
    if (!pubId.startsWith(SHARE_VIEWER_PREFIX)) return null;
    const rest = pubId.slice(SHARE_VIEWER_PREFIX.length);
    const cut = rest.lastIndexOf('-');
    if (cut <= 0) return null;
    const index = Number(rest.slice(cut + 1));
    if (!Number.isInteger(index) || index < 0) return null;
    return { shareId: rest.slice(0, cut), index };
}

/**
 * 게시(재게시 포함) — 산출물마다 정적 뷰어를 export 하고 스냅샷에 `viewerId` 를 심는다.
 * 뷰어가 꺼져 있으면 아무것도 하지 않는다(URL 없음 → 웹은 본문만 보여준다).
 * export 실패는 공유 자체를 죽이지 않는다(fail-open — 산출물 열람만 빠진다).
 */
export async function exportShareArtifactViewers(
    shareId: string,
    ownerUserId: string,
    artifacts: ShareArtifact[],
    /** `extractArtifactViewerContents` 결과 — artifacts 와 인덱스 정렬 */
    contents: (string | null)[],
): Promise<void> {
    if (!ARTIFACT_VIEWER.enabled || artifacts.length === 0) return;
    const author = await resolveAuthorLabel(ownerUserId);
    for (const [i, a] of artifacts.entries()) {
        // 본문이 없으면 보여줄 것이 없다(파싱 실패 등) — viewerId 도 심지 않는다.
        const content = contents[i];
        if (!content) continue;
        const pubId = shareViewerPubId(shareId, i);
        try {
            await exportPublication({
                pubId,
                kind: a.kind,
                lang: null,
                content,
                title: a.title,
                icon: null,
                author,
                version: 1,
            });
            a.viewerId = pubId;
        } catch (e) {
            logger.warn(`산출물 뷰어 export 실패: ${pubId} — ${e}`);
        }
    }
}

/** 해제·재게시 전 정리 — 남겨두면 해제 후에도 옛 산출물이 열린다. */
export async function removeShareArtifactViewers(shareId: string, count: number): Promise<void> {
    if (!ARTIFACT_VIEWER.enabled) return;
    for (let i = 0; i < count; i++) {
        try {
            await removePublication(shareViewerPubId(shareId, i));
        } catch (e) {
            logger.warn(`산출물 뷰어 제거 실패: ${shareViewerPubId(shareId, i)} — ${e}`);
        }
    }
}
