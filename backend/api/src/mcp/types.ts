/**
 * ============================================================
 * MCP Types - Model Context Protocol 타입 정의
 * ============================================================
 *
 * MCP 모듈 전체에서 사용되는 핵심 타입, 인터페이스, 상수를 정의합니다.
 * JSON-RPC 2.0 프로토콜 기반의 요청/응답, 도구, 서버 설정 타입을 포함합니다.
 *
 * @module mcp/types
 * @description
 * - JSON-RPC 2.0 요청/응답/에러/알림 인터페이스
 * - MCP 도구(Tool) 정의, 핸들러, 결과 타입
 * - 외부 MCP 서버 연결 설정 및 상태 타입
 * - 네임스페이스 기반 외부 도구 엔트리 타입
 */

import type { UserContext } from './user-sandbox';

/**
 * MCP JSON-RPC 2.0 요청 메시지
 *
 * 클라이언트에서 서버로 전송되는 표준 JSON-RPC 요청입니다.
 * MCP 메서드 호출(initialize, tools/list, tools/call 등)에 사용됩니다.
 *
 * @interface MCPRequest
 */
export interface MCPRequest {
    /** JSON-RPC 프로토콜 버전 (항상 '2.0') */
    jsonrpc: '2.0';
    /** 요청 고유 식별자 (응답 매칭용) */
    id: string | number;
    /** 호출할 MCP 메서드명 (예: 'initialize', 'tools/list', 'tools/call') */
    method: string;
    /** 메서드별 파라미터 (선택적) */
    params?: Record<string, unknown>;
}

/**
 * MCP JSON-RPC 2.0 응답 메시지
 *
 * 서버에서 클라이언트로 반환되는 표준 JSON-RPC 응답입니다.
 * result 또는 error 중 하나만 포함됩니다.
 *
 * @interface MCPResponse
 */
export interface MCPResponse {
    /** JSON-RPC 프로토콜 버전 (항상 '2.0') */
    jsonrpc: '2.0';
    /** 원본 요청의 식별자 */
    id: string | number;
    /** 성공 시 결과 데이터 */
    result?: unknown;
    /** 실패 시 에러 정보 */
    error?: MCPError;
}

/**
 * MCP JSON-RPC 에러 객체
 *
 * JSON-RPC 2.0 표준 에러 코드를 사용합니다:
 * - -32700: JSON 파싱 에러
 * - -32601: 메서드를 찾을 수 없음
 * - -32602: 잘못된 파라미터
 * - -32603: 내부 서버 에러
 *
 * @interface MCPError
 */
export interface MCPError {
    /** JSON-RPC 표준 에러 코드 */
    code: number;
    /** 사람이 읽을 수 있는 에러 메시지 */
    message: string;
    /** 추가 에러 정보 (선택적) */
    data?: unknown;
}

/**
 * MCP JSON-RPC 2.0 알림 메시지
 *
 * 응답을 요구하지 않는 단방향 메시지입니다.
 * id 필드가 없어 요청과 구분됩니다.
 *
 * @interface MCPNotification
 */
export interface MCPNotification {
    /** JSON-RPC 프로토콜 버전 (항상 '2.0') */
    jsonrpc: '2.0';
    /** 알림 메서드명 */
    method: string;
    /** 알림 파라미터 (선택적) */
    params?: Record<string, unknown>;
}

/**
 * MCP 도구 정의
 *
 * AI 모델이 호출할 수 있는 도구의 메타데이터를 정의합니다.
 * JSON Schema 형식의 inputSchema로 입력 파라미터를 명세합니다.
 *
 * @interface MCPTool
 */
export interface MCPTool {
    /** 도구 고유 이름 (예: 'web_search', 'fs_read_file') */
    name: string;
    /** 도구 설명 (AI 모델이 도구 선택 시 참고) */
    description: string;
    /** 입력 파라미터 JSON Schema */
    inputSchema: {
        /** 스키마 타입 (항상 'object') */
        type: 'object';
        /** 파라미터 속성 정의 */
        properties: Record<string, unknown>;
        /** 필수 파라미터 이름 목록 */
        required?: string[];
    };
}

/**
 * MCP 도구 실행 결과
 *
 * 도구 실행 후 반환되는 콘텐츠 배열입니다.
 * 텍스트, 이미지, 리소스 등 다양한 타입을 포함할 수 있습니다.
 *
 * @interface MCPToolResult
 */
export interface MCPToolResult {
    /** 결과 콘텐츠 배열 (하나 이상의 항목 포함) */
    content: Array<{
        /** 콘텐츠 타입: 텍스트, 이미지(base64), 또는 리소스 참조 */
        type: 'text' | 'image' | 'resource';
        /** 텍스트 콘텐츠 (type='text'일 때) */
        text?: string;
        /** Base64 인코딩된 바이너리 데이터 (type='image'일 때) */
        data?: string;
        /** MIME 타입 (type='image' 또는 'resource'일 때) */
        mimeType?: string;
    }>;
    /** 에러 발생 여부 (true이면 content에 에러 메시지 포함) */
    isError?: boolean;
}

/**
 * MCP 리소스 정의
 *
 * 서버가 제공하는 정적 리소스(파일, URL 등)의 메타데이터입니다.
 *
 * @interface MCPResource
 */
export interface MCPResource {
    /** 리소스 식별 URI */
    uri: string;
    /** 리소스 표시 이름 */
    name: string;
    /** 리소스 설명 (선택적) */
    description?: string;
    /** 리소스 MIME 타입 (선택적) */
    mimeType?: string;
}

