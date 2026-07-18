/**
 * NotebookLM composer 연동 라우트.
 *
 * GET /api/mcp/notebooklm/notebooks — 로그인 유저의 NotebookLM MCP 서버(카탈로그
 * mcp-notebooklm 설치본)에서 노트북 목록을 가져온다. composer "Notebooks" picker 가
 * 결정적으로 리스트를 띄우는 용도 — LLM 도구 선택(cap·이름 트리거)에 의존하지 않는다.
 *
 * - 서버 해석: mcp_servers 에서 user_id + catalog_template_id 로 조회 (설치명이
 *   "notebooklm"/"mcp-notebooklm" 등 무엇이든 동작). 미설치 → 404 (프론트는 설치 CTA).
 * - spawn: lifecycle-supervisor.spawnUserServer — 멱등(연결돼 있으면 재사용, 죽었으면 self-heal).
 * - 캐시: per-user LRU + TTL(기본 5분, NOTEBOOKLM_INTEGRATION.LIST_CACHE_TTL_MS).
 *   NotebookLM RPC 왕복(2~4초)을 picker 열 때마다 반복하지 않기 위함. ?refresh=1 로 무효화.
 */
import { Router, Request, Response } from 'express';
import LRUCache from 'lru-cache';
import { requireAuth } from '../auth';
import { success, notFound, error as errorResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { getLifecycleSupervisor } from '../mcp/lifecycle-supervisor';
import { NOTEBOOKLM_INTEGRATION } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';

const logger = createLogger('NotebookLMRoutes');

export const notebooklmRouter = Router();

export interface NotebookSummary {
    id: string;
    title: string;
    source_count?: number;
    url?: string;
    modified_at?: string;
}

interface CachedList {
    notebooks: NotebookSummary[];
    fetchedAt: string;
}

const listCache = new LRUCache<string, CachedList>({
    max: NOTEBOOKLM_INTEGRATION.LIST_CACHE_MAX,
    ttl: NOTEBOOKLM_INTEGRATION.LIST_CACHE_TTL_MS,
});

/** notebook_list MCP 결과(text JSON)를 NotebookSummary[] 로 파싱. 형식 불일치 시 throw */
function parseNotebookList(text: string): NotebookSummary[] {
    const parsed: unknown = JSON.parse(text);
    const notebooks = (parsed as { notebooks?: unknown }).notebooks;
    if (!Array.isArray(notebooks)) throw new Error('notebook_list 응답에 notebooks 배열이 없습니다');
    return notebooks
        .filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null)
        .map((n) => ({
            id: String(n.id ?? ''),
            title: String(n.title ?? ''),
            source_count: typeof n.source_count === 'number' ? n.source_count : undefined,
            url: typeof n.url === 'string' ? n.url : undefined,
            modified_at: typeof n.modified_at === 'string' ? n.modified_at : undefined,
        }))
        .filter((n) => n.id !== '');
}

notebooklmRouter.get('/notebooklm/notebooks', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user?.id ?? '');
    const refresh = req.query.refresh === '1';

    if (!refresh) {
        const cached = listCache.get(userId);
        if (cached) {
            res.json(success({ ...cached, cached: true }));
            return;
        }
    }

    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.findUserServerByTemplate(userId, NOTEBOOKLM_INTEGRATION.TEMPLATE_ID);
    if (!server) {
        // 미설치 — 프론트는 404 를 "카탈로그에서 NotebookLM 연결" CTA 로 표시
        res.status(404).json(notFound('NotebookLM 서버 (카탈로그에서 설치 필요)'));
        return;
    }

    const supervisor = getLifecycleSupervisor();
    if (!supervisor) {
        res.status(503).json(errorResponse('SUPERVISOR_UNAVAILABLE', 'MCP supervisor 미초기화'));
        return;
    }

    // spawn·도구호출·파싱 실패는 전부 502(NOTEBOOKLM_UPSTREAM)로 수렴 — 프론트 picker 가
    // "재연결(쿠키 갱신)/이미지 리빌드" 안내를 띄우는 경로. generic 500 으로 새면 안 된다.
    // (spawn throw 예: mcp-runtime 이미지 미리빌드로 baked 바이너리 부재, 컨테이너 기동 실패)
    let text = '';
    let notebooks: NotebookSummary[];
    try {
        const client = await supervisor.spawnUserServer(userId, server.id);
        const result = await client.callTool('notebook_list', {});
        text = result.content?.find((c) => c.type === 'text')?.text ?? '';
        if (result.isError || !text) throw new Error(text || 'notebook_list 빈 응답');
        // 쿠키 만료 시 isError=false 로 로그인 HTML/에러 문자열이 올 수 있음 — 파싱 실패도 업스트림 오류
        notebooks = parseNotebookList(text);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`notebook_list 실패 u=${userId} s=${server.id}: ${msg.slice(0, 200)} (payload: ${text.slice(0, 120)})`);
        res.status(502).json(errorResponse('NOTEBOOKLM_UPSTREAM', msg.slice(0, 500)));
        return;
    }

    const payload: CachedList = { notebooks, fetchedAt: new Date().toISOString() };
    listCache.set(userId, payload);
    res.json(success({ ...payload, cached: false }));
}));
