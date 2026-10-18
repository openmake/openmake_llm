/**
 * 확장 구성요소 저장 계약 — Base 의 확장 플랫폼(설치·업데이트·제거·권한·마켓 게시·팩 카탈로그 설치)이 add-on 소유 테이블
 * (`config/addon-boundary.ts` `ADDON_OWNED_CORE_TABLES`)의 구성요소를 다룰 때 쓰는 연산 (2026-10-18, MCP·스킬 저장 계층 이전).
 *
 * 구현은 각 add-on 의 데이터 모듈(`AddonDataModule.stores`)이고, 데이터 모듈은 꺼진 add-on 도 호스트가 불러온다 — 그래서
 * add-on 을 꺼도 확장 설치·제거가 종전처럼 구성요소 행을 다룬다(동작은 SQL 이 Base 에 있던 때와 같다).
 * 저장 연산은 **호출자가 넘긴 DB 연결에 묶이는 팩토리**다(`stores.skills(db)`) — 풀이든 트랜잭션 클라이언트든 그 연결로
 * 같은 SQL 이 나가므로 트랜잭션 범위·테스트 주입이 종전과 같다. 구성요소 종류 이름(skills·mcpServers)은 확장 번들
 * 매니페스트의 구성요소 어휘다.
 *
 * @module runtime-ports/component-stores
 */
import type { PoolClient } from 'pg';

/** 저장 연산이 쓰는 DB 연결 — 풀 또는 트랜잭션 클라이언트 */
export type StoreDb = Pick<PoolClient, 'query'>;

/** 확장 수명주기 공통 — 설치 뒤 링크·상세·업데이트 전 회수·제거 */
export interface ExtensionLinkedStore {
    link(extensionId: string, ids: readonly string[]): Promise<void>;
    listLinked(extensionId: string): Promise<Array<{ id: string; name: string; status: string; enabled?: boolean }>>;
    /** 묶인 구성요소를 보관(archived)한다 — `unlink` 면 extension_id 도 끊는다(업데이트 전 회수) */
    archiveLinked(extensionId: string, opts: { unlink: boolean }): Promise<void>;
}

export interface ExportSkill {
    id: string;
    name: string;
    description: string | null;
    content: string;
    category: string | null;
    manifest_meta: Record<string, unknown> | null;
}
export interface ExportSkillAsset { skill_id: string; rel_path: string; content_type: string | null; content: Buffer }
export interface ExportMcpServer {
    id: string;
    name: string;
    transport_type: 'stdio' | 'sse' | 'streamable-http';
    command: string | null;
    args: unknown[] | null;
    url: string | null;
    /** env 키 목록만 — 값은 절대 읽지 않는다 */
    env_keys: string[];
}

export interface ImportedSkillDraftInput {
    id: string;
    name: string;
    description: string;
    content: string;
    category: string;
    isPublic: boolean;
    createdBy: string | null;
    manifestMeta: Record<string, unknown>;
    /** skill_manifests 동시 생성(실패해도 스킬은 남는다 — fail-soft) */
    manifest: { version: string; rawYaml: string; checksum: string };
}

export interface ImportedSkillRow {
    id: string;
    name: string;
    description: string;
    category: string;
    content: string;
    manifest_meta: Record<string, unknown>;
}

