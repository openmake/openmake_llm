/**
 * ============================================================
 * DeepResearchService - 심층 연구 자동화 서비스
 * ============================================================
 *
 * ollama-deep-researcher MCP와 유사한 기능 제공:
 * - 주제 분해 → 웹 검색 → Firecrawl 스크래핑 → 청크 합성 → 반복 루프 → 보고서 생성
 *
 * @module services/DeepResearchService
 */

import { OllamaClient, createClient } from '../ollama/client';
import { performWebSearch, SearchResult } from '../mcp/web-search';
import { isFirecrawlConfigured } from '../mcp/firecrawl';
import { firecrawlPost } from '../utils/firecrawl-client';
import { getConfig } from '../config/env';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { CAPACITY, TRUNCATION } from '../config/runtime-limits';
import { v4 as uuidv4 } from 'uuid';

import {
    ResearchConfig,
    ResearchProgress,
    ResearchResult,
    SubTopic,
    SynthesisResult,
    globalConfig,
    setGlobalConfig
} from './deep-research-types';

import {
    deduplicateSources,
    normalizeUrl,
    clampImportance,
    buildFallbackSubTopics,
    chunkArray,
    extractBulletLikeFindings,
    getLoopProgressRange
} from './deep-research-utils';

// Re-export types so consumers don't break
export type { ResearchConfig, ResearchProgress, ResearchResult };

const logger = createLogger('DeepResearchService');

// ============================================================
// 다국어 프롬프트 매핑 (ko/en/ja/zh/es/de)
// ============================================================

/** 섹션 헤더 다국어 매핑 */
const SECTION_HEADERS: Record<string, { summary: string; findings: string; analysis: string; references: string }> = {
    ko: { summary: '종합 요약', findings: '주요 발견사항', analysis: '상세 분석', references: '참고 자료' },
    en: { summary: 'Executive Summary', findings: 'Key Findings', analysis: 'Detailed Analysis', references: 'References' },
    ja: { summary: '総合概要', findings: '主な発見', analysis: '詳細分析', references: '参考資料' },
    zh: { summary: '综合摘要', findings: '主要发现', analysis: '详细分析', references: '参考资料' },
    es: { summary: 'Resumen Ejecutivo', findings: 'Hallazgos Clave', analysis: 'Análisis Detallado', references: 'Referencias' },
    de: { summary: 'Zusammenfassung', findings: 'Wichtige Erkenntnisse', analysis: 'Detailanalyse', references: 'Referenzen' },
    fr: { summary: 'Résumé exécutif', findings: 'Découvertes clés', analysis: 'Analyse détaillée', references: 'Références' },
};

function getSectionHeaders(lang: string) {
    return SECTION_HEADERS[lang] || SECTION_HEADERS['en']!;
}

/** 주제 분해 프롬프트 */
function getDecomposePrompt(lang: string, topic: string): string {
    const prompts: Record<string, string> = {
        ko: `다음 주제를 심층 연구하기 위해 8-15개의 서브 토픽을 생성하세요.\n주제: ${topic}\n\n요구사항:\n1) 각 서브 토픽마다 서로 다른 관점의 검색어 2-3개를 만드세요.\n2) 중요도는 1-5 정수로 부여하세요.\n3) JSON 배열만 출력하세요. 설명 문장 금지.\n\n반드시 다음 형식:\n[\n  {\n    "title": "서브 토픽 제목",\n    "searchQueries": ["검색어 1", "검색어 2", "검색어 3"],\n    "importance": 5\n  }\n]`,
        ja: `次のトピックを深く研究するために8-15個のサブトピックを生成してください。\nトピック: ${topic}\n\n要件:\n1) 各サブトピックに異なる観点の検索クエリ2-3個を含めてください。\n2) 重要度は1-5の整数で。\n3) JSON配列のみ出力。説明文は不要。\n\n必ず次の形式で:\n[\n  {\n    "title": "サブトピック名",\n    "searchQueries": ["クエリ1", "クエリ2", "クエリ3"],\n    "importance": 5\n  }\n]`,
        zh: `为以下主题生成8-15个子主题进行深入研究。\n主题: ${topic}\n\n要求:\n1) 每个子主题包含2-3个不同角度的搜索查询。\n2) 重要性为1-5的整数。\n3) 仅输出JSON数组，禁止说明文字。\n\n必须使用以下格式:\n[\n  {\n    "title": "子主题标题",\n    "searchQueries": ["查询1", "查询2", "查询3"],\n    "importance": 5\n  }\n]`,
        es: `Genera 8-15 subtemas para investigar en profundidad el siguiente tema.\nTema: ${topic}\n\nRequisitos:\n1) Cada subtema debe incluir 2-3 consultas de búsqueda diversas.\n2) La importancia debe ser un entero de 1-5.\n3) Solo genera un array JSON, sin texto adicional.\n\nFormato requerido:\n[\n  {\n    "title": "Título del subtema",\n    "searchQueries": ["consulta 1", "consulta 2", "consulta 3"],\n    "importance": 5\n  }\n]`,
        de: `Erstelle 8-15 Unterthemen für eine Tiefenrecherche zum folgenden Thema.\nThema: ${topic}\n\nAnforderungen:\n1) Jedes Unterthema muss 2-3 verschiedene Suchanfragen enthalten.\n2) Wichtigkeit als Ganzzahl von 1-5.\n3) Nur JSON-Array ausgeben, kein zusätzlicher Text.\n\nErforderliches Format:\n[\n  {\n    "title": "Unterthema-Titel",\n    "searchQueries": ["Anfrage 1", "Anfrage 2", "Anfrage 3"],\n    "importance": 5\n  }\n]`,
        fr: `Générez 8 à 15 sous-thèmes pour une recherche approfondie sur le sujet suivant.\nSujet : ${topic}\n\nExigences :\n1) Chaque sous-thème doit inclure 2-3 requêtes de recherche variées.\n2) L'importance doit être un entier de 1 à 5.\n3) Produisez uniquement un tableau JSON, sans texte supplémentaire.\n\nFormat requis :\n[\n  {\n    \"title\": \"Titre du sous-thème\",\n    \"searchQueries\": [\"requête 1\", \"requête 2\", \"requête 3\"],\n    \"importance\": 5\n  }\n]`,
    };
    return prompts[lang] || `Generate 8-15 subtopics for deep research on this topic.\nTopic: ${topic}\n\nRequirements:\n1) Each subtopic must include 2-3 diverse search queries.\n2) importance must be an integer from 1-5.\n3) Output JSON array only with no additional text.\n\nRequired format:\n[\n  {\n    "title": "Subtopic title",\n    "searchQueries": ["query 1", "query 2", "query 3"],\n    "importance": 5\n  }\n]`;
}

