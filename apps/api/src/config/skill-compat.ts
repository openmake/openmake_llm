/**
 * 외부 생태계(Claude Code / Gemini CLI / Qwen Code) 자산을 openmake_llm 환경에
 * 맞추는 **설치 시 적응(adaptation)** 설정.
 *
 * 배경: 공개된 스킬·플러그인은 Claude Code 기준으로 작성돼 있어 도구 이름
 * (Read/Write/Bash/WebFetch...), 인자 자리표시자(`$ARGUMENTS`), 파일 참조(`@file`),
 * 구성요소(commands/agents/hooks)가 이 환경과 다르다. ingest 는 원문을 그대로
 * 저장하므로 모델이 없는 도구를 호출하려 하거나 자리표시자를 그대로 출력한다.
 *
 * 이 파일은 **결정적 매핑 테이블만** 보유한다 (LLM 재작성 없음 — 판단 경계 A형 금지).
 * 실제 변환은 agents/git-ingest/skill-compat.ts (순수 함수).
 *
 * @module config/skill-compat
 */

/** 기능 게이트 — off 면 ingest 가 원문을 그대로 저장한다 (구 동작). */
export const SKILL_COMPAT = {
    enabled: process.env.SKILL_COMPAT_ADAPT_ENABLED !== 'false',
    /** 호환 안내 노트 최대 길이 (본문 앞 prepend) */
    noteMaxChars: parseInt(process.env.SKILL_COMPAT_NOTE_MAX_CHARS || '1200', 10),
} as const;

/**
 * Claude Code 도구 이름 → openmake_llm 등가 도구.
 *
 * 값이 null 이면 이 환경에 대응 도구가 없음(안내에 "대응 없음"으로 표기).
 * 채팅 도구(web_*, generate_image...)와 에이전트 작업 샌드박스 도구(bash,
 * file_ops...)가 섞여 있다 — 스킬은 두 경로 모두에서 주입될 수 있다.
 */
export const CLAUDE_TOOL_ALIASES: Readonly<Record<string, string | null>> = {
    // 파일 I/O — 에이전트 작업 샌드박스
    Read: 'file_ops',
    Write: 'file_ops',
    Edit: 'str_replace_editor',
    MultiEdit: 'str_replace_editor',
    NotebookEdit: null,
    NotebookRead: null,
    // 셸 / 검색
    Bash: 'bash',
    BashOutput: 'bash',
    KillShell: 'bash',
    KillBash: 'bash',
    Glob: 'bash',
    Grep: 'bash',
    LS: 'bash',
    // 웹
    WebFetch: 'web_scrape',
    WebSearch: 'web_search',
    // 오케스트레이션
    Task: 'delegate',
    Agent: 'delegate',
    TodoWrite: 'plan_update',
    ExitPlanMode: 'plan_create',
    EnterPlanMode: 'plan_create',
    AskUserQuestion: 'ask_human',
    // MCP 메타
    ListMcpResourcesTool: 'mcp_list_tools',
    ReadMcpResourceTool: 'mcp_call',
    // 대응 없음
    SlashCommand: null,
    Artifact: null,
    Skill: 'load_skill',
    Monitor: null,
} as const;

/**
 * SKILL.md frontmatter 중 이 프로젝트 스키마가 인식하지 않는 상용 키.
 * (스키마는 Zod strip 이라 조용히 버려진다 — 무엇이 버려졌는지 기록·안내하기 위한 목록)
 *
 * 값 = 사용자 안내에 쓸 짧은 라벨. 목록에 없는 미지 키도 보존은 되지만 안내엔
 * 이름만 나열된다.
 */
export const KNOWN_FOREIGN_FRONTMATTER_KEYS: Readonly<Record<string, string>> = {
    'allowed-tools': '허용 도구 목록',
    allowed_tools: '허용 도구 목록',
    tools: '허용 도구 목록',
    model: '모델 지정',
    'argument-hint': '인자 힌트',
    'disable-model-invocation': '모델 자동 호출 금지',
    'user-invocable': '사용자 호출 전용',
    license: '라이선스',
    tags: '태그',
    author: '작성자',
    homepage: '홈페이지',
    context: '컨텍스트 모드',
    hooks: '훅',
} as const;

