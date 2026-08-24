/**
 * ExtensionIngestService 의 공개 타입 — 서비스와 구성요소 설치 모듈이 공유한다.
 * (extension-components.ts 가 서비스를 import 하면 순환이 되므로 타입만 분리)
 *
 * @module agents/git-ingest/extension-ingest-types
 */
import type { ImportExtensionFromGitInput } from '../../schemas/extension-ingest.schema';
import type { ManifestCandidate } from './repo-scanner';
import type { ConventionFinding } from './convention-checker';

export interface ImportInput extends ImportExtensionFromGitInput {
    userId: string;
    isAdmin: boolean;
}

export interface SkillInstallResult {
    path: string;
    skillId?: string;
    name?: string;
    deduped?: boolean;
    /** 설치 시 적응(호환 변환) 요약 — skill-compat */
    compatNotes?: string[];
    /** commands/<name>.md 를 스킬로 변환한 경우 */
    fromCommand?: boolean;
    /** 함께 저장된 번들 파일 (scripts/·references/·assets/) 상대 경로 */
    assets?: string[];
    error?: string;
}

export interface AgentInstallResult {
    /** agents/<name>.md 경로 */
    path: string;
    /** 원문 name (충돌 회피 전) */
    name: string;
    agentId?: string;
    /** 실제 저장된 이름 (충돌 시 prefix/suffix 적용) */
    storedName?: string;
    /** 이 환경이 적용하지 않는 원문 필드 안내 */
    ignoredFields?: string[];
    error?: string;
}

export interface McpServerInstallResult {
    name: string;
    serverId?: string;
    transportType?: 'stdio' | 'streamable-http';
    blockedByConvention?: boolean;
    conventionFindings?: ConventionFinding[];
    error?: string;
}

export interface ImportResult {
    extensionId: string;
    name: string;
    version: string;
    description: string;
    status: 'active';
    source: 'git-url';
    gitUrl: string;
    gitRef: string;
    gitPath: string;
    skills: SkillInstallResult[];
    mcpServers: McpServerInstallResult[];
    /** agents/*.md → Custom Agent (Phase 2) */
    agents: AgentInstallResult[];
    validationWarnings: string[];
    deduped: boolean;
    /** 동일 소스 재설치인데 source_ref 가 이미 최신 — 아무것도 변경 안 함 */
    upToDate?: boolean;
    /** 동일 이름·동일 소스 재설치 → 기존 설치를 새 ref 로 교체 (구 구성요소 archive) */
    updated?: boolean;
    previousVersion?: string;
    selectionRequired?: false;
    candidates?: never;
}

export interface UpdateCheckResult {
    updateAvailable: boolean;
    currentRef: string;
    latestRef: string;
    /** 최신 ref 의 plugin.json version (조회 실패 시 null) */
    latestVersion: string | null;
}

export interface CandidateListResult {
    gitUrl: string;
    gitRef: string;
    candidates: ManifestCandidate[];
    totalCandidates: number;
    selectionRequired: true;
    /** marketplace.json 인덱스 발견 시 — plugin 인자로 이름을 지정해 재호출 */
    marketplace?: {
        name: string;
        plugins: Array<{ name: string; description?: string }>;
    };
}