/** 청크 요약 프롬프트 */
function getChunkSummaryPrompt(lang: string, topic: string, chunkIndex: number, totalChunks: number, chunkContext: string): string {
    const header = `(${chunkIndex + 1}/${totalChunks})`;
    const prompts: Record<string, string> = {
        ko: `다음은 "${topic}" 연구용 소스 청크${header}입니다.\n\n요구사항:\n1) 800-1200 단어로 중간 요약을 작성하세요.\n2) 핵심 주장마다 반드시 [출처 N] 형식의 인용을 포함하세요.\n3) 불확실한 정보는 단정하지 말고 출처 근거 중심으로 작성하세요.\n\n소스:\n${chunkContext}`,
        ja: `以下は「${topic}」研究用のソースチャンク${header}です。\n\n要件:\n1) 800-1200語で中間要約を作成してください。\n2) 主要な主張には必ず[出典 N]形式の引用を含めてください。\n3) 不確実な情報は断定せず、エビデンスベースで記述してください。\n\nソース:\n${chunkContext}`,
        zh: `以下是“${topic}”研究用源块${header}。\n\n要求:\n1) 用800-1200字编写中间摘要。\n2) 关键论点必须包含[来源 N]格式的引用。\n3) 不确定的信息不要下定论，以证据为基础。\n\n源:\n${chunkContext}`,
        es: `Este es un fragmento de fuentes ${header} para la investigación sobre "${topic}".\n\nRequisitos:\n1) Escribe un resumen intermedio de 800-1200 palabras.\n2) Incluye citas en formato [Fuente N] para afirmaciones clave.\n3) Mantén un lenguaje basado en evidencias.\n\nFuentes:\n${chunkContext}`,
        de: `Dies ist ein Quellen-Chunk ${header} für die Recherche über "${topic}".\n\nAnforderungen:\n1) Schreiben Sie eine Zwischenzusammenfassung von 800-1200 Wörtern.\n2) Fügen Sie Zitate im Format [Quelle N] für Kernaussagen ein.\n3) Bleiben Sie evidenzbasiert.\n\nQuellen:\n${chunkContext}`,
        fr: `Ceci est un bloc de sources ${header} pour la recherche sur \"${topic}\".\n\nExigences :\n1) Rédigez un résumé intermédiaire de 800-1200 mots.\n2) Incluez des citations au format [Source N] pour les affirmations clés.\n3) Restez fondé sur les preuves.\n\nSources :\n${chunkContext}`,
    };
    return prompts[lang] || `This is a source chunk ${header} for research on "${topic}".\n\nRequirements:\n1) Write an intermediate summary in 800-1200 words.\n2) Include citations in [Source N] format for key claims.\n3) Keep evidence-driven language and avoid unsupported certainty.\n\nSources:\n${chunkContext}`;
}

/** 청크 병합 프롬프트 */
function getMergePrompt(lang: string, topic: string, chunkSummaries: string[]): string {
    const summaryText = chunkSummaries.map((s, i) => `### Chunk ${i + 1}\n${s}`).join('\n\n');
    const prompts: Record<string, string> = {
        ko: `다음은 "${topic}" 연구의 중간 요약들입니다.\n\n요구사항:\n1) 모든 중간 요약을 통합해 2000-3000 단어의 종합 합성문을 작성하세요.\n2) 핵심 주장마다 [출처 N] 형식의 인용을 반드시 포함하세요.\n3) 반복을 줄이고, 주제별 구조를 명확히 정리하세요.\n\n중간 요약:\n${summaryText}`,
        ja: `以下は「${topic}」研究の中間要約です。\n\n要件:\n1) すべての中間要約を統合し2000-3000語の総合合成を作成してください。\n2) 主要な主張に[出典 N]形式の引用を含めてください。\n3) 重複を減らし、テーマ別に明確に構成してください。\n\n中間要約:\n${summaryText}`,
        zh: `以下是“${topic}”研究的中间摘要。\n\n要求:\n1) 合并所有中间摘要，写成2000-3000字的综合分析。\n2) 关键论点必须包含[来源 N]格式的引用。\n3) 减少重复，按主题清晰组织。\n\n中间摘要:\n${summaryText}`,
        es: `A continuación se presentan los resúmenes intermedios de la investigación sobre "${topic}".\n\nRequisitos:\n1) Fusiona todos los resúmenes en una síntesis de 2000-3000 palabras.\n2) Incluye citas en formato [Fuente N] para afirmaciones clave.\n3) Reduce la repetición y presenta una estructura temática clara.\n\nResúmenes intermedios:\n${summaryText}`,
        de: `Nachfolgend die Zwischenzusammenfassungen der Recherche über "${topic}".\n\nAnforderungen:\n1) Vereinige alle Zusammenfassungen zu einer 2000-3000 Wörter umfassenden Synthese.\n2) Füge Zitate im Format [Quelle N] für Kernaussagen ein.\n3) Reduziere Wiederholungen und präsentiere eine klare thematische Struktur.\n\nZwischenzusammenfassungen:\n${summaryText}`,
        fr: `Voici les résumés intermédiaires de la recherche sur \"${topic}\".\n\nExigences :\n1) Fusionnez tous les résumés en une synthèse de 2000-3000 mots.\n2) Incluez des citations au format [Source N] pour les affirmations clés.\n3) Réduisez les répétitions et présentez une structure thématique claire.\n\nRésumés intermédiaires :\n${summaryText}`,
    };
    return prompts[lang] || `Below are intermediate summaries for research on "${topic}".\n\nRequirements:\n1) Merge all summaries into a 2000-3000 word synthesis.\n2) Keep inline citations in [Source N] format for key claims.\n3) Reduce repetition and present a clear thematic structure.\n\nIntermediate summaries:\n${summaryText}`;
}

