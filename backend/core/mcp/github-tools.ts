/**
 * GitHub MCP 도구
 * GitHub API와 통합하여 저장소, 이슈, PR, 코드 검색 기능 제공
 */

import { MCPToolDefinition, MCPToolResult } from './types';

// GitHub API 설정
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// 공통 헤더
function getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Ollama-MCP-Client',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    if (GITHUB_TOKEN) {
        headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    }

    return headers;
}

// API 요청 헬퍼
async function githubRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${GITHUB_API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: { ...getHeaders(), ...options?.headers }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API Error ${response.status}: ${error}`);
    }

    return response.json() as Promise<T>;
}

// ============================================
// GitHub 도구 정의
// ============================================

/**
 * 저장소 검색 도구
 */
export const githubSearchReposTool: MCPToolDefinition = {
    tool: {
        name: 'github_search_repos',
        description: 'GitHub에서 저장소 검색',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색어 (예: language:typescript stars:>1000)' },
                sort: { type: 'string', enum: ['stars', 'forks', 'updated'], description: '정렬 기준' },
                limit: { type: 'number', description: '결과 수 (기본: 10)' }
            },
            required: ['query']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const query = args.query as string;
            const sort = (args.sort as string) || 'stars';
            const limit = (args.limit as number) || 10;

            const data = await githubRequest<any>(`/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&per_page=${limit}`);

            const repos = data.items.map((repo: any) => ({
                name: repo.full_name,
                description: repo.description,
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                language: repo.language,
                url: repo.html_url,
                updated: repo.updated_at
            }));

            return {
                content: [{
                    type: 'text',
                    text: `검색 결과 (${repos.length}개):\n\n${repos.map((r: any, i: number) =>
                        `${i + 1}. **${r.name}** ⭐${r.stars} 🍴${r.forks}\n   ${r.description || '설명 없음'}\n   언어: ${r.language || 'N/A'} | ${r.url}`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `GitHub 저장소 검색 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 저장소 정보 조회 도구
 */
export const githubGetRepoTool: MCPToolDefinition = {
    tool: {
        name: 'github_get_repo',
        description: 'GitHub 저장소 상세 정보 조회',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: '저장소 소유자' },
                repo: { type: 'string', description: '저장소 이름' }
            },
            required: ['owner', 'repo']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const owner = args.owner as string;
            const repo = args.repo as string;

            const data = await githubRequest<any>(`/repos/${owner}/${repo}`);

            const info = `
## ${data.full_name}

**설명:** ${data.description || '없음'}

### 통계
- ⭐ Stars: ${data.stargazers_count}
- 🍴 Forks: ${data.forks_count}
- 👀 Watchers: ${data.watchers_count}
- 🐛 Open Issues: ${data.open_issues_count}

### 정보
- 언어: ${data.language || 'N/A'}
- 라이선스: ${data.license?.name || 'N/A'}
- 생성일: ${new Date(data.created_at).toLocaleDateString()}
- 최근 업데이트: ${new Date(data.updated_at).toLocaleDateString()}

### 링크
- 🔗 ${data.html_url}
- 📖 Homepage: ${data.homepage || 'N/A'}
`;

            return { content: [{ type: 'text', text: info }] };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `저장소 조회 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 이슈 목록 조회 도구
 */
export const githubListIssuesTool: MCPToolDefinition = {
    tool: {
        name: 'github_list_issues',
        description: 'GitHub 저장소의 이슈 목록 조회',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: '저장소 소유자' },
                repo: { type: 'string', description: '저장소 이름' },
                state: { type: 'string', enum: ['open', 'closed', 'all'], description: '이슈 상태' },
                limit: { type: 'number', description: '결과 수' }
            },
            required: ['owner', 'repo']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const owner = args.owner as string;
            const repo = args.repo as string;
            const state = (args.state as string) || 'open';
            const limit = (args.limit as number) || 10;

            const issues = await githubRequest<any[]>(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${limit}`);

            const issueList = issues
                .filter((i: any) => !i.pull_request) // PR 제외
                .map((issue: any) => ({
                    number: issue.number,
                    title: issue.title,
                    state: issue.state,
                    author: issue.user.login,
                    labels: issue.labels.map((l: any) => l.name),
                    comments: issue.comments,
                    created: issue.created_at
                }));

            return {
                content: [{
                    type: 'text',
                    text: `이슈 목록 (${issueList.length}개):\n\n${issueList.map((i: any) =>
                        `#${i.number} [${i.state}] ${i.title}\n   작성자: ${i.author} | 댓글: ${i.comments}개 | 라벨: ${i.labels.join(', ') || '없음'}`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `이슈 조회 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 이슈 생성 도구
 */
export const githubCreateIssueTool: MCPToolDefinition = {
    tool: {
        name: 'github_create_issue',
        description: 'GitHub 저장소에 새 이슈 생성 (토큰 필요)',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: '저장소 소유자' },
                repo: { type: 'string', description: '저장소 이름' },
                title: { type: 'string', description: '이슈 제목' },
                body: { type: 'string', description: '이슈 내용' },
                labels: { type: 'array', items: { type: 'string' }, description: '라벨 목록' }
            },
            required: ['owner', 'repo', 'title']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            if (!GITHUB_TOKEN) {
                return {
                    content: [{ type: 'text', text: '❌ GITHUB_TOKEN 환경변수가 설정되지 않았습니다.' }],
                    isError: true
                };
            }

            const owner = args.owner as string;
            const repo = args.repo as string;

            const issue = await githubRequest<any>(`/repos/${owner}/${repo}/issues`, {
                method: 'POST',
                body: JSON.stringify({
                    title: args.title,
                    body: args.body || '',
                    labels: args.labels || []
                })
            });

            return {
                content: [{
                    type: 'text',
                    text: `✅ 이슈 생성 완료!\n\n#${issue.number}: ${issue.title}\nURL: ${issue.html_url}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `이슈 생성 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 코드 검색 도구
 */
export const githubSearchCodeTool: MCPToolDefinition = {
    tool: {
        name: 'github_search_code',
        description: 'GitHub에서 코드 검색',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색어 (예: useState language:typescript)' },
                limit: { type: 'number', description: '결과 수' }
            },
            required: ['query']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const query = args.query as string;
            const limit = (args.limit as number) || 10;

            const data = await githubRequest<any>(`/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`);

            const results = data.items.map((item: any) => ({
                name: item.name,
                path: item.path,
                repo: item.repository.full_name,
                url: item.html_url
            }));

            return {
                content: [{
                    type: 'text',
                    text: `코드 검색 결과 (${results.length}개):\n\n${results.map((r: any, i: number) =>
                        `${i + 1}. **${r.name}**\n   저장소: ${r.repo}\n   경로: ${r.path}\n   🔗 ${r.url}`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `코드 검색 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 파일 내용 조회 도구
 */
export const githubGetFileTool: MCPToolDefinition = {
    tool: {
        name: 'github_get_file',
        description: 'GitHub 저장소의 파일 내용 조회',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: '저장소 소유자' },
                repo: { type: 'string', description: '저장소 이름' },
                path: { type: 'string', description: '파일 경로' },
                ref: { type: 'string', description: '브랜치/태그 (기본: main)' }
            },
            required: ['owner', 'repo', 'path']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const owner = args.owner as string;
            const repo = args.repo as string;
            const path = args.path as string;
            const ref = (args.ref as string) || 'main';

            const data = await githubRequest<any>(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`);

            if (data.type !== 'file') {
                return {
                    content: [{ type: 'text', text: '디렉토리입니다. 파일 경로를 지정해주세요.' }],
                    isError: true
                };
            }

            // Base64 디코딩
            const content = Buffer.from(data.content, 'base64').toString('utf-8');

            return {
                content: [{
                    type: 'text',
                    text: `📄 **${data.name}** (${data.size} bytes)\n\n\`\`\`\n${content.slice(0, 5000)}${content.length > 5000 ? '\n... (truncated)' : ''}\n\`\`\``
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `파일 조회 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * Pull Request 목록 조회 도구
 */
export const githubListPRsTool: MCPToolDefinition = {
    tool: {
        name: 'github_list_prs',
        description: 'GitHub 저장소의 Pull Request 목록 조회',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: '저장소 소유자' },
                repo: { type: 'string', description: '저장소 이름' },
                state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR 상태' },
                limit: { type: 'number', description: '결과 수' }
            },
            required: ['owner', 'repo']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const owner = args.owner as string;
            const repo = args.repo as string;
            const state = (args.state as string) || 'open';
            const limit = (args.limit as number) || 10;

            const prs = await githubRequest<any[]>(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}`);

            const prList = prs.map((pr: any) => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                author: pr.user.login,
                base: pr.base.ref,
                head: pr.head.ref,
                merged: pr.merged_at ? true : false,
                created: pr.created_at
            }));

            return {
                content: [{
                    type: 'text',
                    text: `Pull Request 목록 (${prList.length}개):\n\n${prList.map((pr: any) =>
                        `#${pr.number} [${pr.state}${pr.merged ? '/merged' : ''}] ${pr.title}\n   ${pr.head} → ${pr.base} | 작성자: ${pr.author}`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `PR 조회 실패: ${error}` }],
                isError: true
            };
        }
    }
};

// 모든 GitHub 도구 내보내기
export const githubTools: MCPToolDefinition[] = [
    githubSearchReposTool,
    githubGetRepoTool,
    githubListIssuesTool,
    githubCreateIssueTool,
    githubSearchCodeTool,
    githubGetFileTool,
    githubListPRsTool
];
