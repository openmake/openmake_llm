<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# documents — Document Upload Processing Pipeline

## Purpose
Handles the full lifecycle of uploaded documents for Retrieval-Augmented Generation (RAG). `processor.ts` orchestrates file extraction from various formats (PDF, DOCX, TXT, MD). `chunker.ts` splits extracted text into overlapping chunks sized for embedding. `store.ts` persists chunks and their metadata to the vector store. `progress.ts` tracks and broadcasts upload/processing progress via WebSocket. The pipeline feeds `services/RAGService.ts`.

## Key Files
| File | Description |
|------|-------------|
| `processor.ts` | File extraction orchestrator — dispatches to format-specific parsers |
| `chunker.ts` | Text chunking with configurable size and overlap for optimal RAG retrieval |
| `store.ts` | Persists document chunks + metadata; calls `EmbeddingService` for vectors |
| `progress.ts` | Processing progress tracking and WebSocket broadcast |
| `index.ts` | Barrel export of the pipeline public API |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Chunk size and overlap are configured in `config/constants.ts` — do not hardcode them in `chunker.ts`
- `store.ts` calls `EmbeddingService.embed()` for each chunk — this is expensive; batch where possible
- Progress events use the WebSocket handler's broadcast mechanism; do not emit directly to `res`
- Supported file types are defined in `middlewares/validation.ts` (multipart upload validation)

### Testing Requirements
- Unit test chunker with known text and verify chunk boundaries and overlap
- Mock `EmbeddingService` in store tests to avoid LLM calls
- Run `npm run test:bun`

### Common Patterns
- Processor pattern: `async process(file: UploadedFile): Promise<ExtractedDocument>`
- Store pattern: `async storeChunks(doc: ExtractedDocument, userId: string): Promise<string[]>` (returns chunk IDs)
- Progress events: `{ stage: 'extracting' | 'chunking' | 'embedding' | 'storing', percent: number }`

## Dependencies
### Internal
- `services/EmbeddingService.ts` — Vector generation for chunks
- `data/repositories/kb.repository.ts` — Document metadata persistence
- `data/repositories/vector.repository.ts` — Vector chunk storage
- `sockets/ws-chat-handler.ts` — Progress broadcast channel
- `config/constants.ts` — Chunk size, overlap settings

### External
- `pdf-parse` or similar — PDF text extraction
- `mammoth` or similar — DOCX text extraction
- `multer` — Multipart file upload handling (configured in middlewares)

<!-- MANUAL: -->
