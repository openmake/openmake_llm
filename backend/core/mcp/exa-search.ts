/**
 * Exa Search MCP 도구
 * Exa API와 통합하여 AI 코딩 에이전트용 고급 웹 검색 제공
 * - 라이브러리/API 정보 검색
 * - 코드 컨텍스트 제공
 * - 할루시네이션 감소
 */

import { MCPToolDefinition, MCPToolResult } from './types';

// Exa API 설정
const EXA_API_KEY = process.env.EXA_API_KEY || '';
const EXA_API_BASE = 'https://api.exa.ai';

// Exa 검색 결과 인터페이스
interface ExaSearchResult {
    title: string;
    url: string;
    text?: string;
    publishedDate?: string;
    author?: string;
    score?: number;
}

// API 요청 헬퍼
async function exaRequest<T>(endpoint: string, body: any): Promise<T> {
    if (!EXA_API_KEY) {
        throw new Error('EXA_API_KEY 환경변수가 설정되지 않았습니다');
    }

    const response = await fetch(`${EXA_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': EXA_API_KEY
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Exa API Error ${response.status}: ${error}`);
    }

    return response.json() as Promise<T>;
}

// ============================================
// Exa 도구 정의
// ============================================

/**
 * Exa 웹 검색 도구 - 일반 검색
 */
