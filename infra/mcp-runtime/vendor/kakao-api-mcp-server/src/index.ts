#!/usr/bin/env node
import express, { type Request, type Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import cors from "cors";
import { fileURLToPath } from "url";
import { argv, logger } from "./config.js";
import { server } from "./server.js";
// 도구 등록(부수 효과 import) — 순서가 곧 도구 등록 순서다.
import "./place-tools.js";
import "./route-tool.js";
import "./search-tools.js";

// --- Run the Server (based on mode) ---

// Export the server instance if needed for testing or other modules
// export { server }; // <-- 파일 최상단으로 이동하거나 제거 (Node.js ESM 권장사항 따름)

// ESM에서는 require.main === module 대신 다른 방식으로 직접 실행 감지
// https://nodejs.org/api/esm.html#esm_no_require_exports_module_exports_filename_dirname
// Node.js v20부터는 import.meta.url을 사용하여 현재 파일이 직접 실행되는지 확인할 수 있음
// const isMainModule = import.meta.url === \`file://\${process.argv[1]}\`; // 수정 전
let isMainModule = false;
try {
  // fileURLToPath를 사용하여 올바르게 경로 비교
  const currentFilePath = fileURLToPath(import.meta.url);
  isMainModule = currentFilePath === process.argv[1];
} catch {
  // import.meta.url이 지원되지 않는 환경 고려 (예: CommonJS)
  // 또는 다른 방식으로 메인 모듈 여부 확인 필요 시 추가
}

// import/export는 최상위 레벨에서만 사용 가능하므로, 서버 시작 로직을 함수로 감싸기
async function startServer() {
  const mode = argv.mode as 'stdio' | 'http';
  const port = argv.port as number;

  if (mode === 'stdio') {
    // STDIO Mode - Direct connection via stdio
    logger.log("Starting Kakao Map MCP Server in stdio mode...");
    
    const stdioTransport = new StdioServerTransport();
    
    // 디버깅을 위한 stdio 입력 로깅
    process.stdin.on('data', (data) => {
      const input = data.toString().trim();
      logger.log(`STDIN received: ${input}`); // logger.log로 복원
      // logger.error(\`STDIN received (error level): \${input}\`); // logger.error 주석 처리

      try {
        // 입력 데이터 파싱
        const parsedData = JSON.parse(input);
        logger.log(`Parsed message type: ${parsedData.type}, tool: ${parsedData.tool}`); // logger.log로 복원
        // logger.error(\`Parsed message (error level) - Type: \${parsedData.type}, Tool: \${parsedData.tool}\`); // logger.error 주석 처리
      } catch (err: unknown) {
        if (err instanceof Error) {
          logger.error(`Failed to parse input: ${err.message}`);
        } else {
          logger.error('Failed to parse input: Unknown error'); // 수정 후
        }
      }
    });
    
    server.connect(stdioTransport).then(() => {
      logger.log("Kakao Map MCP Server connected via stdio.");
    }).catch(error => {
      logger.error(`Failed to connect server via stdio: ${error}`);
      process.exit(1);
    });
  } else {
    // HTTP/SSE Mode - Express server with SSE
    const app = express();
    let sseTransport: SSEServerTransport | null = null;
    
    // CORS Configuration
    const corsOptions = {
      origin: 'http://localhost:5173', // For MCP Inspector
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
      optionsSuccessStatus: 204
    };
    app.use(cors(corsOptions));
    
    // Routes
    app.get("/sse", async (req: Request, res: Response) => {
      logger.log("New SSE connection request received.");
      
      if (sseTransport) {
        logger.log("An existing SSE transport is active. Replacing with the new connection.");
      }
      
      // Create a new transport for this request
      const currentTransport = new SSEServerTransport("/messages", res as unknown as ServerResponse<IncomingMessage>);
      sseTransport = currentTransport;
      
      try {
        await server.connect(sseTransport);
        logger.log("MCP Server connected to SSE transport.");
        
        req.on("close", () => {
          logger.log("SSE connection closed by client.");
          if (sseTransport === currentTransport) {
            sseTransport = null;
          }
        });
      } catch (error) {
        logger.error(`Error connecting MCP server to SSE transport: ${error}`);
        if (sseTransport === currentTransport) {
          sseTransport = null;
        }
        if (!res.writableEnded) {
          res.status(500).end();
        }
      }
    });
    
    app.post("/messages", (req: Request, res: Response): void => {
      logger.log("Received POST /messages request.");
      if (!sseTransport) {
        logger.error("Received POST message but no active SSE transport.");
        res.status(400).send("No active SSE connection");
        return;
      }
      
      sseTransport.handlePostMessage(req as unknown as IncomingMessage, res as unknown as ServerResponse<IncomingMessage>)
        .then(() => {
          logger.log("POST message handled by SSE transport.");
        })
        .catch((error) => {
          logger.error(`Error handling POST message: ${error}`);
          if (!res.headersSent) {
            res.status(500).send("Error processing message");
          }
        });
    });
    
    // Start Server
    app.listen(port, () => {
      logger.log(`Kakao Map MCP Server (HTTP/SSE) listening on port ${port}`);
      logger.log(`SSE endpoint available at http://localhost:${port}/sse`);
      logger.log(`Message endpoint available at http://localhost:${port}/messages`);
    });
  }
} // startServer 함수 닫는 중괄호

// 메인 모듈로 실행될 때만 서버 시작
if (isMainModule) {
  startServer().catch(error => {
    logger.error("Failed to start server:", error);
    process.exit(1);
  });
} // if (isMainModule) 닫는 중괄호

// 서버 인스턴스를 export해야 한다면 파일 최상단에서 export
export { server };