export interface SkillComponentStore extends ExtensionLinkedStore {
    /** git 설치 중복 — 같은 사용자의 같은 출처 draft 가 창 안에 있으면 그 id */
    findRecentImportDraft(userId: string, promptHash: string, windowHours: number): Promise<string | null>;
    countUserDrafts(userId: string): Promise<number>;
    createImportedDraft(input: ImportedSkillDraftInput): Promise<void>;
    getImportedSkill(skillId: string): Promise<ImportedSkillRow | null>;
    exists(skillId: string): Promise<boolean>;
    /** 에이전트에 배정 — 이미 있으면 그대로 */
    assignToAgent(agentId: string, skillId: string, priority: number): Promise<void>;
    upsertAsset(input: { skillId: string; relPath: string; contentType?: string; content: Buffer }): Promise<void>;
    /** 본문 끝에 덧붙이고 skill_manifests.prompt_md·checksum 도 맞춘다(주입 SoT) */
    appendToContent(skillId: string, block: string): Promise<void>;
    /** 업데이트 전 — 이 확장의 승인된(active) 스킬 이름과 배정 */
    snapshotApproved(extensionId: string): Promise<Array<{ name: string; assignments: Array<{ agentId: string; priority: number }> }>>;
    /** 업데이트 후 — 같은 이름으로 다시 들어온 스킬만 active 로 올리고 배정을 옮긴다. @returns 이어받은 스킬 id */
    carryOverApprovals(
        installed: ReadonlyArray<{ skillId: string; name: string }>,
        snapshot: ReadonlyArray<{ name: string; assignments: ReadonlyArray<{ agentId: string; priority: number }> }>,
    ): Promise<string[]>;
    /** 마켓 게시 후보 — 사용자가 직접 만든 active 스킬(확장 유래 제외) */
    listExportCandidates(userId: string): Promise<Array<Omit<ExportSkill, 'content' | 'manifest_meta'>>>;
    getForExport(userId: string, ids: readonly string[]): Promise<ExportSkill[]>;
    getAssetsForExport(skillIds: readonly string[]): Promise<ExportSkillAsset[]>;
}

export interface McpServerDraftInput {
    name: string;
    transportType: 'stdio' | 'sse' | 'streamable-http';
    command?: string | null;
    args?: string[] | null;
    env?: Record<string, string> | null;
    url?: string | null;
    createdBy: string;
    manifestMeta: Record<string, unknown>;
    /** docker 샌드박스 네트워크 — 미지정이면 컬럼 기본값(full). add-on 권한 집행이 'none' 을 넘긴다 */
    sandboxNetwork?: 'full' | 'none';
}

export interface CatalogTemplateInstall {
    id: string;
    displayName: string;
    description: string;
    transportType: 'stdio' | 'streamable-http';
    commandTemplate?: string;
    urlTemplate?: string;
    argsSchema: Record<string, unknown>;
    envSchema: Record<string, unknown>;
    toolAllowlist?: string[];
    defaultEnabled: boolean;
}

export interface McpServerComponentStore extends ExtensionLinkedStore {
    insertDraft(input: McpServerDraftInput): Promise<{ id: string }>;
    /** (user_id, name) 이 이미 쓰였으면 그 id */
    findIdByUserAndName(userId: string, name: string): Promise<string | null>;
    /** 네트워크 권한이 닫혔다 — stdio 는 --network none, 원격은 끈다 */
    restrictNetworkForExtension(extensionId: string): Promise<{ sandboxed: number; disabled: number }>;
    /** 네트워크 권한이 열렸다 — 권한 때문에 막았던 stdio 만 되돌린다 */
    restoreNetworkForExtension(extensionId: string): Promise<number>;
    listExportCandidates(userId: string): Promise<ExportMcpServer[]>;
    getForExport(userId: string, ids: readonly string[]): Promise<ExportMcpServer[]>;
    /** 팩 카탈로그 템플릿 — 이미 있는 행(관리자 수정 포함)은 덮어쓰지 않는다 */
    installCatalogTemplate(template: CatalogTemplateInstall): Promise<void>;
}

/** 구성요소 종류 → DB 연결에 묶이는 저장 연산 팩토리 */
export interface AddonComponentStores {
    skills?: (db: StoreDb) => SkillComponentStore;
    mcpServers?: (db: StoreDb) => McpServerComponentStore;
}

/** 그 종류를 저장하는 add-on 이 빌드에 없거나 데이터 모듈을 불러오지 못했다 */
export class ComponentStoreUnavailableError extends Error {
    constructor(readonly kind: keyof AddonComponentStores, reason: string) {
        super(`구성요소 '${kind}' 를 저장하는 add-on 데이터 모듈이 없습니다 — ${reason}`);
        this.name = 'ComponentStoreUnavailableError';
    }
}
