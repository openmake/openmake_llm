/**
 * 마켓플레이스 게시(발행형 (b)) 설정 — L2 config.
 *
 * 사용자가 만든 스킬·Custom Agent·MCP 설정을 플러그인 번들로 묶어 **이 배포 안**(DB + 갤러리)에
 * 게시한다. GitHub 로는 나가지 않는다(2026-08-25 사용자 결정: openmake_llm 에만 설치).
 *
 * @module config/marketplace-publish
 */


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

