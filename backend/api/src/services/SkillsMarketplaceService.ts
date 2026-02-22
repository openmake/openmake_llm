import { createLogger } from '../utils/logger';

const logger = createLogger('SkillsMarketplaceService');

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
            const limit = options.limit || 20;
            const q = `filename:SKILL.md ${options.query || ''} in:path,file`;
            let url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`;

            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'OpenMake-Skills-Marketplace'
            };

            if (process.env.GITHUB_TOKEN) {
                headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
            }

            const response = await fetch(url, { headers });
            if (!response.ok) {
                logger.warn(`GitHub Search API failed: ${response.status} ${response.statusText}`);
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const data = await response.json() as any;

            // 파싱
            const items = data.items || [];
            const skills: SkillsmpSkill[] = items.map((item: any) => ({
                id: `${item.repository.full_name}:${item.path}`,
                name: item.repository.name,
                description: item.repository.description || 'No description provided.',
                repo: item.repository.full_name,
                path: item.path,
                stars: 0, // Code search endpoint doesn't return stars directly unfortunately, defaulting to 0
                category: options.category || 'general',
                updatedAt: new Date().toISOString(), // Fallback
                url: item.html_url
            }));

            return {
                skills,
                total: data.total_count || 0,
                query: options.query || ''
            };
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

        if (process.env.GITHUB_TOKEN) {
            headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
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