/** 추가 탐색 필요 여부 판단 프롬프트 */
function getNeedMorePrompt(lang: string, topic: string, currentFindings: string[], sourceCount: number): string {
    const findings = currentFindings.join('\n\n---\n\n');
    const prompts: Record<string, string> = {
        ko: `"${topic}" 연구에서 현재까지 수집된 합성 결과는 아래와 같습니다.\n\n${findings}\n\n현재 고유 소스 수: ${sourceCount}\n\n질문: 아직 추가 탐색이 필요한가요? "yes" 또는 "no"로만 답하세요.`,
        ja: `「${topic}」研究で現在までに収集された合成結果は以下の通りです。\n\n${findings}\n\n現在のユニークソース数: ${sourceCount}\n\n質問: さらなる探索が必要ですか？ "yes" または "no" でのみ答えてください。`,
        zh: `“${topic}”研究中目前收集的合成结果如下。\n\n${findings}\n\n当前独立来源数: ${sourceCount}\n\n问题: 还需要更多探索吗？请仅回答 "yes" 或 "no"。`,
        es: `Los resultados de síntesis recopilados hasta ahora para la investigación sobre "${topic}" son los siguientes.\n\n${findings}\n\nFuentes únicas actuales: ${sourceCount}\n\nPregunta: ¿Se necesita más exploración? Responde solo "yes" o "no".`,
        de: `Die bisherigen Synthese-Ergebnisse der Recherche über "${topic}" sind wie folgt.\n\n${findings}\n\nAktuelle eindeutige Quellen: ${sourceCount}\n\nFrage: Ist weitere Erkundung erforderlich? Antworten Sie nur mit "yes" oder "no".`,
        fr: `Les résultats de synthèse recueillis jusqu'à présent pour la recherche sur \"${topic}\" sont les suivants.\n\n${findings}\n\nSources uniques actuelles : ${sourceCount}\n\nQuestion : Une exploration supplémentaire est-elle nécessaire ? Répondez uniquement par \"yes\" ou \"no\".`,
    };
    return prompts[lang] || `The following synthesis has been collected for research on "${topic}".\n\n${findings}\n\nCurrent unique source count: ${sourceCount}\n\nQuestion: Is more exploration needed? Answer only "yes" or "no".`;
}

/** 최종 보고서 생성 프롬프트 */
function getReportPrompt(lang: string, topic: string, subTopicGuide: string, findings: string[], sourceList: string): string {
    const h = getSectionHeaders(lang);
    const findingsText = findings.join('\n\n---\n\n');
    const prompts: Record<string, string> = {
        ko: `"${topic}"에 대한 심층 연구 최종 보고서를 작성하세요.\n\n절대 축약하지 마세요. 충분히 상세하게 작성하세요. 모든 출처를 인용하세요.\n\n출력 요구사항:\n1) 종합 요약: 500-800 단어\n2) 주요 발견사항: 10-20개 번호 목록, 각 항목은 2-3문장\n3) 상세 분석: 아래 서브 토픽 구조를 기반으로 총 3000-5000 단어\n4) 참고 자료: 모든 고유 소스를 번호 목록으로 작성 ([N] Title - URL)\n5) 본문 모든 핵심 주장에 [출처 N] 형태의 인라인 인용 포함\n\n서브 토픽 구조:\n${subTopicGuide}\n\n중간 합성 결과:\n${findingsText}\n\n전체 소스 목록:\n${sourceList}\n\n다음 섹션 헤더를 유지하세요:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        ja: `「${topic}」についての深層研究最終報告書を作成してください。\n\n絶対に省略しないでください。十分に詳細に記述してください。\n\n出力要件:\n1) 総合概要: 500-800語\n2) 主な発見: 10-20項目の番号付きリスト、各項目2-3文\n3) 詳細分析: サブトピック構造に基づき合計3000-5000語\n4) 参考資料: 全ユニークソースを番号付きリストで\n5) 本文の全ての主要主張に[出典 N]形式のインライン引用を含む\n\nサブトピック構造:\n${subTopicGuide}\n\n中間合成結果:\n${findingsText}\n\n全ソースリスト:\n${sourceList}\n\n次のセクションヘッダーを維持してください:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        zh: `请撰写关于“${topic}”的深度研究最终报告。\n\n不要缩写。充分详细地写。引用所有来源。\n\n输出要求:\n1) 综合摘要: 500-800字\n2) 主要发现: 10-20个编号项目，每项2-3句\n3) 详细分析: 基于子主题结构共计3000-5000字\n4) 参考资料: 所有独立来源编号列表\n5) 正文中所有关键论点包含[来源 N]形式的内联引用\n\n子主题结构:\n${subTopicGuide}\n\n中间合成结果:\n${findingsText}\n\n全部来源列表:\n${sourceList}\n\n请保持以下章节标题:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        es: `Escribe un informe final de investigación profunda sobre "${topic}".\n\nNo abrevies. Escribe con todo detalle. Cita todas las fuentes.\n\nRequisitos de salida:\n1) Resumen ejecutivo: 500-800 palabras\n2) Hallazgos clave: 10-20 ítems numerados, 2-3 oraciones cada uno\n3) Análisis detallado: 3000-5000 palabras basado en subtemas\n4) Referencias: todas las fuentes como lista numerada\n5) Citas en línea [Fuente N] para todas las afirmaciones\n\nEstructura de subtemas:\n${subTopicGuide}\n\nSíntesis intermedia:\n${findingsText}\n\nLista completa de fuentes:\n${sourceList}\n\nMantén estos encabezados:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        de: `Erstellen Sie einen abschließenden Tiefenrecherche-Bericht über "${topic}".\n\nNicht kürzen. Ausführlich schreiben. Alle Quellen zitieren.\n\nAusgabeanforderungen:\n1) Zusammenfassung: 500-800 Wörter\n2) Wichtige Erkenntnisse: 10-20 nummerierte Punkte, je 2-3 Sätze\n3) Detailanalyse: 3000-5000 Wörter basierend auf Unterthemen\n4) Referenzen: alle Quellen als nummerierte Liste\n5) Inline-Zitate [Quelle N] für alle Kernaussagen\n\nUnterthemen-Struktur:\n${subTopicGuide}\n\nZwischensynthese:\n${findingsText}\n\nVollständige Quellenliste:\n${sourceList}\n\nBehalten Sie diese Abschnittsüberschriften bei:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        fr: `Rédigez un rapport final de recherche approfondie sur \"${topic}\".\n\nNe pas abréger. Écrivez en détail. Citez toutes les sources.\n\nExigences de sortie :\n1) Résumé exécutif : 500-800 mots\n2) Découvertes clés : 10-20 éléments numérotés, 2-3 phrases chacun\n3) Analyse détaillée : 3000-5000 mots basés sur les sous-thèmes\n4) Références : toutes les sources en liste numérotée\n5) Citations en ligne [Source N] pour toutes les affirmations clés\n\nStructure des sous-thèmes :\n${subTopicGuide}\n\nSynthèse intermédiaire :\n${findingsText}\n\nListe complète des sources :\n${sourceList}\n\nConservez ces en-têtes de section :\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
    };
    return prompts[lang] || `Write a final deep-research report on "${topic}".\n\nDo not abbreviate. Write with full detail. Cite all sources.\n\nOutput requirements:\n1) Executive Summary: 500-800 words\n2) Key findings: 10-20 numbered findings, each 2-3 sentences\n3) Detailed analysis: 3000-5000 words total, structured by the subtopics below\n4) References: all unique sources as numbered list ([N] Title - URL)\n5) Inline citations in [Source N] format for all core claims\n\nSubtopic structure:\n${subTopicGuide}\n\nIntermediate synthesis:\n${findingsText}\n\nFull source list:\n${sourceList}\n\nKeep these section headers:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`;
}

