/**
 * Document Routes
 * 문서 업로드, 요약, Q&A, 관리 API 라우트
 * 
 * - POST /upload - 파일 업로드
 * - POST /summarize - 문서 요약
 * - POST /document/ask - 문서 Q&A
 * - GET /documents - 문서 목록
 * - GET /documents/:docId - 개별 문서 조회
 * - DELETE /documents/:docId - 문서 삭제
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
  import { getConfig } from '../config';
  import { success, badRequest, notFound, internalError, serviceUnavailable } from '../utils/api-response';
  import { asyncHandler } from '../utils/error-handler';

const router = Router();
let clusterManager: ClusterManager;
let broadcastFn: (data: Record<string, unknown>) => void;

// 로그 헬퍼
const envConfig = getConfig();
const logLevels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = (logLevels as Record<string, number>)[envConfig.logLevel] || 1;

const log = {
    debug: (msg: string, ...args: unknown[]) => {
        if (currentLogLevel <= 0) console.log(`[DEBUG] ${msg}`, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
        if (currentLogLevel <= 2) console.warn(`[WARN] ${msg}`, ...args);
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
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB 제한
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
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
     try {
         if (!req.file) {
             res.status(400).json(badRequest('파일이 없습니다'));
             return;
         }

        const originalFilename = decodeFilename(req.file.originalname);
        console.log(`[Upload] 파일 업로드: ${originalFilename}`);

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
            console.log(`[Progress] ${event.stage}: ${event.message} (${event.progress || 0}%)`);
            broadcastFn?.({
                ...event,
                filename: originalFilename
            });
        };

        const doc = await extractDocument(req.file.path, onProgress);
        doc.filename = originalFilename;

        const docId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        uploadedDocuments.set(docId, doc);

        console.log(`[Upload] 텍스트 추출 완료: ${doc.text.length}자`);

        // 완료 알림
        broadcastFn?.({
            type: 'document_progress',
            stage: 'complete',
            message: `분석 완료: ${doc.text.length}자 추출`,
            filename: originalFilename,
            progress: 100
        });

         res.json(success({ docId, filename: doc.filename, type: doc.type, pages: doc.pages, textLength: doc.text.length, preview: doc.text.substring(0, 500) + (doc.text.length > 500 ? '...' : '') }));
     } catch (error: unknown) {
         console.error('[Upload] 오류:', error);

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
});

/**
 * POST /api/summarize
 * 문서 요약
 */
router.post('/summarize', asyncHandler(async (req: Request, res: Response) => {
     const { docId, model } = req.body;

     const doc = uploadedDocuments.get(docId);
     if (!doc) {
         res.status(404).json(notFound('문서'));
         return;
     }

    console.log(`[Summarize] 문서 요약: ${doc.filename}`);

      const bestNode = clusterManager.getBestNode(model);
      const client = bestNode ? clusterManager.createScopedClient(bestNode.id, model) : undefined;

      if (!client) {
          res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
          return;
      }

      const prompt = createSummaryPrompt(doc);
     const result = await client.generate(prompt, { temperature: 0.1 });
    const response = result.response;

    console.log('[Summarize] 요약 완료. JSON 파싱 시도...');

    let parsedSummary;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedSummary = JSON.parse(cleanJson);
    } catch (e) {
        console.error('[Summarize] JSON 파싱 실패, 원본 반환', e);
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
router.post('/document/ask', asyncHandler(async (req: Request, res: Response) => {
     const { docId, question, model } = req.body;

     const doc = uploadedDocuments.get(docId);
     if (!doc) {
         res.status(404).json(notFound('문서'));
         return;
     }

    console.log(`[DocQA] 질문: ${question?.substring(0, 50)}...`);

      const bestNode = clusterManager.getBestNode(model);
      const client = bestNode ? clusterManager.createScopedClient(bestNode.id, model) : undefined;

      if (!client) {
          res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
          return;
      }

      const prompt = createQAPrompt(doc, question);
    const result = await client.generate(prompt, { temperature: 0.1 });
    const response = result.response;

    let parsedAnswer;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedAnswer = JSON.parse(cleanJson);
    } catch (e) {
        console.error('[DocQA] JSON 파싱 실패', e);
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
router.get('/documents', (req: Request, res: Response) => {
     const docs = Array.from(uploadedDocuments.entries()).map(([id, doc]) => ({
         id,
         filename: doc.filename,
         type: doc.type,
         pages: doc.pages,
         textLength: doc.text.length
     }));
     res.json(success(docs));
 });

/**
 * GET /api/documents/:docId
 * 개별 문서 조회
 */
router.get('/documents/:docId', (req: Request, res: Response) => {
     const { docId } = req.params;
     const doc = uploadedDocuments.get(docId);

     if (!doc) {
         res.status(404).json(notFound('문서'));
         return;
     }

     res.json(success({ id: docId, filename: doc.filename, type: doc.type, pages: doc.pages, textLength: doc.text.length, text: doc.text, info: doc.info }));
});

/**
 * DELETE /api/documents/:docId
 * 문서 삭제
 */
router.delete('/documents/:docId', (req: Request, res: Response) => {
     const { docId } = req.params;
     const deleted = uploadedDocuments.delete(docId);
     res.json(success({ deleted }));
 });

export default router;
