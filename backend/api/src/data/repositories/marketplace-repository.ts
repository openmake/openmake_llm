import { withTransaction } from '../retry-wrapper';
import { BaseRepository, QueryParam } from './base-repository';
import type { AgentReview, MarketplaceAgent, MarketplaceStatus } from '../models/unified-database';

export class MarketplaceRepository extends BaseRepository {
    async publishToMarketplace(params: {
        id: string;
        agentId: string;
        authorId: string;
        title: string;
        description?: string;
        longDescription?: string;
        category?: string;
        tags?: string[];
        icon?: string;
        price?: number;
    }): Promise<MarketplaceAgent> {
        const result = await this.query<MarketplaceAgent>(
            `INSERT INTO agent_marketplace 
            (id, agent_id, author_id, title, description, long_description, category, tags, icon, price, is_free)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                params.id,
                params.agentId,
                params.authorId,
                params.title,
                params.description,
                params.longDescription,
                params.category,
                params.tags ? JSON.stringify(params.tags) : null,
                params.icon || '🤖',
                params.price || 0,
                (params.price || 0) === 0
            ]
        );

        const row = result.rows[0];
        return {
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        };
    }

    async getMarketplaceAgents(options?: {
        category?: string;
        status?: MarketplaceStatus;
        featured?: boolean;
        search?: string;
        sortBy?: string;
        limit?: number;
        offset?: number;
    }): Promise<MarketplaceAgent[]> {
        let query = 'SELECT * FROM agent_marketplace WHERE 1=1';
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (options?.status) {
            query += ` AND status = $${paramIdx++}`;
            params.push(options.status);
        } else {
            query += ` AND status = $${paramIdx++}`;
            params.push('approved');
        }

        if (options?.category) {
            query += ` AND category = $${paramIdx++}`;
            params.push(options.category);
        }
        if (options?.featured) {
            query += ' AND is_featured = TRUE';
        }
        if (options?.search) {
            query += ` AND (LOWER(title) LIKE $${paramIdx} OR LOWER(description) LIKE $${paramIdx})`;
            params.push(`%${options.search.toLowerCase()}%`);
            paramIdx++;
        }

        const sortMap: Record<string, string> = {
            downloads: 'downloads DESC',
            rating: 'rating_avg DESC',
            newest: 'created_at DESC'
        };
        const sortClause = (options?.sortBy && sortMap[options.sortBy])
            ? sortMap[options.sortBy]
            : 'is_featured DESC, downloads DESC, rating_avg DESC';
        query += ` ORDER BY ${sortClause}`;

        const effectiveLimit = options?.limit ?? (options?.search ? 100 : undefined);
        if (effectiveLimit !== undefined) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(effectiveLimit);
        }
        if (options?.offset) {
            query += ` OFFSET $${paramIdx++}`;
            params.push(options.offset);
        }

        const result = await this.query<MarketplaceAgent>(query, params);
        return result.rows.map((row) => ({
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        }));
    }

    async getMarketplaceAgent(marketplaceId: string): Promise<MarketplaceAgent | undefined> {
        const result = await this.query<MarketplaceAgent>('SELECT * FROM agent_marketplace WHERE id = $1', [marketplaceId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        };
    }

    async updateMarketplaceStatus(marketplaceId: string, status: MarketplaceStatus): Promise<void> {
        await this.query(
            `UPDATE agent_marketplace 
            SET status = $1, updated_at = NOW(),
                published_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE published_at END
            WHERE id = $2`,
            [status, marketplaceId]
        );
    }

    async installAgent(marketplaceId: string, userId: string): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            const result = await client.query(
                `INSERT INTO agent_installations (marketplace_id, user_id)
                VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [marketplaceId, userId]
            );

            if ((result.rowCount || 0) > 0) {
                await client.query(
                    'UPDATE agent_marketplace SET downloads = downloads + 1 WHERE id = $1',
                    [marketplaceId]
                );
            }
        });
    }

    async uninstallAgent(marketplaceId: string, userId: string): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            const result = await client.query(
                'DELETE FROM agent_installations WHERE marketplace_id = $1 AND user_id = $2',
                [marketplaceId, userId]
            );

            if ((result.rowCount || 0) > 0) {
                await client.query(
                    'UPDATE agent_marketplace SET downloads = GREATEST(downloads - 1, 0) WHERE id = $1',
                    [marketplaceId]
                );
            }
        });
    }

    async getUserInstalledAgents(userId: string): Promise<MarketplaceAgent[]> {
        const result = await this.query<MarketplaceAgent>(
            `SELECT m.* FROM agent_marketplace m
            JOIN agent_installations i ON m.id = i.marketplace_id
            WHERE i.user_id = $1
            ORDER BY i.installed_at DESC`,
            [userId]
        );
        return result.rows.map((row) => ({
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        }));
    }

    async addAgentReview(params: {
        id: string;
        marketplaceId: string;
        userId: string;
        rating: number;
        title?: string;
        content?: string;
    }): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            await client.query(
                `INSERT INTO agent_reviews (id, marketplace_id, user_id, rating, title, content)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT(marketplace_id, user_id) DO UPDATE SET
                    rating = EXCLUDED.rating,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content`,
                [params.id, params.marketplaceId, params.userId, params.rating, params.title, params.content]
            );

            await client.query(
                `UPDATE agent_marketplace SET
                    rating_avg = (SELECT AVG(rating) FROM agent_reviews WHERE marketplace_id = $1),
                    rating_count = (SELECT COUNT(*) FROM agent_reviews WHERE marketplace_id = $1)
                WHERE id = $1`,
                [params.marketplaceId]
            );
        });
    }

    async getAgentReviews(marketplaceId: string, limit: number = 20): Promise<AgentReview[]> {
        const result = await this.query<AgentReview>(
            'SELECT * FROM agent_reviews WHERE marketplace_id = $1 ORDER BY created_at DESC LIMIT $2',
            [marketplaceId, limit]
        );
        return result.rows as AgentReview[];
    }
}
