/**
 * MCP 서버 설치 안내 포트 — 설치 미리보기(M1b)가 번들 안 MCP 서버 정의에 전송·인증 경고를 붙이는 길.
 *
 * 판정 규칙(전송 퇴역 일정·원격 인증 등)은 MCP 런타임 add-on 이 안다. Base 는 이 포트만 부르고(Base→add-on import 금지),
 * 등록이 없거나 판정이 실패하면 빈 목록(fail-open — 미리보기는 그 경고만 빠진다).
 *
 * @module runtime-ports/mcp-install-hints
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('McpInstallHints');

/** 미리보기가 판정에 넘기는 MCP 서버 정의(연결 전 — 선언값만) */
export interface McpInstallHintInput {
    name: string;
    transportType: string;
    url?: string | null;
    command?: string | null;
}

/** 경고 한 건 — code 는 웹이 문구를 고르는 키, detail 은 날짜·대체 주소 등 */
export interface McpInstallHint {
    code: string;
    detail?: Record<string, string | boolean | null>;
}

export type McpInstallHintProvider = (entry: McpInstallHintInput) => McpInstallHint[];

let provider: McpInstallHintProvider | null = null;

/** add-on 이 부팅 때 등록한다. 해제 함수를 돌려준다(뒤에 등록한 것이 이긴다). */
export function registerMcpInstallHints(p: McpInstallHintProvider): () => void {
    provider = p;
    return () => { if (provider === p) provider = null; };
}

/** 등록된 판정으로 경고를 계산한다 — 등록 없음·실패면 빈 배열 */
export function getMcpInstallHints(entry: McpInstallHintInput): McpInstallHint[] {
    if (!provider) return [];
    try {
        return provider(entry);
    } catch (e) {
        logger.warn(`MCP 설치 안내 판정 실패(fail-open): ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
}
