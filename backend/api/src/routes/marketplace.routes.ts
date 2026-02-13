import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, forbidden, internalError } from '../utils/api-response';
import { requireAuth, requireAdmin, optionalAuth } from '../auth';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { asyncHandler } from '../utils/error-handler';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('MarketplaceRoutes');
const router = Router();

type MarketplaceStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
const VALID_STATUSES: MarketplaceStatus[] = ['pending', 'approved', 'rejected', 'suspended'];
const VALID_SORT_BY = ['downloads', 'rating', 'newest'] as const;

// ─── Public / Optional Auth ──────────────────────────────────────────────────

// GET / — List marketplace agents (public browsing allowed)
router.get('/', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { category, featured, search, limit, offset, sortBy } = req.query;

  const options: Record<string, unknown> = {};
  if (category) options.category = String(category);
  if (featured !== undefined) options.featured = featured === 'true';
  if (search) options.search = String(search);
  if (limit) options.limit = parseInt(String(limit), 10);
  if (offset) options.offset = parseInt(String(offset), 10);
  if (sortBy) {
    const sort = String(sortBy);
    if (!VALID_SORT_BY.includes(sort as typeof VALID_SORT_BY[number])) {
      return res.status(400).json(badRequest(`Invalid sortBy value. Must be one of: ${VALID_SORT_BY.join(', ')}`));
    }
    options.sortBy = sort;
  }

  const db = getUnifiedDatabase();
  const agents = await db.getMarketplaceAgents(options);
  res.json(success(agents));
}));

// ─── Authenticated (non-parameterized, must come before /:marketplaceId) ────

// GET /me/installed — List my installed agents
router.get('/me/installed', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const db = getUnifiedDatabase();
  const agents = await db.getUserInstalledAgents(String(req.user!.id));
  res.json(success(agents));
}));

// POST / — Publish agent to marketplace
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { agentId, title, description, longDescription, category, tags, icon, price } = req.body;

  if (!agentId || !title) {
    return res.status(400).json(badRequest('agentId and title are required'));
  }

  // 에이전트 소유권 확인
  const { getPool } = await import('../data/models/unified-database');
  const pool = getPool();
  const agentCheck = await pool.query(
      'SELECT created_by FROM custom_agents WHERE id = $1',
      [agentId]
  );
  if (agentCheck.rows.length > 0 && String(agentCheck.rows[0].created_by) !== String(req.user!.id) && req.user!.role !== 'admin') {
      return res.status(403).json(forbidden('자신의 에이전트만 마켓플레이스에 등록할 수 있습니다'));
  }

  const db = getUnifiedDatabase();
  const result = await db.publishToMarketplace({
    id: uuidv4(),
    agentId,
    title,
    description,
    longDescription,
    category,
    tags,
    icon,
    price,
    authorId: String(req.user!.id),
  });
  res.status(201).json(success(result));
}));

// ─── Public — Parameterized ──────────────────────────────────────────────────

// GET /:marketplaceId — Get single marketplace agent details (public)
router.get('/:marketplaceId', asyncHandler(async (req: Request, res: Response) => {
  const { marketplaceId } = req.params;
  const db = getUnifiedDatabase();
  const agent = await db.getMarketplaceAgent(marketplaceId);

  if (!agent) {
    return res.status(404).json(notFound('Marketplace agent'));
  }

  res.json(success(agent));
}));

// GET /:marketplaceId/reviews — Get reviews for agent (public)
router.get('/:marketplaceId/reviews', asyncHandler(async (req: Request, res: Response) => {
  const { marketplaceId } = req.params;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

  const db = getUnifiedDatabase();
  const reviews = await db.getAgentReviews(marketplaceId, limit);
  res.json(success(reviews));
}));

// ─── Authenticated — Parameterized ──────────────────────────────────────────

// POST /:marketplaceId/install — Install agent
router.post('/:marketplaceId/install', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { marketplaceId } = req.params;
  const db = getUnifiedDatabase();
  const result = await db.installAgent(marketplaceId, String(req.user!.id));
  res.json(success(result));
}));

// DELETE /:marketplaceId/install — Uninstall agent
router.delete('/:marketplaceId/install', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { marketplaceId } = req.params;
  const db = getUnifiedDatabase();
  const result = await db.uninstallAgent(marketplaceId, String(req.user!.id));
  res.json(success(result));
}));

// POST /:marketplaceId/reviews — Add review
router.post('/:marketplaceId/reviews', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { marketplaceId } = req.params;
  const { rating, title, content } = req.body;

  if (rating === undefined || rating === null) {
    return res.status(400).json(badRequest('rating is required'));
  }

  const numRating = Number(rating);
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json(badRequest('rating must be an integer between 1 and 5'));
  }

  const db = getUnifiedDatabase();
  const result = await db.addAgentReview({
    id: uuidv4(),
    marketplaceId,
    userId: String(req.user!.id),
    rating: numRating,
    title,
    content,
  });
  res.status(201).json(success(result));
}));

// ─── Admin ───────────────────────────────────────────────────────────────────

// PUT /:marketplaceId/status — Update marketplace status (approve/reject/suspend)
router.put('/:marketplaceId/status', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { marketplaceId } = req.params;
  const { status } = req.body;

  if (!status || !VALID_STATUSES.includes(status as MarketplaceStatus)) {
    return res.status(400).json(badRequest(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`));
  }

  const db = getUnifiedDatabase();
  const result = await db.updateMarketplaceStatus(marketplaceId, status as MarketplaceStatus);
  res.json(success(result));
}));

export default router;
