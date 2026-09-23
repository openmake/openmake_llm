/**
 * K08 평가 하네스 공용 타입 — 코퍼스·데이터셋·측정 결과·프로필.
 * 순수 타입만 둔다(런타임 의존 없음) — metrics 단위 테스트가 DB 없이 이 타입을 쓴다.
 *
 * @module addons/knowledge-runtime/evaluation/types
 */

/** 코퍼스 문서 원본 형식 — pdf-text 는 실행 시 텍스트층 PDF 로, pdf-scanned 는 텍스트층 없는 PDF 로 실체화한다 */
export type CorpusFormat = 'txt' | 'md' | 'pdf-text' | 'pdf-scanned';

/** 합성 코퍼스 문서 한 건(원문은 우리가 직접 쓴 창작 텍스트) */
export interface CorpusDoc {
    /** 데이터셋 gold 가 참조하는 안정 키 */
    key: string;
    /** 이 문서가 들어갈 Space 키 */
    spaceKey: string;
    format: CorpusFormat;
    filename: string;
    /** 본문(pdf-text 는 이 텍스트로 PDF 를 만든다. pdf-scanned 는 무시 — 텍스트층이 없어야 하므로) */
    text: string;
    /** 수집이 실패해야 하는 문서면 기대 실패 코드(스캔 PDF 등) */
    expectFailure?: string;
    /** 프롬프트 인젝션 문서면, 모델이 지시를 따랐을 때만 나오는 카나리 문자열 */
    injectionCanary?: string;
    /** 이 문서를 재수집(restart/duplicate) 실험에 쓰는가 */
    restartProbe?: boolean;
    /** 이 문서를 삭제 공격에 쓰는가(수집 후 소프트 삭제) */
    deleteProbe?: boolean;
}

/** Space 정의 — scope 와 소유 persona 키 */
export interface SpaceDef {
    key: string;
    scopeType: 'user' | 'organization';
    /** user scope: 소유 persona 키 / organization scope: 조직 키 */
    ownerPersona: string;
    name: string;
    /** 이 Space 가 tombstone 공격 대상인가(수집 후 삭제) */
    tombstoneProbe?: boolean;
}

/** 데이터셋 케이스 카테고리 */
export type CaseCategory =
    | 'answerable'
    | 'unanswerable'
    | 'comparison'
    | 'conflict'
    | 'authorization'
    | 'deletion'
    | 'injection'
    | 'restart';

/** 권한 공격 하위 종류 */
export type AuthAttackKind = 'other_user' | 'other_org' | 'forged_binding' | 'unbound';

/** 삭제 공격 하위 종류 */
export type DeletionKind = 'deleted_document' | 'tombstoned_space';

/** 데이터셋 단일 케이스 */
export interface EvalCase {
    id: string;
    category: CaseCategory;
    /** 검색 질의(권한/삭제/인젝션/비답변 포함). restart 케이스는 질의 없이 재수집만 한다 */
    query?: string;
    /** 어느 Space 를 대상으로 검색하는가(권한 공격은 공격 대상 Space) */
    spaceKey?: string;
    /** 정답 근거 문서 키 집합(answerable·comparison·conflict) */
    goldDocKeys?: string[];
    /** 이 케이스를 수행할 persona(권한 공격의 공격자, 기본은 대상 Space 소유자) */
    asPersona?: string;
    authKind?: AuthAttackKind;
    deletionKind?: DeletionKind;
    /** injection 케이스가 노리는 인젝션 문서 키(카나리 판정용) */
    injectionDocKey?: string;
    /** restart 케이스가 재수집할 문서 키 */
    restartDocKey?: string;
    /** restart 시뮬레이션 방식 */
    restartMode?: 'double_ingest' | 'lease_expiry';
    /** unanswerable 기대 — 근거 없음이어야 한다 */
    expectNoEvidence?: boolean;
}

export interface EvalDataset {
    version: string;
    description: string;
    spaces: SpaceDef[];
    cases: EvalCase[];
}

/** 게이트 프로필 항목 */
export interface GateSpec {
    max?: number;
    min?: number;
    blocking: boolean;
    realLlmOnly?: boolean;
}

export interface EvalProfile {
    version: string;
    description: string;
    quality: Record<string, number>;
    gates: Record<string, GateSpec>;
    run: {
        realLlmConcurrency: number;
        realLlmSubsetPerCategory: number;
        syntheticPrefix: string;
    };
}
