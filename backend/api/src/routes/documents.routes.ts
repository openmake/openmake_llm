/**
 * ============================================================
 * Document Routes - 문서 처리 API 라우트
 * ============================================================
 *
 * 파일 업로드(Multer), PDF/이미지 텍스트 추출, LLM 기반 문서 요약,
 * 문서 Q&A 등 문서 분석 파이프라인을 제공합니다.
 * WebSocket을 통해 실시간 진행 상태(document_progress)를 브로드캐스트합니다.
 *
 * @module routes/documents.routes
 * @description
 * - POST   /api/upload           - 파일 업로드 (Multer, 최대 100MB)
 * - POST   /api/summarize        - 문서 요약 (LLM 기반 JSON 응답)
 * - POST   /api/document/ask     - 문서 Q&A (LLM 기반 질의응답)
 * - GET    /api/documents        - 업로드된 문서 목록
 * - GET    /api/documents/:docId - 개별 문서 조회
 * - DELETE /api/documents/:docId - 문서 삭제
 * - DELETE /api/documents        - 전체 문서 일괄 삭제
 *
 * @requires ClusterManager - Ollama 클러스터 관리
 * @requires extractDocument - 문서 텍스트 추출 (PDF, 이미지 OCR)
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';
import { ClusterManager } from '../cluster/manager';
import {
     extractDocument,
     createSummaryPrompt,
     createQAPrompt,
     ProgressEvent
  } from '../documents';
  import { uploadedDocuments } from '../documents/store';
  import { success, badRequest, notFound, serviceUnavailable } from '../utils/api-response';
  import { asyncHandler } from '../utils/error-handler';
  import { createLogger } from '../utils/logger';
import { buildExecutionPlan } from '../chat/profile-resolver';
import { detectLanguage } from '../chat/language-policy';
  import { validate, validateUploadContentType, validateFileUploadSecurity } from '../middlewares/validation';
  import { summarizeDocumentSchema, documentAskSchema } from '../schemas/documents.schema';
import { FILE_LIMITS } from '../config/constants';
import { getRAGService } from '../services/RAGService';
import { optionalAuth } from '../auth';

const logger = createLogger('DocumentsRoutes');

const router = Router();
let clusterManager: ClusterManager;
let broadcastFn: (data: Record<string, unknown>) => void;

// 로그 헬퍼 (Winston logger 위임)
const log = {
    debug: (msg: string, ...args: unknown[]) => {
        logger.debug(msg, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
        logger.warn(msg, ...args);
    }
};

// 업로드 디렉토리 설정
const uploadDir = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * 파일명 UTF-8 디코딩 및 정규화
 */
function decodeFilename(filename: string): string {
    if (!filename) return '';

    try {
        const latin1Buffer = Buffer.from(filename, 'latin1');
        const utf8Decoded = latin1Buffer.toString('utf8');
        const hasKorean = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(utf8Decoded);
        const hasGarbage = /[\u0080-\u00FF]{2,}/.test(utf8Decoded);

        if (hasKorean && !hasGarbage) {
            return utf8Decoded.normalize('NFC');
        }

        if (filename.includes('%')) {
            try {
                const percentDecoded = decodeURIComponent(filename);
                if (/[\uAC00-\uD7AF]/.test(percentDecoded)) {
                    return percentDecoded.normalize('NFC');
                }
            } catch (e) {
                // decodeURIComponent 실패 시 무시
            }
        }

        return filename.normalize('NFC');
    } catch (e) {
        log.warn(`[Filename] Decode error for: ${filename}`);
        return filename.normalize('NFC');
    }
}

// Multer 설정
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: FILE_LIMITS.MAX_SIZE_BYTES } // 300MB 제한
});

/**
 * 의존성 주입
 */
export function setDependencies(cluster: ClusterManager, broadcast: (data: Record<string, unknown>) => void): void {
    clusterManager = cluster;
    broadcastFn = broadcast;
}

/**
 * POST /api/upload
 * 파일 업로드
 */