/** 리서치 진행/에러 메시지 다국어 매핑 */
const RESEARCH_MESSAGES: Record<string, Record<string, string>> = {
    init: {
        ko: '리서치를 시작합니다...',
        en: 'Starting research...',
        ja: 'リサーチを開始します...',
        zh: '开始研究...',
        es: 'Iniciando investigación...',
        de: 'Recherche wird gestartet...',
        fr: 'Démarrage de la recherche...',
    },
    analyzing: {
        ko: '주제를 분석 중...',
        en: 'Analyzing topic...',
        ja: 'トピックを分析中...',
        zh: '正在分析主题...',
        es: 'Analizando tema...',
        de: 'Thema wird analysiert...',
        fr: 'Analyse du sujet en cours...',
    },
    subtopicsComplete: {
        ko: '{count}개 서브 토픽 추출 완료',
        en: '{count} subtopics extracted',
        ja: '{count}個のサブトピック抽出完了',
        zh: '已提取{count}个子主题',
        es: '{count} subtemas extraídos',
        de: '{count} Unterthemen extrahiert',
        fr: '{count} sous-thèmes extraits',
    },
    loopSearching: {
        ko: '루프 {loop}: 웹 검색 중...',
        en: 'Loop {loop}: Searching web...',
        ja: 'ループ {loop}: ウェブ検索中...',
        zh: '循环 {loop}: 正在搜索网页...',
        es: 'Bucle {loop}: Buscando en la web...',
        de: 'Schleife {loop}: Websuche...',
        fr: 'Boucle {loop} : Recherche web en cours...',
    },
    loopSearchComplete: {
        ko: '루프 {loop}: 검색 완료 ({newCount}개 신규, 누적 {totalCount}/{maxSources} 소스)',
        en: 'Loop {loop}: Search complete ({newCount} new, {totalCount}/{maxSources} total sources)',
        ja: 'ループ {loop}: 検索完了 (新規{newCount}件, 累計{totalCount}/{maxSources}ソース)',
        zh: '循环 {loop}: 搜索完成 (新增{newCount}个, 累计{totalCount}/{maxSources}个来源)',
        es: 'Bucle {loop}: Búsqueda completa ({newCount} nuevas, {totalCount}/{maxSources} fuentes totales)',
        de: 'Schleife {loop}: Suche abgeschlossen ({newCount} neue, {totalCount}/{maxSources} Quellen gesamt)',
        fr: 'Boucle {loop} : Recherche terminée ({newCount} nouvelles, {totalCount}/{maxSources} sources au total)',
    },
    loopScraping: {
        ko: '루프 {loop}: Firecrawl 스크래핑 준비 ({scrapedCount}/{maxSources} 소스)',
        en: 'Loop {loop}: Preparing Firecrawl scraping ({scrapedCount}/{maxSources} sources)',
        ja: 'ループ {loop}: Firecrawlスクレイピング準備 ({scrapedCount}/{maxSources}ソース)',
        zh: '循环 {loop}: 准备Firecrawl抓取 ({scrapedCount}/{maxSources}来源)',
        es: 'Bucle {loop}: Preparando scraping Firecrawl ({scrapedCount}/{maxSources} fuentes)',
        de: 'Schleife {loop}: Firecrawl-Scraping vorbereiten ({scrapedCount}/{maxSources} Quellen)',
        fr: 'Boucle {loop} : Préparation du scraping Firecrawl ({scrapedCount}/{maxSources} sources)',
    },
    loopSynthesizing: {
        ko: '루프 {loop}: 정보 합성 중...',
        en: 'Loop {loop}: Synthesizing information...',
        ja: 'ループ {loop}: 情報を合成中...',
        zh: '循环 {loop}: 正在合成信息...',
        es: 'Bucle {loop}: Sintetizando información...',
        de: 'Schleife {loop}: Informationen werden zusammengefasst...',
        fr: 'Boucle {loop} : Synthèse des informations en cours...',
    },
    loopSynthComplete: {
        ko: '루프 {loop}: 합성 완료 ({sourceCount}개 소스 반영)',
        en: 'Loop {loop}: Synthesis complete ({sourceCount} sources reflected)',
        ja: 'ループ {loop}: 合成完了 ({sourceCount}ソース反映)',
        zh: '循环 {loop}: 合成完成 (反映{sourceCount}个来源)',
        es: 'Bucle {loop}: Síntesis completa ({sourceCount} fuentes reflejadas)',
        de: 'Schleife {loop}: Synthese abgeschlossen ({sourceCount} Quellen berücksichtigt)',
        fr: 'Boucle {loop} : Synthèse terminée ({sourceCount} sources prises en compte)',
    },
    generatingReport: {
        ko: '최종 보고서 생성 중...',
        en: 'Generating final report...',
        ja: '最終レポートを生成中...',
        zh: '正在生成最终报告...',
        es: 'Generando informe final...',
        de: 'Abschlussbericht wird erstellt...',
        fr: 'Génération du rapport final en cours...',
    },
    completed: {
        ko: '리서치 완료!',
        en: 'Research complete!',
        ja: 'リサーチ完了！',
        zh: '研究完成！',
        es: '¡Investigación completa!',
        de: 'Recherche abgeschlossen!',
        fr: 'Recherche terminée !',
    },
    cancelled: {
        ko: '리서치가 취소되었습니다.',
        en: 'Research has been cancelled.',
        ja: 'リサーチがキャンセルされました。',
        zh: '研究已取消。',
        es: 'La investigación ha sido cancelada.',
        de: 'Recherche wurde abgebrochen.',
        fr: 'La recherche a été annulée.',
    },
    noSources: {
        ko: '수집된 소스가 없습니다.',
        en: 'No sources collected.',
        ja: '収集されたソースがありません。',
        zh: '没有收集到来源。',
        es: 'No se recopilaron fuentes.',
        de: 'Keine Quellen gesammelt.',
        fr: 'Aucune source collectée.',
    },
    synthesisFailed: {
        ko: '합성 실패',
        en: 'Synthesis failed',
        ja: '合成失敗',
        zh: '合成失败',
        es: 'Síntesis fallida',
        de: 'Synthese fehlgeschlagen',
        fr: 'Échec de la synthèse',
    },
    reportFailed: {
        ko: '보고서 생성 실패',
        en: 'Report generation failed',
        ja: 'レポート生成失敗',
        zh: '报告生成失败',
        es: 'Error al generar informe',
        de: 'Berichterstellung fehlgeschlagen',
        fr: 'Échec de la génération du rapport',
    },
    subtopicParseFailed: {
        ko: '서브 토픽 JSON 파싱 실패',
        en: 'Subtopic JSON parsing failed',
        ja: 'サブトピックJSONパース失敗',
        zh: '子主题JSON解析失败',
        es: 'Error al analizar JSON de subtemas',
        de: 'Unterthemen-JSON-Parsing fehlgeschlagen',
        fr: 'Échec de l\'analyse JSON des sous-thèmes',
    },
};

