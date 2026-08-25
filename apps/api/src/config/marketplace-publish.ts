/**
 * 마켓플레이스 게시(발행형 (b)) 설정 — L2 config.
 *
 * 사용자가 만든 스킬·Custom Agent·MCP 설정을 플러그인 번들(`plugins/<name>/…`)로 묶어
 * `openmake/openmake-marketplace` 에 **PR 로** 올린다. main 직접 push 는 하지 않는다 —
 * 그 레포의 규칙("재검증 후 커밋")과 같은 승인 게이트를 사람이 PR 리뷰로 잡는다.
 *
 * @module config/marketplace-publish
 */
import { getConfig } from './env';

/** 기본 게시 대상 레포 (owner/repo). env MARKETPLACE_REPO 로 오버라이드 */
export const MARKETPLACE_DEFAULT_REPO = 'openmake/openmake-marketplace';

/** 레포 안 경로 규칙 — marketplace.json 의 상대경로 엔트리(`./plugins/<name>`)와 한 쌍 */
export const MARKETPLACE_PATHS = {
    index: '.claude-plugin/marketplace.json',
    pluginsDir: 'plugins',
    branchPrefix: 'publish/',
} as const;

/** 한 번에 묶을 수 있는 구성요소 상한 — PR 리뷰 가능한 크기로 제한 */
export const MARKETPLACE_PUBLISH_LIMITS = {
    maxSkills: 30,
    maxAgents: 20,
    maxMcpServers: 10,
    /** 스킬 번들 파일(scripts/·references/) 개당·합계 상한 */
    maxAssetBytes: 256 * 1024,
    maxTotalBytes: 4 * 1024 * 1024,
    pluginNameMax: 80,
} as const;

/** 게시자 정보 — plugin.json author */
export const MARKETPLACE_AUTHOR = { name: 'OpenMake', url: 'https://github.com/openmake' } as const;

export function resolveMarketplaceRepo(): { owner: string; repo: string } {
    const raw = getConfig().marketplaceRepo || MARKETPLACE_DEFAULT_REPO;
    const [owner, repo] = raw.split('/');
    if (!owner || !repo) throw new Error(`MARKETPLACE_REPO 형식 오류 (owner/repo): ${raw}`);
    return { owner, repo };
}