/**
 * MCP 서버 정보
 *
 * initialize 메서드 응답으로 반환되는 서버 메타데이터입니다.
 * 서버가 지원하는 capabilities(도구, 리소스, 프롬프트)를 포함합니다.
 *
 * @interface MCPServerInfo
 */
export interface MCPServerInfo {
    /** 서버 이름 */
    name: string;
    /** 서버 버전 */
    version: string;
    /** 서버가 지원하는 기능 */
    capabilities: {
        /** 도구(tools) 기능 지원 여부 */
        tools?: boolean;
        /** 리소스(resources) 기능 지원 여부 */
        resources?: boolean;
        /** 프롬프트(prompts) 기능 지원 여부 */
        prompts?: boolean;
    };
}

/**
 * MCP 도구 핸들러 함수 타입
 *
 * 도구 실행 시 호출되는 비동기 핸들러 함수입니다.
 * 제네릭 타입 T로 도구별 인자 타입을 지정할 수 있습니다.
 *
 * @typeParam T - 도구 입력 인자 타입 (기본값: Record<string, unknown>)
 * @param args - 도구 입력 인자
 * @param context - 사용자 컨텍스트 (선택적, Phase 3에서 추가)
 * @returns 도구 실행 결과
 */
export type MCPToolHandler<T extends Record<string, unknown> = Record<string, unknown>> = (args: T, context?: UserContext) => Promise<MCPToolResult>;

/**
 * MCP 도구 정의 (메타데이터 + 핸들러)
 *
 * 도구의 메타데이터(MCPTool)와 실행 핸들러(MCPToolHandler)를 묶은 타입입니다.
 * builtInTools 배열에 등록하여 ToolRouter에서 사용합니다.
 *
 * @typeParam T - 도구 입력 인자 타입 (기본값: Record<string, unknown>)
 * @interface MCPToolDefinition
 */
export interface MCPToolDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
    /** 도구 메타데이터 (이름, 설명, 입력 스키마) */
    tool: MCPTool;
    /** 도구 실행 핸들러 함수 */
    handler: MCPToolHandler<T>;
}

// ===== 외부 MCP 서버 관련 타입 =====

/**
 * MCP 서버 전송 방식
 *
 * 외부 MCP 서버와의 통신 프로토콜을 지정합니다:
 * - 'stdio': 자식 프로세스의 표준 입출력 (로컬 서버용)
 * - 'sse': Server-Sent Events (HTTP 기반 단방향 스트리밍)
 * - 'streamable-http': Streamable HTTP (양방향 HTTP 스트리밍)
 */
export type MCPTransportType = 'stdio' | 'sse' | 'streamable-http';

/**
 * 외부 MCP 서버 설정
 *
 * DB(mcp_servers 테이블)에 저장되는 외부 MCP 서버 연결 설정입니다.
 * transport_type에 따라 stdio 또는 sse/http 관련 필드를 사용합니다.
 *
 * @interface MCPServerConfig
 */
export interface MCPServerConfig {
    /** 서버 고유 ID (UUID) */
    id: string;
    /** 서버 고유 이름 (ToolRouter에서 네임스페이스로 사용) */
    name: string;
    /** 전송 프로토콜 (stdio, sse, streamable-http) */
    transport_type: MCPTransportType;
    /** stdio 전용: 실행할 명령어 (예: 'node', 'python') */
    command?: string;
    /** stdio 전용: 명령어 인자 (예: ['server.js', '--port', '3000']) */
    args?: string[];
    /** stdio 전용: 자식 프로세스에 전달할 환경 변수 */
    env?: Record<string, string>;
    /** sse/http 전용: 서버 접속 URL */
    url?: string;
    /** 서버 활성화 여부 (false이면 연결하지 않음) */
    enabled: boolean;
    /** 서버 생성 시각 (ISO 8601) */
    created_at: string;
    /** 서버 수정 시각 (ISO 8601) */
    updated_at: string;
}

/**
 * 외부 MCP 서버 연결 상태
 *
 * ExternalMCPClient의 현재 연결 상태를 나타냅니다.
 * MCPServerRegistry에서 전체 서버 상태 모니터링에 사용됩니다.
 *
 * @interface MCPConnectionStatus
 */
export interface MCPConnectionStatus {
    /** 서버 고유 ID */
    serverId: string;
    /** 서버 표시 이름 */
    serverName: string;
    /** 연결 상태: 미연결, 연결중, 연결됨, 에러 */
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    /** 검색된 도구 수 */
    toolCount: number;
    /** 마지막 ping 시각 (ISO 8601) */
    lastPing?: string;
    /** 에러 메시지 (status='error'일 때) */
    error?: string;
}

/**
 * 네임스페이스가 적용된 외부 도구 엔트리
 *
 * ToolRouter 내부에서 외부 도구를 관리할 때 사용하는 래퍼 타입입니다.
 * namespacedName("서버명::도구명") 형식으로 내장 도구와 구분합니다.
 *
 * @interface ExternalToolEntry
 */
export interface ExternalToolEntry {
    /** 소속 서버 ID */
    serverId: string;
    /** 소속 서버 이름 */
    serverName: string;
    /** 원본 도구 이름 (외부 서버에서의 이름) */
    originalName: string;
    /** 네임스페이스 적용된 이름 ("serverName::originalName" 형식) */
    namespacedName: string;
    /** 원본 도구 메타데이터 */
    tool: MCPTool;
}

/**
 * 네임스페이스 구분자 상수
 *
 * 외부 도구명에서 서버명과 도구명을 구분하는 구분자입니다.
 * 예: "postgres::query" → 서버명="postgres", 도구명="query"
 *
 * @constant
 */
export const MCP_NAMESPACE_SEPARATOR = '::';
