/**
 * ============================================================
 * MCP (Model Context Protocol) 타입 정의
 * ============================================================
 * 
 * Model Context Protocol의 핵심 타입들을 정의합니다.
 * JSON-RPC 2.0 기반의 요청/응답 구조를 따릅니다.
 * 
 * @module backend/core/mcp/types
 * @see https://modelcontextprotocol.io/
 */

/**
 * MCP 요청 메시지 인터페이스
 * JSON-RPC 2.0 형식의 요청 메시지입니다.
 * 
 * @interface MCPRequest
 */
export interface MCPRequest {
    /** JSON-RPC 버전 (항상 '2.0') */
    jsonrpc: '2.0';
    /** 요청 식별자 */
    id: string | number;
    /** 호출할 메서드명 */
    method: string;
    /** 메서드 파라미터 */
    params?: Record<string, unknown>;
}

/**
 * MCP 응답 메시지 인터페이스
 * 요청에 대한 응답 또는 에러를 포함합니다.
 * 
 * @interface MCPResponse
 */
export interface MCPResponse {
    /** JSON-RPC 버전 (항상 '2.0') */
    jsonrpc: '2.0';
    /** 요청 식별자 (요청의 id와 일치) */
    id: string | number;
    /** 성공 시 결과 데이터 */
    result?: unknown;
    /** 실패 시 에러 정보 */
    error?: MCPError;
}

/**
 * MCP 에러 정보 인터페이스
 * 
 * @interface MCPError
 */
export interface MCPError {
    /** 에러 코드 */
    code: number;
    /** 에러 메시지 */
    message: string;
    /** 추가 에러 데이터 */
    data?: unknown;
}

/**
 * MCP 알림 메시지 인터페이스
 * 응답을 기대하지 않는 단방향 메시지입니다.
 * 
 * @interface MCPNotification
 */
export interface MCPNotification {
    /** JSON-RPC 버전 (항상 '2.0') */
    jsonrpc: '2.0';
    /** 알림 메서드명 */
    method: string;
    /** 알림 파라미터 */
    params?: Record<string, unknown>;
}

/**
 * MCP 도구 정의 인터페이스
 * LLM이 사용할 수 있는 도구를 정의합니다.
 * 
 * @interface MCPTool
 */
export interface MCPTool {
    /** 도구 이름 (고유 식별자) */
    name: string;
    /** 도구 설명 (LLM이 이해할 수 있도록 작성) */
    description: string;
    /** 입력 파라미터 스키마 (JSON Schema 형식) */
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/**
 * MCP 도구 실행 결과 인터페이스
 * 
 * @interface MCPToolResult
 */
export interface MCPToolResult {
    /** 결과 콘텐츠 배열 */
    content: Array<{
        /** 콘텐츠 타입 */
        type: 'text' | 'image' | 'resource';
        /** 텍스트 콘텐츠 */
        text?: string;
        /** 바이너리 데이터 (base64) */
        data?: string;
        /** MIME 타입 */
        mimeType?: string;
    }>;
    /** 에러 발생 여부 */
    isError?: boolean;
}

/**
 * MCP 리소스 정의 인터페이스
 * 파일, URL 등의 리소스를 정의합니다.
 * 
 * @interface MCPResource
 */
export interface MCPResource {
    /** 리소스 URI */
    uri: string;
    /** 리소스 이름 */
    name: string;
    /** 리소스 설명 */
    description?: string;
    /** MIME 타입 */
    mimeType?: string;
}

/**
 * MCP 서버 정보 인터페이스
 * 
 * @interface MCPServerInfo
 */
export interface MCPServerInfo {
    /** 서버 이름 */
    name: string;
    /** 서버 버전 */
    version: string;
    /** 서버 기능 */
    capabilities: {
        /** 도구 지원 여부 */
        tools?: boolean;
        /** 리소스 지원 여부 */
        resources?: boolean;
        /** 프롬프트 지원 여부 */
        prompts?: boolean;
    };
}

/**
 * MCP 도구 핸들러 타입
 * 도구 실행 시 호출되는 비동기 함수입니다.
 * 
 * @type MCPToolHandler
 */
export type MCPToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>;

/**
 * MCP 도구 정의 및 핸들러 인터페이스
 * 도구 메타데이터와 실행 핸들러를 함께 정의합니다.
 * 
 * @interface MCPToolDefinition
 */
export interface MCPToolDefinition {
    /** 도구 메타데이터 */
    tool: MCPTool;
    /** 도구 실행 핸들러 */
    handler: MCPToolHandler;
}