router.post('/upload', optionalAuth, validateUploadContentType(FILE_LIMITS.MAX_SIZE_BYTES), upload.single('file'), validateFileUploadSecurity(), asyncHandler(async (req: Request, res: Response) => {
     try {
         if (!req.file) {
             res.status(400).json(badRequest('파일이 없습니다'));
             return;
         }

         const originalFilename = decodeFilename(req.file.originalname);
         logger.info(`[Upload] 파일 업로드: ${originalFilename}`);

        // 업로드 시작 알림
        broadcastFn?.({
            type: 'document_progress',
            stage: 'upload',
            message: `파일 업로드 완료: ${originalFilename}`,
            filename: originalFilename,
            progress: 5
        });

         // 진행 상태 콜백
         const onProgress = (event: ProgressEvent) => {
             logger.info(`[Progress] ${event.stage}: ${event.message} (${event.progress || 0}%)`);
            broadcastFn?.({
                ...event,
                filename: originalFilename
            });
        };

        const doc = await extractDocument(req.file.path, onProgress);
        doc.filename = originalFilename;

        const docId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        uploadedDocuments.set(docId, doc);

         logger.info(`[Upload] 텍스트 추출 완료: ${doc.text.length}자`);

        // 완료 알림
        broadcastFn?.({
            type: 'document_progress',
            stage: 'complete',
            message: `분석 완료: ${doc.text.length}자 추출`,
            filename: originalFilename,
            progress: 100
        });

        // RAG: 문서 임베딩 (fire-and-forget, 업로드 응답을 차단하지 않음)
        if (doc.text && doc.text.length > 0) {
            const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) as string | undefined;
            getRAGService().embedDocument({
                docId,
                text: doc.text,
                filename: originalFilename,
                userId,
            }).then(result => {
                logger.info(`[RAG] 문서 임베딩 완료: ${result.storedChunks}/${result.totalChunks}개 청크 (${result.durationMs}ms)`);
                broadcastFn?.({
                    type: 'document_progress',
                    stage: 'rag_complete',
                    message: `RAG 임베딩 완료: ${result.storedChunks}개 청크 저장됨`,
                    filename: originalFilename,
                    progress: 100
                });
            }).catch(ragError => {
                logger.warn('[RAG] 문서 임베딩 실패 (무시):', ragError);
            });
        }

         res.json(success({ docId, filename: doc.filename, type: doc.type, pages: doc.pages, textLength: doc.text.length, preview: doc.text.substring(0, 500) + (doc.text.length > 500 ? '...' : '') }));
      } catch (error: unknown) {
          logger.error('[Upload] 오류:', error);

         broadcastFn?.({
             type: 'document_progress',
             stage: 'error',
             message: `오류: ${(error instanceof Error ? error.message : '파일 처리 중 오류가 발생했습니다')}`,
             filename: decodeFilename(req.file?.originalname || '')
         });

         if (req.file && req.file.path && fs.existsSync(req.file.path)) {
             try {
                 fs.unlinkSync(req.file.path);
             } catch (e) {
                 // 무시
             }
         }

         throw error;
     }
}));

/**
 * POST /api/summarize
 * 문서 요약
 */
router.post('/summarize', validate(summarizeDocumentSchema), asyncHandler(async (req: Request, res: Response) => {
     const { docId, model } = req.body;

     const doc = uploadedDocuments.get(docId);
     if (!doc) {
         res.status(404).json(notFound('문서'));
         return;
     }

     logger.info(`[Summarize] 문서 요약: ${doc.filename}`);

      // §9 Pipeline Profile: brand model alias → 실제 엔진 모델 해석
      const sumPlan = buildExecutionPlan(model || '');
      const sumIsAuto = sumPlan.resolvedEngine === '__auto__';
      const sumEngineModel = sumIsAuto ? '' : (sumPlan.resolvedEngine || model);

      const bestNode = clusterManager.getBestNode(sumEngineModel);
      const client = bestNode ? clusterManager.createScopedClient(bestNode.id, sumEngineModel) : undefined;

      if (!client) {
          res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
          return;
      }

      // 사용자 언어 감지: Accept-Language 헤더 또는 문서 텍스트 기반
      const acceptLang = (req.headers['accept-language'] || '').substring(0, 2).toLowerCase();
      const docLang = ['ko','en','ja','zh','es','fr','de','pt','ru'].includes(acceptLang) ? acceptLang : detectLanguage(doc.text.substring(0, 500)).language;
      const prompt = createSummaryPrompt(doc, docLang);
     const result = await client.generate(prompt, { temperature: 0.1 });
    const response = result.response;

     logger.info('[Summarize] 요약 완료. JSON 파싱 시도...');

    let parsedSummary;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedSummary = JSON.parse(cleanJson);
     } catch (e) {
         logger.error('[Summarize] JSON 파싱 실패, 원본 반환', e);
        parsedSummary = {
            title: doc.filename,
            summary: ['(JSON 파싱 실패, 원본 텍스트 표시)'],
            sections: [{ title: 'Overview', content: response }],
            raw: response
        };
    }

     res.json(success({ summary: parsedSummary }));
 }));

  /**
   * POST /api/document/ask
  * 문서 Q&A
  */