export function getResearchMessage(key: string, lang: string, vars?: Record<string, string | number>): string {
    const messages = RESEARCH_MESSAGES[key];
    if (!messages) return key;
    let msg = messages[lang] || messages['en'] || key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            msg = msg.replace(`{${k}}`, String(v));
        }
    }
    return msg;
}

// ============================================================
// DeepResearchService 클래스
// ============================================================

export class DeepResearchService {
    private client: OllamaClient;
    private config: ResearchConfig;
    private abortController: AbortController | null = null;

    constructor(config?: Partial<ResearchConfig>) {
        this.config = { ...globalConfig, ...config };
        this.client = createClient({ model: this.config.llmModel });
    }

    /**
     * 리서치 실행 (메인 엔트리포인트)
     */
    async executeResearch(
        sessionId: string,
        topic: string,
        onProgress?: (progress: ResearchProgress) => void
    ): Promise<ResearchResult> {
        const startTime = Date.now();
        const db = getUnifiedDatabase();
        this.abortController = new AbortController();

        logger.info(`[DeepResearch] 시작: ${topic} (세션: ${sessionId})`);

        try {
            this.throwIfAborted();
            await db.updateResearchSession(sessionId, { status: 'running', progress: 0 });
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, '초기화', 0, getResearchMessage('init', this.config.language));

            // 1단계: 주제 분해 (0-5%)
            this.throwIfAborted();
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, 'decompose', 2, getResearchMessage('analyzing', this.config.language));
            const subTopics = await this.decomposeTopics(topic, sessionId);
            await db.updateResearchSession(sessionId, { progress: 5 });
            this.reportProgress(
                onProgress,
                sessionId,
                'running',
                0,
                this.config.maxLoops,
                'decompose',
                5,
                getResearchMessage('subtopicsComplete', this.config.language, { count: subTopics.length })
            );

            // 2단계: 반복 리서치 루프 (5-85%)
            const sourceMap = new Map<string, SearchResult>();
            const seenUrls = new Set<string>();
            const scrapedUrls = new Set<string>();
            const allFindings: string[] = [];

            for (let loop = 0; loop < this.config.maxLoops; loop++) {
                this.throwIfAborted();
                const loopNumber = loop + 1;
                const loopRange = getLoopProgressRange(loop, this.config.maxLoops);

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'search',
                    loopRange.searchStart,
                    getResearchMessage('loopSearching', this.config.language, { loop: loopNumber })
                );

                const newlyDiscovered = await this.searchSubTopics(
                    subTopics,
                    sessionId,
                    loopNumber,
                    sourceMap,
                    seenUrls
                );
                this.throwIfAborted();

