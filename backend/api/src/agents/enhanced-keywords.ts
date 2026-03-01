import industryAgentsJson from './industry-agents.json';
import { RICH_SKILL_CONTENT } from './skill-seeder';
import type { Agent, AgentCategory, IndustryAgentsData } from './types';

const SYNONYMS: Record<string, string[]> = {
    '퇴사': ['인사', '이직', '사직', '퇴직'],
    '프레젠테이션': ['발표', 'PPT', '슬라이드'],
    '이직': ['퇴사', '전직', '이직준비'],
    '살빼기': ['다이어트', '체중감량', '운동'],
    '코드': ['코딩', '프로그래밍', '개발'],
    '돈': ['재무', '자금', '금융', '재테크'],
    '병원': ['의료', '진료', '건강', '치료'],
    '학교': ['교육', '학습', '수업'],
    '회사': ['기업', '비즈니스', '경영', '조직'],
    '집': ['부동산', '주택', '아파트', '매매'],
    '세금': ['세무', '절세', '납세', '과세'],
    '계약': ['법률', '계약서', '합의', '약관'],
    '면접': ['취업', '채용', '이력서', '자기소개서'],
    '자격증': ['시험', '인증', '합격'],
    '투자': ['재테크', '포트폴리오', '수익률', '자산'],
    '마케팅': ['홍보', '광고', '브랜드', '판매'],
    '앱': ['애플리케이션', '모바일', '어플'],
    '서버': ['백엔드', '인프라', '호스팅'],
    '디자인': ['UI', 'UX', '그래픽', '시각'],
    '데이터': ['분석', '통계', '데이터셋'],
    '창업': ['스타트업', '사업', '기업가'],
    '로봇': ['로보틱스', '자동화', '센서'],
    '에너지': ['전력', '태양광', '풍력', '신재생'],
    '농업': ['농사', '재배', '작물', '스마트팜'],
    '호텔': ['숙박', '관광', '리조트', '여행'],
    '물류': ['배송', '운송', '공급망', '유통'],
    '공무원': ['행정', '정부', '공공', '정책'],
};

const CATEGORY_WEIGHTS: Record<string, number> = {
    technology: 1.2,
    healthcare: 1.1,
    legal: 1.1,
    finance: 1.0,
    business: 0.95,
    education: 1.0,
    creative: 0.95,
    'data-ai': 1.1,
    science: 1.0,
    engineering: 1.0,
    media: 0.95,
    government: 1.0,
    'real-estate': 1.0,
    energy: 1.0,
    logistics: 1.0,
    hospitality: 1.0,
    agriculture: 1.0,
    special: 0.8,
};

const STOP_WORDS = new Set<string>([
    '합니다', '입니다', '위한', '통해', '대한', '함께', '기반', '관련',
    '전문가', '역할', '원칙', '기준', '형식', '가이드', '지침', '분야', '핵심',
    '문제', '분석', '설계', '관리', '제시', '제공', '수행', '적용', '운영', '지원',
    '정보', '필요', '사용', '반영', '정의', '결과', '대응', '검증', '실행', '구조',
]);

interface AgentWithCategory extends Agent {
    category: string;
}

const industryAgentsData: IndustryAgentsData = industryAgentsJson;

const ALL_AGENTS: AgentWithCategory[] = Object.entries(industryAgentsData).flatMap(
    ([categoryId, category]: [string, AgentCategory]) =>
        category.agents.map((agent: Agent): AgentWithCategory => ({
            ...agent,
            category: categoryId,
        })),
);