export const exaSearchTool: MCPToolDefinition = {
    tool: {
        name: 'exa_search',
        description: 'Exa AI 기반 고급 웹 검색 (자연어 쿼리 지원)',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '자연어 검색 쿼리' },
                numResults: { type: 'number', description: '결과 수 (기본: 10)' },
                useAutoprompt: { type: 'boolean', description: '자동 프롬프트 최적화' },
                type: { type: 'string', enum: ['neural', 'keyword', 'auto'], description: '검색 유형' }
            },
            required: ['query']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const query = args.query as string;
            const numResults = (args.numResults as number) || 10;
            const useAutoprompt = args.useAutoprompt !== false;
            const type = (args.type as string) || 'auto';

            const data = await exaRequest<any>('/search', {
                query,
                numResults,
                useAutoprompt,
                type,
                contents: {
                    text: { maxCharacters: 1000 }
                }
            });

            const results: ExaSearchResult[] = data.results || [];

            return {
                content: [{
                    type: 'text',
                    text: `Exa 검색 결과 (${results.length}개):\n\n${results.map((r, i) =>
                        `${i + 1}. **${r.title}**\n   🔗 ${r.url}\n   ${r.text?.slice(0, 200) || '내용 없음'}${r.text && r.text.length > 200 ? '...' : ''}`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            // API 키 없으면 기존 웹 검색으로 폴백
            if (String(error).includes('EXA_API_KEY')) {
                return {
                    content: [{
                        type: 'text',
                        text: '⚠️ EXA_API_KEY가 설정되지 않았습니다.\n\n.env 파일에 EXA_API_KEY를 추가하세요:\nEXA_API_KEY=your_api_key_here\n\nAPI 키는 https://exa.ai 에서 발급받을 수 있습니다.'
                    }],
                    isError: true
                };
            }
            return {
                content: [{ type: 'text', text: `Exa 검색 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * Exa 코드 검색 도구 - 라이브러리/API 정보
 */
export const exaCodeSearchTool: MCPToolDefinition = {
    tool: {
        name: 'exa_code',
        description: '코딩 에이전트용 Exa 검색 - 라이브러리, API, SDK 정보를 검색하여 할루시네이션 감소',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색할 라이브러리/API/SDK 관련 쿼리' },
                language: { type: 'string', description: '프로그래밍 언어 (예: typescript, python)' },
                numResults: { type: 'number', description: '결과 수' }
            },
            required: ['query']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const query = args.query as string;
            const language = args.language as string;
            const numResults = (args.numResults as number) || 10;

            // 코딩 컨텍스트에 맞게 쿼리 강화
            let enhancedQuery = query;
            if (language) {
                enhancedQuery = `${query} ${language} programming documentation API`;
            } else {
                enhancedQuery = `${query} programming documentation code example`;
            }

            // 공식 문서 사이트 우선
            const includeDomains = [
                'github.com',
                'npmjs.com',
                'pypi.org',
                'docs.python.org',
                'developer.mozilla.org',
                'stackoverflow.com',
                'typescript-lang.org',
                'nodejs.org',
                'reactjs.org',
                'vuejs.org',
                'angular.io',
                'docs.rs',
                'pkg.go.dev'
            ];

            const data = await exaRequest<any>('/search', {
                query: enhancedQuery,
                numResults,
                useAutoprompt: true,
                type: 'neural',
                includeDomains,
                contents: {
                    text: { maxCharacters: 2000 }
                }
            });

            const results: ExaSearchResult[] = data.results || [];

            const formattedResults = results.map((r, i) => {
                const domain = new URL(r.url).hostname;
                const icon = domain.includes('github') ? '🐙' :
                    domain.includes('npm') ? '📦' :
                        domain.includes('stackoverflow') ? '💬' : '📖';

                return `${i + 1}. ${icon} **${r.title}**\n   🔗 ${r.url}\n   \`\`\`\n   ${r.text?.slice(0, 500) || '내용 없음'}\n   \`\`\``;
            });

            return {
                content: [{
                    type: 'text',
                    text: `## 코드 검색 결과 (${results.length}개)\n\n${formattedResults.join('\n\n')}\n\n---\n💡 **팁**: 위 정보를 기반으로 정확한 코드를 작성하세요.`
                }]
            };
        } catch (error) {
            if (String(error).includes('EXA_API_KEY')) {
                return {
                    content: [{
                        type: 'text',
                        text: '⚠️ EXA_API_KEY가 설정되지 않았습니다. Exa 코드 검색을 사용하려면 API 키가 필요합니다.'
                    }],
                    isError: true
                };
            }
            return {
                content: [{ type: 'text', text: `Exa 코드 검색 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * Exa 유사 문서 검색 도구
 */
export const exaSimilarTool: MCPToolDefinition = {
    tool: {
        name: 'exa_similar',
        description: '주어진 URL과 유사한 콘텐츠 검색',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '기준 URL' },
                numResults: { type: 'number', description: '결과 수' }
            },
            required: ['url']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const url = args.url as string;
            const numResults = (args.numResults as number) || 5;

            const data = await exaRequest<any>('/findSimilar', {
                url,
                numResults,
                contents: {
                    text: { maxCharacters: 500 }
                }
            });

            const results: ExaSearchResult[] = data.results || [];

            return {
                content: [{
                    type: 'text',
                    text: `유사 콘텐츠 (${results.length}개):\n\n${results.map((r, i) =>
                        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.text?.slice(0, 150) || ''}...`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `유사 검색 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * Exa 콘텐츠 추출 도구
 */
export const exaContentsTool: MCPToolDefinition = {
    tool: {
        name: 'exa_contents',
        description: 'URL 목록에서 콘텐츠 추출',
        inputSchema: {
            type: 'object',
            properties: {
                urls: { type: 'array', items: { type: 'string' }, description: 'URL 목록' },
                textMaxChars: { type: 'number', description: '텍스트 최대 길이' }
            },
            required: ['urls']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const urls = args.urls as string[];
            const textMaxChars = (args.textMaxChars as number) || 2000;

            // URL당 ID 생성
            const ids = urls.map((_, i) => `url-${i}`);

            const data = await exaRequest<any>('/contents', {
                ids: urls,
                text: { maxCharacters: textMaxChars }
            });

            const results: any[] = data.results || [];

            return {
                content: [{
                    type: 'text',
                    text: `콘텐츠 추출 (${results.length}개):\n\n${results.map((r, i) =>
                        `## ${i + 1}. ${r.title || r.url}\n\n${r.text || '콘텐츠 없음'}\n\n---`
                    ).join('\n\n')}`
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `콘텐츠 추출 실패: ${error}` }],
                isError: true
            };
        }
    }
};

// 모든 Exa 도구 내보내기
export const exaTools: MCPToolDefinition[] = [
    exaSearchTool,
    exaCodeSearchTool,
    exaSimilarTool,
    exaContentsTool
];