                const uniqueSources = Array.from(sourceMap.values());
                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'search',
                    loopRange.searchEnd,
                    getResearchMessage('loopSearchComplete', this.config.language, {
                        loop: loopNumber,
                        newCount: newlyDiscovered.length,
                        totalCount: uniqueSources.length,
                        maxSources: this.config.maxTotalSources
                    })
                );

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'scrape',
                    loopRange.scrapeStart,
                    getResearchMessage('loopScraping', this.config.language, {
                        loop: loopNumber,
                        scrapedCount: scrapedUrls.size,
                        maxSources: this.config.maxTotalSources
                    })
                );

                await this.scrapeSources(
                    uniqueSources,
                    scrapedUrls,
                    sessionId,
                    loopNumber,
                    onProgress,
                    loopRange.scrapeStart,
                    loopRange.scrapeEnd
                );
                this.throwIfAborted();

                const sourcesAfterScrape = Array.from(sourceMap.values());

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'synthesize',
                    loopRange.synthesizeStart,
                    getResearchMessage('loopSynthesizing', this.config.language, { loop: loopNumber })
                );

                const synthesis = await this.synthesizeFindings(topic, sourcesAfterScrape, sessionId, loopNumber);
                allFindings.push(synthesis.summary);
                this.throwIfAborted();

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'synthesize',
                    loopRange.synthesizeEnd,
                    getResearchMessage('loopSynthComplete', this.config.language, {
                        loop: loopNumber,
                        sourceCount: sourcesAfterScrape.length
                    })
                );

                await db.updateResearchSession(sessionId, { progress: Math.round(loopRange.synthesizeEnd) });

                // 목표 소스 수 도달 시 조기 종료
                if (sourcesAfterScrape.length >= this.config.maxTotalSources) {
                    logger.info(`[DeepResearch] 목표 소스 수 도달 (${sourcesAfterScrape.length}/${this.config.maxTotalSources}). 조기 종료.`);
                    break;
                }

                // 마지막 루프가 아니면 추가 필요 여부 판단
                if (loop < this.config.maxLoops - 1) {
                    this.throwIfAborted();
                    const needsMore = await this.checkNeedsMoreInfo(topic, allFindings, sourcesAfterScrape.length);
                    if (!needsMore) {
                        logger.info(`[DeepResearch] 루프 ${loopNumber}에서 충분한 정보 수집. 조기 종료.`);
                        break;
                    }
                }
            }

            const finalSources = deduplicateSources(Array.from(sourceMap.values()));

            // 3단계: 최종 보고서 생성 (85-100%)
            this.throwIfAborted();
            this.reportProgress(onProgress, sessionId, 'running', this.config.maxLoops, this.config.maxLoops, 'report', 85, getResearchMessage('generatingReport', this.config.language));
            const report = await this.generateReport(topic, allFindings, finalSources, subTopics, sessionId);

            await db.updateResearchSession(sessionId, {
                status: 'completed',
                progress: 100,
                summary: report.summary,
                keyFindings: report.keyFindings,
                sources: finalSources.map(source => source.url)
            });

            this.reportProgress(onProgress, sessionId, 'completed', this.config.maxLoops, this.config.maxLoops, 'completed', 100, getResearchMessage('completed', this.config.language));

            const duration = Date.now() - startTime;
            logger.info(`[DeepResearch] 완료: ${topic} (${duration}ms)`);

            return {
                sessionId,
                topic,
                summary: report.summary,
                keyFindings: report.keyFindings,
                sources: finalSources,
                totalSteps: await this.getStepCount(sessionId),
                duration
            };
        } catch (error) {
            if (error instanceof Error && error.message === 'RESEARCH_ABORTED') {
                await db.updateResearchSession(sessionId, {
                    status: 'cancelled',
                    summary: '리서치가 취소되었습니다.'
                });
                this.reportProgress(onProgress, sessionId, 'cancelled', 0, this.config.maxLoops, 'cancelled', 0, getResearchMessage('cancelled', this.config.language));
                throw error;
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`[DeepResearch] 실패: ${errorMessage}`);

            await db.updateResearchSession(sessionId, {
                status: 'failed',
                summary: `리서치 실패: ${errorMessage}`
            });

            this.reportProgress(onProgress, sessionId, 'failed', 0, this.config.maxLoops, 'error', 0, `오류: ${errorMessage}`);

            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 주제를 서브 토픽으로 분해
     */
    private async decomposeTopics(topic: string, sessionId: string): Promise<SubTopic[]> {
        this.throwIfAborted();
        const prompt = getDecomposePrompt(this.config.language, topic);

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.3 });
            this.throwIfAborted();

            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                throw new Error(getResearchMessage('subtopicParseFailed', this.config.language));
            }

            const parsed = JSON.parse(jsonMatch[0]) as Array<{ title?: string; searchQueries?: string[]; importance?: number; searchQuery?: string }>;
            const normalized = parsed
                .map(item => {
                    const queriesFromArray = Array.isArray(item.searchQueries)
                        ? item.searchQueries.filter((query): query is string => typeof query === 'string' && query.trim().length > 0).map(query => query.trim())
                        : [];

                    const fallbackQuery = typeof item.searchQuery === 'string' && item.searchQuery.trim().length > 0
                        ? [item.searchQuery.trim()]
                        : [];

                    const mergedQueries = [...queriesFromArray, ...fallbackQuery];
                    const uniqueQueries = Array.from(new Set(mergedQueries));

                    if (!item.title || uniqueQueries.length === 0) {
                        return null;
                    }

                    return {
                        title: item.title,
                        searchQueries: uniqueQueries.slice(0, CAPACITY.RESEARCH_MAX_SEARCH_QUERIES),
                        importance: clampImportance(item.importance)
                    } satisfies SubTopic;
                })
                .filter((item): item is SubTopic => item !== null)
                .sort((a, b) => b.importance - a.importance)
                .slice(0, CAPACITY.RESEARCH_MAX_TOTAL_SOURCES);

            const finalSubTopics = normalized.length >= 8 ? normalized : buildFallbackSubTopics(topic);

            const db = getUnifiedDatabase();
            await db.addResearchStep({
                sessionId,
                stepNumber: 1,
                stepType: 'decompose',
                query: topic,
                result: JSON.stringify(finalSubTopics),
                status: 'completed'
            });

            return finalSubTopics;
        } catch (error) {
            logger.error(`[DeepResearch] 주제 분해 실패: ${error instanceof Error ? error.message : String(error)}`);
            return buildFallbackSubTopics(topic);
        }
    }

    /**
     * 서브 토픽에 대해 웹 검색 수행
     */
    private async searchSubTopics(
        subTopics: SubTopic[],
        sessionId: string,
        loopNumber: number,
        sourceMap: Map<string, SearchResult>,
        seenUrls: Set<string>
    ): Promise<SearchResult[]> {
        this.throwIfAborted();
        const db = getUnifiedDatabase();
        const discoveredResults: SearchResult[] = [];

        const averageQueriesPerTopic = Math.max(
            1,
            Math.round(
                subTopics.reduce((sum, topic) => sum + topic.searchQueries.length, 0) / Math.max(subTopics.length, 1)
            )
        );

        const denominator = Math.max(subTopics.length * averageQueriesPerTopic, 1);
        const resultsPerQuery = Math.max(15, Math.ceil(this.config.maxSearchResults / denominator));

        let stepIndex = 0;

        for (const subTopic of subTopics) {
            this.throwIfAborted();
            for (const query of subTopic.searchQueries) {
                this.throwIfAborted();
                try {
                    const results = await performWebSearch(query, {
                        maxResults: resultsPerQuery,
                        useOllamaFirst: this.config.searchApi === 'ollama' || this.config.searchApi === 'all',
                        useFirecrawl: this.config.searchApi === 'firecrawl' || this.config.searchApi === 'all',
                        language: this.config.language
                    });

                    const uniqueForQuery: SearchResult[] = [];
                    for (const result of results) {
                        if (!result.url) {
                            continue;
                        }

                        const normalizedUrl = normalizeUrl(result.url);
                        if (seenUrls.has(normalizedUrl)) {
                            continue;
                        }

                        seenUrls.add(normalizedUrl);
                        sourceMap.set(normalizedUrl, result);
                        discoveredResults.push(result);
                        uniqueForQuery.push(result);

                        if (sourceMap.size >= this.config.maxTotalSources) {
                            break;
                        }
                    }

                    await db.addResearchStep({
                        sessionId,
                        stepNumber: loopNumber * 100 + (++stepIndex),
                        stepType: 'search',
                        query,
                        result: `${results.length}개 검색, ${uniqueForQuery.length}개 신규 확보`,
                        sources: uniqueForQuery.slice(0, CAPACITY.RESEARCH_MAX_SOURCES_PER_QUERY).map(item => item.url),
                        status: 'completed'
                    });

                    if (sourceMap.size >= this.config.maxTotalSources) {
                        return discoveredResults;
                    }
                } catch (error) {
                    logger.warn(`[DeepResearch] 검색 실패 (${query}): ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        return discoveredResults;
    }

    /**
     * Firecrawl로 풀 콘텐츠 스크래핑
     */
    private async scrapeSources(
        sources: SearchResult[],
        scrapedUrls: Set<string>,
        sessionId: string,
        loopNumber: number,
        onProgress: ((progress: ResearchProgress) => void) | undefined,
        progressStart: number,
        progressEnd: number
    ): Promise<void> {
        this.throwIfAborted();
        if (!this.config.scrapeFullContent) {
            return;
        }

        if (!isFirecrawlConfigured()) {
            logger.warn('[DeepResearch] Firecrawl API 키 미설정으로 스크래핑을 건너뜁니다.');
            return;
        }

        const scrapeCandidates = sources
            .filter(source => {
                if (!source.url) {
                    return false;
                }
                const normalizedUrl = normalizeUrl(source.url);
                return !scrapedUrls.has(normalizedUrl);
            })
            .slice(0, this.config.maxScrapePerLoop);

        if (scrapeCandidates.length === 0) {
            return;
        }

        const totalTarget = this.config.maxTotalSources;
        const totalToScrape = scrapeCandidates.length;
        let finished = 0;

        for (let i = 0; i < scrapeCandidates.length; i += 5) {
            this.throwIfAborted();
            const batch = scrapeCandidates.slice(i, i + 5);

            const settled = await Promise.allSettled(
                batch.map(async source => {
                    const normalizedUrl = normalizeUrl(source.url);
                    try {
                        const markdown = await this.scrapeSingleUrl(source.url);
                        if (markdown && markdown.trim().length > 0) {
                            source.fullContent = markdown;
                        }
                    } catch (error) {
                        logger.warn(`[DeepResearch] 스크래핑 실패 (${source.url}): ${error instanceof Error ? error.message : String(error)}`);
                    } finally {
                        scrapedUrls.add(normalizedUrl);
                    }
                })
            );

            finished += settled.length;
            const currentProgress = progressStart + ((finished / Math.max(totalToScrape, 1)) * (progressEnd - progressStart));
            this.reportProgress(
                onProgress,
                sessionId,
                'running',
                loopNumber,
                this.config.maxLoops,
                'scrape',
                currentProgress,
                `Firecrawl 스크래핑: ${Math.min(scrapedUrls.size, totalTarget)}/${totalTarget} 소스`
            );

            logger.info(`[DeepResearch] 스크래핑 진행: ${Math.min(scrapedUrls.size, totalTarget)}/${totalTarget} 소스`);
        }

        const db = getUnifiedDatabase();
        await db.addResearchStep({
            sessionId,
            stepNumber: loopNumber * 100 + 99,
            stepType: 'search',
            query: `루프 ${loopNumber} Firecrawl 스크래핑`,
            result: `${totalToScrape}개 URL 스크래핑 완료`,
            sources: scrapeCandidates.map(item => item.url),
            status: 'completed'
        });
    }

    /**
     * 단일 URL 스크래핑
     */
    private async scrapeSingleUrl(url: string): Promise<string> {
        this.throwIfAborted();
        const { firecrawlApiUrl, firecrawlApiKey } = getConfig();

        if (!firecrawlApiKey) {
            throw new Error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
        }

        // Abort signal 결합: 글로벌 연구 중단 + 개별 타임아웃
        const controller = new AbortController();
        const globalAbortSignal = this.abortController?.signal;
        const forwardAbort = () => controller.abort();
        if (globalAbortSignal) {
            if (globalAbortSignal.aborted) {
                throw new Error('RESEARCH_ABORTED');
            }
            globalAbortSignal.addEventListener('abort', forwardAbort);
        }
        const timeoutHandle = setTimeout(() => controller.abort(), this.config.scrapeTimeoutMs + 1000);

        try {
            const payload = await firecrawlPost({
                apiUrl: firecrawlApiUrl,
                apiKey: firecrawlApiKey,
                endpoint: '/scrape',
                data: {
                    url,
                    formats: ['markdown'],
                    onlyMainContent: true,
                    timeout: this.config.scrapeTimeoutMs
                },
                signal: controller.signal
            }) as { data?: { markdown?: string } };

            return payload.data?.markdown ?? '';
        } finally {
            if (globalAbortSignal) {
                globalAbortSignal.removeEventListener('abort', forwardAbort);
            }
            clearTimeout(timeoutHandle);
        }
    }

    /**
     * 검색 결과를 청크로 나눠 LLM 합성
     */
    private async synthesizeFindings(
        topic: string,
        searchResults: SearchResult[],
        sessionId: string,
        loopNumber: number
    ): Promise<SynthesisResult> {
        this.throwIfAborted();
        const db = getUnifiedDatabase();

        if (searchResults.length === 0) {
            return { summary: getResearchMessage('noSources', this.config.language), keyPoints: [] };
        }

        const uniqueResults = deduplicateSources(searchResults);
        const chunks = chunkArray(uniqueResults, this.config.chunkSize);
        const chunkSummaries: string[] = [];

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            this.throwIfAborted();
            const chunk = chunks[chunkIndex];
            const chunkContext = chunk
                .map(source => {
                    const sourceIndex = uniqueResults.findIndex(item => normalizeUrl(item.url) === normalizeUrl(source.url)) + 1;
                    const content = source.fullContent?.trim().length
                        ? source.fullContent
                        : source.snippet;
                    const compactContent = content.length > TRUNCATION.RESEARCH_CONTENT_MAX ? `${content.slice(0, TRUNCATION.RESEARCH_CONTENT_MAX)}\n...(중략)` : content;

                    return `[출처 ${sourceIndex}] ${source.title}\nURL: ${source.url}\n내용:\n${compactContent}`;
                })
                .join('\n\n');

            const chunkPrompt = getChunkSummaryPrompt(this.config.language, topic, chunkIndex, chunks.length, chunkContext);

            try {
                const response = await this.client.chat([
                    { role: 'user', content: chunkPrompt }
                ], { temperature: 0.35 });
                this.throwIfAborted();
                chunkSummaries.push(response.content.trim());
            } catch (error) {
                logger.error(`[DeepResearch] 청크 요약 실패 (${chunkIndex + 1}/${chunks.length}): ${error instanceof Error ? error.message : String(error)}`);
                chunkSummaries.push('청크 요약 실패');
            }
        }

        const mergedPrompt = getMergePrompt(this.config.language, topic, chunkSummaries);

        try {
            const response = await this.client.chat([
                { role: 'user', content: mergedPrompt }
            ], { temperature: 0.4 });
            this.throwIfAborted();

            const mergedSummary = response.content.trim();
            const keyPoints = extractBulletLikeFindings(mergedSummary);

            await db.addResearchStep({
                sessionId,
                stepNumber: loopNumber * 100 + 100,
                stepType: 'synthesize',
                query: `루프 ${loopNumber} 합성`,
                result: mergedSummary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
                status: 'completed'
            });

            return { summary: mergedSummary, keyPoints };
        } catch (error) {
            logger.error(`[DeepResearch] 합성 실패: ${error instanceof Error ? error.message : String(error)}`);
            return { summary: getResearchMessage('synthesisFailed', this.config.language), keyPoints: [] };
        }
    }

    /**
     * 추가 정보가 필요한지 확인
     */
    private async checkNeedsMoreInfo(
        topic: string,
        currentFindings: string[],
        sourceCount: number
    ): Promise<boolean> {
        this.throwIfAborted();
        if (sourceCount < 50) {
            return true;
        }

        const prompt = getNeedMorePrompt(this.config.language, topic, currentFindings, sourceCount);

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.1 });
            this.throwIfAborted();

            return response.content.toLowerCase().includes('yes');
        } catch (error) {
            logger.error(`[DeepResearch] 추가 정보 판단 실패: ${error instanceof Error ? error.message : String(error)}`);
            return sourceCount < this.config.maxTotalSources;
        }
    }

    /**
     * 최종 보고서 생성
     */
    private async generateReport(
        topic: string,
        findings: string[],
        sources: SearchResult[],
        subTopics: SubTopic[],
        sessionId: string
    ): Promise<{ summary: string; keyFindings: string[] }> {
        this.throwIfAborted();
        const db = getUnifiedDatabase();
        const uniqueSources = deduplicateSources(sources);

        const sourceList = uniqueSources
            .map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`)
            .join('\n');

        const subTopicGuide = subTopics
            .map((subTopic, index) => `${index + 1}. ${subTopic.title}`)
            .join('\n');

        const prompt = getReportPrompt(this.config.language, topic, subTopicGuide, findings, sourceList);

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.35 });
            this.throwIfAborted();

            const content = response.content;

            // Build regex matching all language variants for section headers
            const allSummaryHeaders = Object.values(SECTION_HEADERS).map(h => h.summary).join('|');
            const allFindingsHeaders = Object.values(SECTION_HEADERS).map(h => h.findings).join('|');
            const summaryMatch = content.match(new RegExp(`##\s*(?:${allSummaryHeaders})\s*\n([\s\S]*?)(?=##|$)`, 'i'));
            const summary = summaryMatch ? summaryMatch[1].trim() : content;

            const findingsMatch = content.match(new RegExp(`##\s*(?:${allFindingsHeaders})\s*\n([\s\S]*?)(?=##|$)`, 'i'));
            const keyFindings = findingsMatch
                ? findingsMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => /^\d+\./.test(line))
                    .map(line => line.replace(/^\d+\.\s*/, '').trim())
                : extractBulletLikeFindings(summary);

            await db.addResearchStep({
                sessionId,
                stepNumber: 999,
                stepType: 'report',
                query: '최종 보고서 생성',
                result: summary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
                status: 'completed'
            });

            return { summary, keyFindings };
        } catch (error) {
            logger.error(`[DeepResearch] 보고서 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
            return { summary: getResearchMessage('reportFailed', this.config.language), keyFindings: [] };
        }
    }

    /**
     * 스텝 수 조회
     */
    private async getStepCount(sessionId: string): Promise<number> {
        const db = getUnifiedDatabase();
        const steps = await db.getResearchSteps(sessionId);
        return steps.length;
    }

    /**
     * 진행 상황 리포트
     */
    private reportProgress(
        callback: ((progress: ResearchProgress) => void) | undefined,
        sessionId: string,
        status: ResearchProgress['status'],
        currentLoop: number,
        totalLoops: number,
        currentStep: string,
        progress: number,
        message: string
    ): void {
        if (callback) {
            callback({
                sessionId,
                status,
                currentLoop,
                totalLoops,
                currentStep,
                progress,
                message
            });
        }
    }

    /**
     * 리서치 취소
     */
    cancel(): void {
        this.abortController?.abort();
    }

    private throwIfAborted(): void {
        if (this.abortController?.signal.aborted) {
            throw new Error('RESEARCH_ABORTED');
        }
    }
}

// ============================================================
// 모듈 API
// ============================================================

/**
 * 전역 설정 가져오기
 */
export function getResearchConfig(): ResearchConfig {
    return { ...globalConfig };
}

/**
 * 전역 설정 업데이트
 */
export function configureResearch(config: Partial<ResearchConfig>): ResearchConfig {
    const updated = { ...globalConfig, ...config };
    setGlobalConfig(updated);
    logger.info(`[DeepResearch] 설정 업데이트: ${JSON.stringify(updated)}`);
    return { ...updated };
}

/**
 * 서비스 인스턴스 생성
 */
export function createDeepResearchService(config?: Partial<ResearchConfig>): DeepResearchService {
    return new DeepResearchService(config);
}

/**
 * 빠른 리서치 실행 (세션 자동 생성)
 */
export async function quickResearch(
    topic: string,
    userId: string,
    depth: 'quick' | 'standard' | 'deep' = 'standard',
    onProgress?: (progress: ResearchProgress) => void
): Promise<ResearchResult> {
    const db = getUnifiedDatabase();
    const sessionId = uuidv4();

    // 세션 생성 (anonymous/guest userId는 FK 위반 방지를 위해 null 처리)
    const safeUserId = userId && userId !== 'guest' && !userId.startsWith('anon-') && userId !== 'anonymous'
        ? userId : undefined;
    await db.createResearchSession({
        id: sessionId,
        userId: safeUserId,
        topic,
        depth
    });

    // depth에 따른 maxLoops 설정
    const maxLoops = depth === 'quick' ? 1 : depth === 'standard' ? 3 : 5;

    // 리서치 실행
    const service = createDeepResearchService({ maxLoops });
    return service.executeResearch(sessionId, topic, onProgress);
}
