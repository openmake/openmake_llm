/**
 * API v1 Router
 * Aggregates all v1 routes with /api/v1 prefix
 * 
 * This router provides backward compatibility while establishing
 * a versioned API structure for future versions.
 */
import { Router } from 'express';

// Import existing routers
import chatRouter from '../chat.routes';
import agentRouter from '../agents.routes';
import { mcpRouter } from '../mcp.routes';
import usageRouter from '../usage.routes';
import metricsRouter from '../metrics.routes';
import documentsRouter from '../documents.routes';
import webSearchRouter from '../web-search.routes';
import nodesRouter from '../nodes.routes';
import agentsMonitoringRouter from '../agents-monitoring.routes';
import { tokenMonitoringRouter } from '../token-monitoring.routes';
import { memoryRouter } from '../memory.routes';
import auditRouter from '../audit.routes';
import researchRouter from '../research.routes';
import canvasRouter from '../canvas.routes';
import externalRouter from '../external.routes';
import marketplaceRouter from '../marketplace.routes';
import { pushRouter } from '../push.routes';

const v1Router = Router();

// Mount all routes under v1
v1Router.use('/chat', chatRouter);
v1Router.use('/agents', agentRouter);
v1Router.use('/mcp', mcpRouter);
v1Router.use('/usage', usageRouter);
v1Router.use('/metrics', metricsRouter);
v1Router.use('/documents', documentsRouter);
v1Router.use('/search', webSearchRouter);
v1Router.use('/nodes', nodesRouter);
v1Router.use('/monitoring', tokenMonitoringRouter);
v1Router.use('/agents-monitoring', agentsMonitoringRouter);
v1Router.use('/memory', memoryRouter);
v1Router.use('/audit', auditRouter);
v1Router.use('/research', researchRouter);
v1Router.use('/canvas', canvasRouter);
v1Router.use('/external', externalRouter);
v1Router.use('/marketplace', marketplaceRouter);
v1Router.use('/push', pushRouter);

export default v1Router;
