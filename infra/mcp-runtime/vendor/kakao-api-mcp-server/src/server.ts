import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// --- MCP Server Setup ---

export const server = new McpServer(
  {
    name: "kakao-map",
    version: "0.1.0"
  },
  {
    capabilities: {
      logging: {},
      tools: {}
    }
  }
);

// 위 코드 대신 MCP SDK의 문서나 타입을 확인하여 올바른 이벤트 처리 방식 적용
// 임시로 주석 처리
