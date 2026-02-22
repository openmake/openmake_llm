import { getConfig } from '../config/env';

import { createLogger } from '../utils/logger';

const logger = createLogger('SkillsMarketplaceService');

// ============================================
// GitHub API Response Types
// ============================================

interface GitHubRepository {
    full_name: string;
    name: string;
    description: string | null;
    stargazers_count: number;
    updated_at: string;
    html_url: string;
}

interface GitHubSearchItem {
    name: string;
    path: string;
    html_url: string;
    repository: GitHubRepository;
}

interface GitHubSearchResponse {
    total_count: number;
    incomplete_results: boolean;
    items: GitHubSearchItem[];
}

// ============================================
// TTL Cache for GitHub Search
// ============================================

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

class GitHubSearchCache {
    private cache = new Map<string, CacheEntry<SkillsmpSearchResult>>();
    private ttlMs: number;

    constructor(ttlSeconds: number = 300) { // Default: 5 minutes
        this.ttlMs = ttlSeconds * 1000;
    }

    private generateKey(options: SkillsmpSearchOptions): string {
        return `${options.query || ''}:${options.category || ''}:${options.sort || 'stars'}:${options.limit || 20}`;
    }

    get(options: SkillsmpSearchOptions): SkillsmpSearchResult | null {
        const key = this.generateKey(options);
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        logger.debug(`Cache HIT for: ${key}`);
        return entry.data;
    }

    set(options: SkillsmpSearchOptions, data: SkillsmpSearchResult): void {
        const key = this.generateKey(options);
        this.cache.set(key, {
            data,
            expiresAt: Date.now() + this.ttlMs
        });
        logger.debug(`Cache SET for: ${key}`);
    }

    clear(): void {
        this.cache.clear();
    }
}

const githubSearchCache = new GitHubSearchCache(300); // 5 minutes TTL

export interface SkillsmpSearchOptions {
    query: string;
    category?: string;
    sort?: 'stars' | 'recent';
    limit?: number;
    offset?: number;
}

export interface SkillsmpSkill {
    id: string;
    name: string;
    description: string;
    repo: string;
    path: string;
    stars: number;
    category: string;
    content?: string;
    updatedAt: string;
    url: string;
}

export interface SkillsmpSearchResult {
    skills: SkillsmpSkill[];
    total: number;
    query: string;
}

export class SkillsMarketplaceService {
    /**
     * GitHub Search API를 통해 SKILL.md 파일 검색
     * 인증 토큰이 있으면 GitHub API 한도를 증가, 없으면 기본 한도로 실행.
     * (전략 A 적용: GitHub API)
     */
    async searchSkills(options: SkillsmpSearchOptions): Promise<SkillsmpSearchResult> {
        try {
            // Check cache first
            const cached = githubSearchCache.get(options);
            if (cached) {
                return cached;
            }

            const limit = options.limit || 20;
            const q = `filename:SKILL.md ${options.query || ''} in:path,file`;
            const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`;

            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'OpenMake-Skills-Marketplace'
            };

            const githubToken = getConfig().githubToken;
            if (githubToken) {
                headers['Authorization'] = `token ${githubToken}`;
            }

            const response = await fetch(url, { headers });
            if (!response.ok) {
                logger.warn(`GitHub Search API failed: ${response.status} ${response.statusText}`);
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const data = await response.json() as GitHubSearchResponse;

            // 파싱
            const items = data.items || [];
            const skills: SkillsmpSkill[] = items.map((item: GitHubSearchItem) => ({
                id: `${item.repository.full_name}:${item.path}`,
                name: item.repository.name,
                description: item.repository.description || 'No description provided.',
                repo: item.repository.full_name,
                path: item.path,
                stars: item.repository.stargazers_count || 0,
                category: options.category || 'general',
                updatedAt: item.repository.updated_at || new Date().toISOString(),
                url: item.html_url
            }));

            const result: SkillsmpSearchResult = {
                skills,
                total: data.total_count || 0,
                query: options.query || ''
            };

            // Store in cache
            githubSearchCache.set(options, result);

            return result;
        } catch (error) {
            logger.error('Failed to search marketplace skills', error);
            throw error;
        }
    }

    /**
     * GitHub raw URL에서 SKILL.md 내용 직접 로드
     */
    async getSkillContent(repo: string, path: string): Promise<string> {
        // 보통 파일들은 main/master 둘 중 하나의 엔드포인트를 쓰며 여기선 main 기반이나 리디렉션 처리
        // 더 안전하게는 api.github.com/repos/:repo/contents/:path 조회 가능
        const url = `https://api.github.com/repos/${repo}/contents/${path}`;

        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3.raw',
            'User-Agent': 'OpenMake-Skills-Marketplace'
        };

        const githubToken = getConfig().githubToken;
        if (githubToken) {
            headers['Authorization'] = `token ${githubToken}`;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to fetch skill content: ${response.status}`);
        }

        return response.text();
    }

    /**
     * SKILL.md 내용 파싱 (휴리스틱)
     */
    parseSkillMd(content: string): { name: string; description: string; content: string; category: string } {
        const lines = content.split('\n');
        let name = 'Uncategorized Skill';
        let description = '';
        let category = 'general';
        let mainContentStartIdx = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('# ') && name === 'Uncategorized Skill') {
                name = line.substring(2).trim();
            } else if (line.startsWith('> ')) {
                description = description ? `${description} ${line.substring(2).trim()}` : line.substring(2).trim();
            } else if (line.toLowerCase().startsWith('**category**:') || line.toLowerCase().startsWith('category:')) {
                category = line.split(':')[1].trim();
            } else if (line.toLowerCase().includes('## instructions')) {
                mainContentStartIdx = i + 1;
                break;
            }
        }

        const parsedContent = lines.slice(mainContentStartIdx).join('\n').trim();

        return {
            name,
            description: description || 'No description found in SKILL.md',
            content: parsedContent || content, // ## Instructions 블록이 없으면 전체 반환
            category
        };
    }
}

// 싱글톤
let instance: SkillsMarketplaceService | null = null;
export function getSkillsMarketplaceService(): SkillsMarketplaceService {
    if (!instance) {
        instance = new SkillsMarketplaceService();
    }
    return instance;
}