router.post('/document/ask', validate(documentAskSchema), asyncHandler(async (req: Request, res: Response) => {
     const { docId, question, model } = req.body;

     const doc = uploadedDocuments.get(docId);
     if (!doc) {
         res.status(404).json(notFound('문서'));
         return;
     }

     logger.info(`[DocQA] 질문: ${question?.substring(0, 50)}...`);

      // §9 Pipeline Profile: brand model alias → 실제 엔진 모델 해석
      const qaPlan = buildExecutionPlan(model || '');
      const qaIsAuto = qaPlan.resolvedEngine === '__auto__';
      const qaEngineModel = qaIsAuto ? '' : (qaPlan.resolvedEngine || model);

      const bestNode = clusterManager.getBestNode(qaEngineModel);
      const client = bestNode ? clusterManager.createScopedClient(bestNode.id, qaEngineModel) : undefined;

      if (!client) {
          res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
          return;
      }

      // 사용자 언어 감지: 질문 텍스트 기반
      const questionLang = detectLanguage(question).language;
      const prompt = createQAPrompt(doc, question, questionLang);
    const result = await client.generate(prompt, { temperature: 0.1 });
    const response = result.response;

    let parsedAnswer;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedAnswer = JSON.parse(cleanJson);
     } catch (e) {
         logger.error('[DocQA] JSON 파싱 실패', e);
        parsedAnswer = {
            answer: response,
            evidence: "JSON 파싱 실패",
            raw: response
        };
    }

     res.json(success({ answer: parsedAnswer }));
 }));

 /**
  * GET /api/documents
 * 업로드된 문서 목록
 */
router.get('/documents', asyncHandler(async (_req: Request, res: Response) => {
     const docs = Array.from(uploadedDocuments.entries()).map(([id, doc]) => ({
         id,
         filename: doc.filename,
         type: doc.type,
         pages: doc.pages,
         textLength: doc.text.length
     }));
     res.json(success(docs));
 }));

/**
 * DELETE /api/documents
 * 업로드된 전체 문서 일괄 삭제
 */
router.delete('/documents', asyncHandler(async (_req: Request, res: Response) => {
    const docCount = uploadedDocuments.size;

    // RAG 벡터 임베딩 전체 삭제
    let embeddingsDeleted = 0;
    try {
        embeddingsDeleted = await getRAGService().deleteAllDocumentEmbeddings();
        logger.info(`[Documents] 전체 문서 임베딩 삭제: ${embeddingsDeleted}개`);
    } catch (error) {
        logger.error('[Documents] 전체 문서 임베딩 삭제 실패:', error);
    }

    // 문서 저장소 전체 삭제 (인메모리 + DB)
    uploadedDocuments.clear();

    logger.info(`[Documents] 전체 문서 삭제: ${docCount}개 문서, ${embeddingsDeleted}개 임베딩`);
    res.json(success({ deletedDocuments: docCount, deletedEmbeddings: embeddingsDeleted }));
}));

/**
 * GET /api/documents/:docId
 * 개별 문서 조회
 */
router.get('/documents/:docId', asyncHandler(async (req: Request, res: Response) => {
     const { docId } = req.params;
     const doc = uploadedDocuments.get(docId);

     if (!doc) {
         res.status(404).json(notFound('문서'));
         return;
     }

     res.json(success({ id: docId, filename: doc.filename, type: doc.type, pages: doc.pages, textLength: doc.text.length, text: doc.text, info: doc.info }));
}));

/**
 * DELETE /api/documents/:docId
 * 문서 삭제
 */
router.delete('/documents/:docId', asyncHandler(async (req: Request, res: Response) => {
     const { docId } = req.params;
     const deleted = uploadedDocuments.delete(docId);

     // RAG 벡터 임베딩도 함께 삭제
     let embeddingsDeleted = 0;
     if (deleted) {
         try {
             embeddingsDeleted = await getRAGService().deleteDocumentEmbeddings(docId);
             logger.info(`[RAG] 문서 임베딩 삭제: ${docId} → ${embeddingsDeleted}개 청크`);
         } catch (error) {
             logger.error(`[RAG] 문서 임베딩 삭제 실패 (${docId}):`, error);
         }
     }

     res.json(success({ deleted, embeddingsDeleted }));
 }));

export default router;