function normalizeKeyword(value: string): string {
    const cleaned = value
        .trim()
        .replace(/^[^A-Za-z0-9가-힣+#./-]+/, '')
        .replace(/[^A-Za-z0-9가-힣+#./-]+$/, '');

    if (!cleaned) {
        return '';
    }

    return /[A-Za-z]/.test(cleaned) ? cleaned.toLowerCase() : cleaned;
}

function extractSection(markdown: string, heading: string): string {
    const startMarker = `## ${heading}`;
    const start = markdown.indexOf(startMarker);
    if (start < 0) {
        return '';
    }

    const contentStart = start + startMarker.length;
    const remainder = markdown.slice(contentStart);
    const nextHeadingIndex = remainder.search(/\n##\s+/);

    return nextHeadingIndex >= 0 ? remainder.slice(0, nextHeadingIndex) : remainder;
}

function extractKeywordsFromText(text: string): Set<string> {
    const results = new Set<string>();

    const koreanPhrases = text.match(/[가-힣]{2,}(?:\s+[가-힣]{2,}){0,2}/g) ?? [];
    const englishTerms = text.match(/[A-Za-z][A-Za-z0-9+./-]{1,}/g) ?? [];

    for (const term of [...koreanPhrases, ...englishTerms]) {
        const normalized = normalizeKeyword(term);
        if (normalized.length < 2) {
            continue;
        }
        if (STOP_WORDS.has(normalized)) {
            continue;
        }
        results.add(normalized);
    }

    return results;
}

function buildCategoryVocabulary(): Map<string, Set<string>> {
    const categoryVocabulary = new Map<string, Set<string>>();

    for (const agent of ALL_AGENTS) {
        const categoryId = agent.category;
        const existing = categoryVocabulary.get(categoryId) ?? new Set<string>();
        const richContent = RICH_SKILL_CONTENT[agent.id] ?? '';

        const extractedBlocks = [
            extractSection(richContent, '핵심 방법론'),
            extractSection(richContent, '주요 프레임워크/도구'),
            extractSection(richContent, '자주 발생하는 난제와 대응'),
            extractSection(richContent, '전문 표준과 품질 기준'),
        ].join('\n');

        const tokens = extractKeywordsFromText(extractedBlocks);
        for (const token of tokens) {
            existing.add(token);
        }

        categoryVocabulary.set(categoryId, existing);
    }

    return categoryVocabulary;
}

function buildSynonymIndex(): Map<string, string[]> {
    const index = new Map<string, Set<string>>();

    for (const [root, synonyms] of Object.entries(SYNONYMS)) {
        const group = [root, ...synonyms].map(normalizeKeyword).filter(Boolean);

        for (const item of group) {
            const others = group.filter(entry => entry !== item);
            const existing = index.get(item) ?? new Set<string>();
            for (const synonym of others) {
                existing.add(synonym);
            }
            index.set(item, existing);
        }
    }

    const finalized = new Map<string, string[]>();
    for (const [key, value] of index.entries()) {
        finalized.set(key, Array.from(value).sort((a, b) => a.localeCompare(b)));
    }

    return finalized;
}

function buildAgentKeywordMap(categoryVocabulary: Map<string, Set<string>>): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();

    for (const agent of ALL_AGENTS) {
        const keywords = new Set<string>();

        for (const rawKeyword of agent.keywords) {
            const normalized = normalizeKeyword(rawKeyword);
            if (normalized) {
                keywords.add(normalized);
            }
        }

        const descriptionTerms = extractKeywordsFromText(agent.description);
        for (const term of descriptionTerms) {
            keywords.add(term);
        }

        const categoryTerms = categoryVocabulary.get(agent.category) ?? new Set<string>();
        for (const term of categoryTerms) {
            keywords.add(term);
        }

        map.set(agent.id, keywords);
    }

    return map;
}

function buildKeywordIdf(agentKeywordMap: Map<string, Set<string>>): Map<string, number> {
    const docFrequency = new Map<string, number>();
    const totalAgents = Math.max(ALL_AGENTS.length, 1);

    for (const keywordSet of agentKeywordMap.values()) {
        for (const keyword of keywordSet) {
            const current = docFrequency.get(keyword) ?? 0;
            docFrequency.set(keyword, current + 1);
        }
    }

    const maxRawIdf = totalAgents > 1 ? Math.log(totalAgents) : 1;
    const idfWeights = new Map<string, number>();

    for (const [keyword, count] of docFrequency.entries()) {
        const rawIdf = Math.log(totalAgents / Math.max(count, 1));
        const normalized = maxRawIdf > 0 ? 0.1 + (rawIdf / maxRawIdf) * 0.9 : 1.0;
        const clamped = Math.min(1.0, Math.max(0.1, Number(normalized.toFixed(4))));
        idfWeights.set(keyword, clamped);
    }

    return idfWeights;
}

const CATEGORY_VOCABULARY = buildCategoryVocabulary();
const SYNONYM_INDEX = buildSynonymIndex();
const AGENT_KEYWORD_MAP = buildAgentKeywordMap(CATEGORY_VOCABULARY);
const KEYWORD_IDF_MAP = buildKeywordIdf(AGENT_KEYWORD_MAP);

export function getEnhancedKeywords(agentId: string): string[] {
    const baseKeywords = AGENT_KEYWORD_MAP.get(agentId);
    if (!baseKeywords) {
        return [];
    }

    const expanded = new Set<string>(baseKeywords);

    for (const keyword of baseKeywords) {
        const synonyms = SYNONYM_INDEX.get(keyword) ?? [];
        for (const synonym of synonyms) {
            expanded.add(synonym);
        }
    }

    return Array.from(expanded).sort((a, b) => a.localeCompare(b));
}

export function getKeywordIDF(keyword: string): number {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) {
        return 0.1;
    }

    return KEYWORD_IDF_MAP.get(normalized) ?? 0.1;
}

export function getSynonyms(word: string): string[] {
    const normalized = normalizeKeyword(word);
    if (!normalized) {
        return [];
    }

    return SYNONYM_INDEX.get(normalized) ?? [];
}

export function getCategoryWeight(categoryId: string): number {
    return CATEGORY_WEIGHTS[categoryId] ?? 1.0;
}
