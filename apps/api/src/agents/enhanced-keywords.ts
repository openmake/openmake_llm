import * as fs from 'fs';
import * as path from 'path';
import { builtinAddonDir, isBuiltinAddonEnabled } from '../addon-host/builtin-registry';
import { getIndustryAgentsData, type Agent, type AgentCategory, type IndustryAgentsData } from './types';
import keywordData from '../config/data/keyword-data.json';
import { IDF_NORMALIZATION } from '../config/runtime-limits';

const SYNONYMS: Record<string, string[]> = keywordData.synonyms as Record<string, string[]>;
const CATEGORY_WEIGHTS: Record<string, number> = keywordData.categoryWeights as Record<string, number>;
const STOP_WORDS = new Set<string>(keywordData.stopWords);

interface AgentWithCategory extends Agent {
    category: string;
}

const industryAgentsData: IndustryAgentsData = getIndustryAgentsData();

/**
 * 에이전트 id → 카테고리 어휘 추출용 텍스트 (산업 팩 `data/routing-vocabulary.json`). 팩이 꺼져 있으면 비어 있다.
 * 스킬 본문과 분리돼 있다 — 본문을 사람이 쓴 md 로 바꿀 때(2026-09-19) 본문에서 어휘를 뽑으면 라우팅 골든셋이
 * 120 → 116 으로 내려가, 종전 어휘를 그대로 고정했다. 라우팅 어휘 조정은 이 파일을 고치고 eval:routing 으로 확인한다.
 */
const ROUTING_VOCABULARY_TEXT: Record<string, string> = isBuiltinAddonEnabled('industry-pack')
    ? JSON.parse(fs.readFileSync(path.join(builtinAddonDir('industry-pack'), 'data', 'routing-vocabulary.json'), 'utf-8')) as Record<string, string>
    : {};

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
        const extractedBlocks = ROUTING_VOCABULARY_TEXT[agent.id] ?? '';

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
        const normalized = maxRawIdf > 0 ? IDF_NORMALIZATION.FLOOR + (rawIdf / maxRawIdf) * (IDF_NORMALIZATION.CEILING - IDF_NORMALIZATION.FLOOR) : IDF_NORMALIZATION.CEILING;
        const clamped = Math.min(IDF_NORMALIZATION.CEILING, Math.max(IDF_NORMALIZATION.FLOOR, Number(normalized.toFixed(4))));
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
        return IDF_NORMALIZATION.FLOOR;
    }

    return KEYWORD_IDF_MAP.get(normalized) ?? IDF_NORMALIZATION.FLOOR;
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
