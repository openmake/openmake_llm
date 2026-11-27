/**
 * 공유(갤러리) 확장을 한 사용자 계정으로 설치 — 갤러리 설치 라우트와 조직 배포 모드 조정(§8-1)이 같은 입력을 쓴다.
 *
 * 설치자 본인 계정으로 같은 소스 ingest 를 다시 돌린다 — 구성요소(스킬·MCP 서버)는 본인 소유 draft 로 생기고 각자 승인한다
 * (권한 상승·승인 우회 없음). 원본 정책(M2)·설치 상한·dedupe 는 ingest 가 그대로 적용한다.
 *
 * @module services/extensions/shared-install
 */
import type { UserExtensionRow } from '../../data/repositories/user-extension-repository';
import { buildExtensionIngestService } from './ingest-service-factory';

export async function installSharedExtension(
    shared: UserExtensionRow,
    userId: string,
    opts: { isAdmin: boolean; accessToken?: string },
) {
    const service = await buildExtensionIngestService({ userId, isAdmin: opts.isAdmin });
    return service.import({
        userId,
        isAdmin: false,
        gitUrl: shared.source_url,
        gitRef: shared.tracking_ref ?? undefined,
        gitPath: shared.source_path,
        // 합성 매니페스트 설치본(plugin.json 없는 마켓 엔트리)의 이름 — 가상 source_path 재설치 시 사용
        plugin: shared.name,
        accessToken: opts.accessToken,
    });
}