/** frontmatter 에서 허용 도구 목록을 담는 키 (순서대로 첫 번째 매치 사용). */
export const ALLOWED_TOOLS_KEYS: readonly string[] = ['allowed-tools', 'allowed_tools', 'tools'];

/**
 * 확장 번들(plugin.json) 구성요소 중 이 환경이 설치하지 않는 것.
 * key = tree 디렉토리/파일명 또는 매니페스트 키, value = 안내 라벨.
 *
 * ⚠️ Phase 2(2026-08-24)에서 `commands`·`agents` 는 등가물로 **설치**되므로 이 목록에서
 * 빠졌다 (commands → 스킬, agents → Custom Agent). 여기 남은 것만 여전히 미지원이다.
 */
export const UNSUPPORTED_EXTENSION_COMPONENTS: Readonly<Record<string, string>> = {
    hooks: '훅(hooks)',
    lspServers: 'LSP 서버',
    outputStyles: '출력 스타일',
    settings: '설정 오버라이드',
    contextFileName: '컨텍스트 파일 지정',
    excludeTools: '도구 제외 목록',
    statusLine: '상태 표시줄',
} as const;

/**
 * Phase 3 — 본문 재작성 **제안** (LLM 1회, C형 후단 판정). 자동 적용은 없다:
 * 사용자가 승인 화면에서 diff 를 확인하고 명시적으로 적용해야 반영된다.
 */
export const SKILL_REWRITE = {
    enabled: process.env.SKILL_REWRITE_ENABLED !== 'false',
    /** 이보다 긴 본문은 재작성하지 않는다 (출력이 입력만큼 길어야 해 비용·소실 위험이 커짐) */
    maxBodyChars: parseInt(process.env.SKILL_REWRITE_MAX_BODY_CHARS || '24000', 10),
    /** 제안 길이 / 원문 길이 하한 — 미만이면 "요약해버린" 것으로 보고 제안을 버린다 */
    minLengthRatio: Number(process.env.SKILL_REWRITE_MIN_LENGTH_RATIO || '0.7'),
} as const;

/** 확장 번들에서 등가물로 변환·설치하는 구성요소 상한 (스킬/MCP 상한과 별개) */
export const PLUGIN_COMPONENT_LIMITS = {
    /** commands/*.md → 스킬 최대 개수 */
    maxCommands: parseInt(process.env.EXTENSION_INGEST_MAX_COMMANDS || '10', 10),
    /** agents/*.md → Custom Agent 최대 개수 */
    maxAgents: parseInt(process.env.EXTENSION_INGEST_MAX_AGENTS || '10', 10),
    /** 스킬 1개당 번들 파일(scripts/·references/·assets/) 최대 개수 */
    maxAssetsPerSkill: parseInt(process.env.EXTENSION_INGEST_MAX_SKILL_ASSETS || '20', 10),
    /** 번들 파일 1개 최대 바이트 */
    maxAssetBytes: parseInt(process.env.EXTENSION_INGEST_MAX_SKILL_ASSET_BYTES || String(256 * 1024), 10),
    /** 스킬 1개당 번들 파일 합계 최대 바이트 */
    maxAssetTotalBytes: parseInt(process.env.EXTENSION_INGEST_MAX_SKILL_ASSET_TOTAL_BYTES || String(1024 * 1024), 10),
} as const;

/** Custom Agent 로 옮길 때 이 환경이 적용하지 않는 agents/*.md 프론트매터 필드 */
export const UNSUPPORTED_AGENT_FIELDS: Readonly<Record<string, string>> = {
    model: '모델 지정(Model 축이 담당)',
    tools: '도구 화이트리스트',
    color: '표시 색상',
    effort: '추론 강도',
    initialPrompt: '초기 프롬프트',
};

/**
 * 원격 MCP 서버 항목에서 이 환경이 지원하지 않는 필드.
 * (streamable-http 는 URL 만 사용 — 헤더/OAuth 주입 경로가 없다)
 */
export const UNSUPPORTED_MCP_FIELDS: Readonly<Record<string, string>> = {
    oauth: 'OAuth 인증',
    headers: '커스텀 헤더',
    cwd: '작업 디렉토리 지정',
} as const;
