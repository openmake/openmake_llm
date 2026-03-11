<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# sockets — WebSocket Real-Time Chat

## Purpose
Implements the WebSocket server for real-time streaming chat. `ws-chat-handler.ts` is the main message dispatcher: it authenticates the connection, parses incoming chat messages, orchestrates pre-chat steps (web search, RAG retrieval), calls `ChatService.processMessage()`, and streams tokens back to the client as they arrive. `ws-auth.ts` handles WebSocket-specific JWT authentication (tokens passed in the upgrade request). `ws-types.ts` defines the message payload types. `handler.ts` manages the WebSocket server lifecycle and connection registry.

## Key Files
| File | Description |
|------|-------------|
| `ws-chat-handler.ts` | Main chat message handler: auth, pre-chat, ChatService call, token streaming |
| `ws-auth.ts` | WebSocket JWT authentication from upgrade request headers or query params |
| `ws-types.ts` | TypeScript types for WebSocket message payloads (chat, ack, error, progress) |
| `handler.ts` | WebSocket server lifecycle, connection registry, ping/pong keepalive |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Authentication happens at connection upgrade time in `ws-auth.ts` — reject unauthenticated connections before accepting
- Each connection is tracked in the connection registry in `handler.ts` for targeted message broadcasting (progress events)
- Streaming tokens are sent as `{ type: 'chunk', content: token }` messages; final message is `{ type: 'done' }`
- Error messages use `{ type: 'error', message: '...' }` — never send raw stack traces to the client
- The `msg.language` field triggers `detectLanguage()` if no explicit language preference is set

### Testing Requirements
- WebSocket tests use `ws` client against a test server instance
- Mock `ChatService` to control streaming output
- Test authentication rejection on missing/invalid tokens
- Run `npm run test:bun`

### Common Patterns
- Message dispatch: `switch(msg.type) { case 'chat': handleChat(ws, msg, user); break; ... }`
- Token streaming: `chatService.processMessage(ctx, (token) => ws.send(JSON.stringify({ type: 'chunk', content: token })))`
- Connection cleanup: remove from registry on `ws.on('close', ...)`

## Dependencies
### Internal
- `services/ChatService.ts` — Core chat processing
- `auth/middleware.ts` / `ws-auth.ts` — Connection authentication
- `services/RAGService.ts` — Pre-chat RAG retrieval
- `mcp/web-search.ts` — Pre-chat web search
- `i18n/` — Language detection
- `utils/logger.ts` — Connection and error logging

### External
- `ws` 8.18.3 — WebSocket server

<!-- MANUAL: -->
