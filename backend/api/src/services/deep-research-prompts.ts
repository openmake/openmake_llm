/**
 * Deep Research - 다국어 프롬프트 및 메시지 매핑
 *
 * DeepResearchService에서 사용하는 섹션 헤더, 프롬프트 템플릿,
 * 진행/에러 메시지의 다국어 매핑을 제공합니다.
 *
 * @module services/deep-research-prompts
 */

// ============================================================
// 다국어 프롬프트 매핑 (ko/en/ja/zh/es/de/fr)
// ============================================================

/** 섹션 헤더 다국어 매핑 */
export const SECTION_HEADERS: Record<string, { summary: string; findings: string; analysis: string; references: string }> = {
    ko: { summary: '종합 요약', findings: '주요 발견사항', analysis: '상세 분석', references: '참고 자료' },
    en: { summary: 'Executive Summary', findings: 'Key Findings', analysis: 'Detailed Analysis', references: 'References' },
    ja: { summary: '総合概要', findings: '主な発見', analysis: '詳細分析', references: '参考資料' },
    zh: { summary: '综合摘要', findings: '主要发现', analysis: '详细分析', references: '参考资料' },
    es: { summary: 'Resumen Ejecutivo', findings: 'Hallazgos Clave', analysis: 'Análisis Detallado', references: 'Referencias' },
    de: { summary: 'Zusammenfassung', findings: 'Wichtige Erkenntnisse', analysis: 'Detailanalyse', references: 'Referenzen' },
    fr: { summary: 'Résumé exécutif', findings: 'Découvertes clés', analysis: 'Analyse détaillée', references: 'Références' },
};

export function getSectionHeaders(lang: string) {
    return SECTION_HEADERS[lang] || SECTION_HEADERS['en']!;
}

/** 주제 분해 프롬프트 */
export function getDecomposePrompt(lang: string, topic: string): string {
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
export function getChunkSummaryPrompt(lang: string, topic: string, chunkIndex: number, totalChunks: number, chunkContext: string): string {
    const header = `(${chunkIndex + 1}/${totalChunks})`;
    const prompts: Record<string, string> = {
        ko: `다음은 "${topic}" 연구용 소스 청크${header}입니다.\n\n요구사항:\n1) 800-1200 단어로 중간 요약을 작성하세요.\n2) 핵심 주장마다 반드시 [출처 N] 형식의 인용을 포함하세요.\n3) 불확실한 정보는 단정하지 말고 출처 근거 중심으로 작성하세요.\n\n소스:\n${chunkContext}`,
        ja: `以下は「${topic}」研究用のソースチャンク${header}です。\n\n要件:\n1) 800-1200語で中間要約を作成してください。\n2) 主要な主張には必ず[出典 N]形式の引用を含めてください。\n3) 不確実な情報は断定せず、エビデンスベースで記述してください。\n\nソース:\n${chunkContext}`,
        zh: `以下是"${topic}"研究用源块${header}。\n\n要求:\n1) 用800-1200字编写中间摘要。\n2) 关键论点必须包含[来源 N]格式的引用。\n3) 不确定的信息不要下定论，以证据为基础。\n\n源:\n${chunkContext}`,
        es: `Este es un fragmento de fuentes ${header} para la investigación sobre "${topic}".\n\nRequisitos:\n1) Escribe un resumen intermedio de 800-1200 palabras.\n2) Incluye citas en formato [Fuente N] para afirmaciones clave.\n3) Mantén un lenguaje basado en evidencias.\n\nFuentes:\n${chunkContext}`,
        de: `Dies ist ein Quellen-Chunk ${header} für die Recherche über "${topic}".\n\nAnforderungen:\n1) Schreiben Sie eine Zwischenzusammenfassung von 800-1200 Wörtern.\n2) Fügen Sie Zitate im Format [Quelle N] für Kernaussagen ein.\n3) Bleiben Sie evidenzbasiert.\n\nQuellen:\n${chunkContext}`,
        fr: `Ceci est un bloc de sources ${header} pour la recherche sur \"${topic}\".\n\nExigences :\n1) Rédigez un résumé intermédiaire de 800-1200 mots.\n2) Incluez des citations au format [Source N] pour les affirmations clés.\n3) Restez fondé sur les preuves.\n\nSources :\n${chunkContext}`,
    };
    return prompts[lang] || `This is a source chunk ${header} for research on "${topic}".\n\nRequirements:\n1) Write an intermediate summary in 800-1200 words.\n2) Include citations in [Source N] format for key claims.\n3) Keep evidence-driven language and avoid unsupported certainty.\n\nSources:\n${chunkContext}`;
}

/** 경량 청크 요약 프롬프트 (콘텐츠 부족 시 사용) */
export function getLightweightChunkSummaryPrompt(lang: string, topic: string, chunkIndex: number, totalChunks: number, chunkContext: string): string {
    const header = `(${chunkIndex + 1}/${totalChunks})`;
    const prompts: Record<string, string> = {
        ko: `다음은 "${topic}" 연구용 소스 청크${header}입니다.\n\n주의: 소스 콘텐츠가 제한적(스니펫 수준)입니다.\n\n요구사항:\n1) 사용 가능한 정보만으로 200-400 단어의 간결한 요약을 작성하세요.\n2) 출처가 있는 정보만 포함하고 추측하지 마세요.\n3) 핵심 주장마다 [출처 N] 형식의 인용을 포함하세요.\n4) 정보가 부족한 부분은 "추가 조사 필요"로 표시하세요.\n\n소스:\n${chunkContext}`,
        ja: `以下は「${topic}」研究用のソースチャンク${header}です。\n\n注意: ソースコンテンツが限定的（スニペットレベル）です。\n\n要件:\n1) 利用可能な情報のみで200-400語の簡潔な要約を作成。\n2) 出典のある情報のみ含め、推測は禁止。\n3) [出典 N]形式の引用を含める。\n4) 情報不足の部分は「追加調査必要」と表示。\n\nソース:\n${chunkContext}`,
        zh: `以下是"${topic}"研究用源块${header}。\n\n注意: 源内容有限（摘要级别）。\n\n要求:\n1) 仅用可用信息写200-400字简洁摘要。\n2) 只包含有来源的信息，不要推测。\n3) 包含[来源 N]格式引用。\n4) 信息不足部分标注"需进一步调查"。\n\n源:\n${chunkContext}`,
        es: `Este es un fragmento de fuentes ${header} para la investigación sobre "${topic}".\n\nNota: El contenido de las fuentes es limitado (nivel de fragmento).\n\nRequisitos:\n1) Escribe un resumen conciso de 200-400 palabras solo con la información disponible.\n2) Solo incluye información con fuente, no especules.\n3) Incluye citas en formato [Fuente N].\n4) Marca las áreas con información insuficiente como "requiere investigación adicional".\n\nFuentes:\n${chunkContext}`,
        de: `Dies ist ein Quellen-Chunk ${header} für die Recherche über "${topic}".\n\nHinweis: Der Quellinhalt ist begrenzt (Snippet-Niveau).\n\nAnforderungen:\n1) Schreiben Sie eine knappe Zusammenfassung von 200-400 Wörtern nur mit verfügbaren Informationen.\n2) Nur belegte Informationen, keine Spekulation.\n3) Zitate im Format [Quelle N].\n4) Kennzeichnen Sie Lücken mit „weitere Untersuchung erforderlich".\n\nQuellen:\n${chunkContext}`,
        fr: `Ceci est un bloc de sources ${header} pour la recherche sur \"${topic}\".\n\nNote : Le contenu des sources est limité (niveau extrait).\n\nExigences :\n1) Rédigez un résumé concis de 200-400 mots uniquement avec les informations disponibles.\n2) N'incluez que les informations sourcées, pas de spéculation.\n3) Citations au format [Source N].\n4) Marquez les lacunes par \"investigation supplémentaire nécessaire\".\n\nSources :\n${chunkContext}`,
    };
    return prompts[lang] || `This is a source chunk ${header} for research on "${topic}".\n\nNote: Source content is limited (snippet-level only).\n\nRequirements:\n1) Write a concise summary in 200-400 words using only available information.\n2) Only include sourced information, do not speculate.\n3) Include citations in [Source N] format.\n4) Mark areas with insufficient information as "further investigation needed".\n\nSources:\n${chunkContext}`;
}

/** 청크 병합 프롬프트 */
export function getMergePrompt(lang: string, topic: string, chunkSummaries: string[]): string {
    const summaryText = chunkSummaries.map((s, i) => `### Chunk ${i + 1}\n${s}`).join('\n\n');
    const prompts: Record<string, string> = {
        ko: `다음은 "${topic}" 연구의 중간 요약들입니다.\n\n요구사항:\n1) 모든 중간 요약을 통합해 2000-3000 단어의 종합 합성문을 작성하세요.\n2) 핵심 주장마다 [출처 N] 형식의 인용을 반드시 포함하세요.\n3) 반복을 줄이고, 주제별 구조를 명확히 정리하세요.\n\n중간 요약:\n${summaryText}`,
        ja: `以下は「${topic}」研究の中間要約です。\n\n要件:\n1) すべての中間要約を統合し2000-3000語の総合合成を作成してください。\n2) 主要な主張に[出典 N]形式の引用を含めてください。\n3) 重複を減らし、テーマ別に明確に構成してください。\n\n中間要約:\n${summaryText}`,
        zh: `以下是"${topic}"研究的中间摘要。\n\n要求:\n1) 合并所有中间摘要，写成2000-3000字的综合分析。\n2) 关键论点必须包含[来源 N]格式的引用。\n3) 减少重复，按主题清晰组织。\n\n中间摘要:\n${summaryText}`,
        es: `A continuación se presentan los resúmenes intermedios de la investigación sobre "${topic}".\n\nRequisitos:\n1) Fusiona todos los resúmenes en una síntesis de 2000-3000 palabras.\n2) Incluye citas en formato [Fuente N] para afirmaciones clave.\n3) Reduce la repetición y presenta una estructura temática clara.\n\nResúmenes intermedios:\n${summaryText}`,
        de: `Nachfolgend die Zwischenzusammenfassungen der Recherche über "${topic}".\n\nAnforderungen:\n1) Vereinige alle Zusammenfassungen zu einer 2000-3000 Wörter umfassenden Synthese.\n2) Füge Zitate im Format [Quelle N] für Kernaussagen ein.\n3) Reduziere Wiederholungen und präsentiere eine klare thematische Struktur.\n\nZwischenzusammenfassungen:\n${summaryText}`,
        fr: `Voici les résumés intermédiaires de la recherche sur \"${topic}\".\n\nExigences :\n1) Fusionnez tous les résumés en une synthèse de 2000-3000 mots.\n2) Incluez des citations au format [Source N] pour les affirmations clés.\n3) Réduisez les répétitions et présentez une structure thématique claire.\n\nRésumés intermédiaires :\n${summaryText}`,
    };
    return prompts[lang] || `Below are intermediate summaries for research on "${topic}".\n\nRequirements:\n1) Merge all summaries into a 2000-3000 word synthesis.\n2) Keep inline citations in [Source N] format for key claims.\n3) Reduce repetition and present a clear thematic structure.\n\nIntermediate summaries:\n${summaryText}`;
}

/** 추가 탐색 필요 여부 판단 프롬프트 */
export function getNeedMorePrompt(lang: string, topic: string, currentFindings: string[], sourceCount: number): string {
    const findings = currentFindings.join('\n\n---\n\n');
    const prompts: Record<string, string> = {
        ko: `"${topic}" 연구에서 현재까지 수집된 합성 결과는 아래와 같습니다.\n\n${findings}\n\n현재 고유 소스 수: ${sourceCount}\n\n질문: 아직 추가 탐색이 필요한가요? "yes" 또는 "no"로만 답하세요.`,
        ja: `「${topic}」研究で現在までに収集された合成結果は以下の通りです。\n\n${findings}\n\n現在のユニークソース数: ${sourceCount}\n\n質問: さらなる探索が必要ですか？ "yes" または "no" でのみ答えてください。`,
        zh: `"${topic}"研究中目前收集的合成结果如下。\n\n${findings}\n\n当前独立来源数: ${sourceCount}\n\n问题: 还需要更多探索吗？请仅回答 "yes" 或 "no"。`,
        es: `Los resultados de síntesis recopilados hasta ahora para la investigación sobre "${topic}" son los siguientes.\n\n${findings}\n\nFuentes únicas actuales: ${sourceCount}\n\nPregunta: ¿Se necesita más exploración? Responde solo "yes" o "no".`,
        de: `Die bisherigen Synthese-Ergebnisse der Recherche über "${topic}" sind wie folgt.\n\n${findings}\n\nAktuelle eindeutige Quellen: ${sourceCount}\n\nFrage: Ist weitere Erkundung erforderlich? Antworten Sie nur mit "yes" oder "no".`,
        fr: `Les résultats de synthèse recueillis jusqu'à présent pour la recherche sur \"${topic}\" sont les suivants.\n\n${findings}\n\nSources uniques actuelles : ${sourceCount}\n\nQuestion : Une exploration supplémentaire est-elle nécessaire ? Répondez uniquement par \"yes\" ou \"no\".`,
    };
    return prompts[lang] || `The following synthesis has been collected for research on "${topic}".\n\n${findings}\n\nCurrent unique source count: ${sourceCount}\n\nQuestion: Is more exploration needed? Answer only "yes" or "no".`;
}

/** 최종 보고서 생성 프롬프트 */
export function getReportPrompt(lang: string, topic: string, subTopicGuide: string, findings: string[], sourceList: string): string {
    const h = getSectionHeaders(lang);
    const findingsText = findings.join('\n\n---\n\n');
    const prompts: Record<string, string> = {
        ko: `"${topic}"에 대한 심층 연구 최종 보고서를 작성하세요.\n\n절대 축약하지 마세요. 충분히 상세하게 작성하세요. 모든 출처를 인용하세요.\n\n## 출력 형식 요구사항\n\n### 전체 구조 (반드시 이 순서와 ## 헤더를 유지):\n\n## ${h.summary}\n- 500-800 단어의 종합 요약\n- 핵심 결론을 > 블록인용으로 강조\n\n## ${h.findings}\n- 10-20개 번호 목록 (1. 2. 3. ...)\n- 각 항목 2-3문장, [출처 N] 인용 포함\n\n## ${h.analysis}\n- 서브 토픽별 ### 소제목으로 구분\n- 총 3000-5000 단어\n- 비교 가능한 항목은 **마크다운 테이블** 사용\n- 핵심 인사이트는 > **블록인용** 활용\n- 대립되는 관점은 명시적으로 대비\n\n## ${h.references}\n- 모든 고유 소스를 번호 목록 ([N] Title - URL)\n\n### 마크다운 스타일 규칙:\n- **굵은 글씨**: 핵심 용어/수치 강조\n- > 블록인용: 주요 결론/인사이트\n- 테이블: 비교 분석 (| 항목 | A | B | 형태)\n- 인라인 인용: 모든 핵심 주장에 [출처 N]\n\n서브 토픽 구조:\n${subTopicGuide}\n\n중간 합성 결과:\n${findingsText}\n\n전체 소스 목록:\n${sourceList}`,
        ja: `「${topic}」についての深層研究最終報告書を作成してください。\n\n絶対に省略しないでください。十分に詳細に記述してください。\n\n出力要件:\n1) 総合概要: 500-800語\n2) 主な発見: 10-20項目の番号付きリスト、各項目2-3文\n3) 詳細分析: サブトピック構造に基づき合計3000-5000語\n4) 参考資料: 全ユニークソースを番号付きリストで\n5) 本文の全ての主要主張に[出典 N]形式のインライン引用を含む\n\nサブトピック構造:\n${subTopicGuide}\n\n中間合成結果:\n${findingsText}\n\n全ソースリスト:\n${sourceList}\n\n次のセクションヘッダーを維持してください:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        zh: `请撰写关于"${topic}"的深度研究最终报告。\n\n不要缩写。充分详细地写。引用所有来源。\n\n输出要求:\n1) 综合摘要: 500-800字\n2) 主要发现: 10-20个编号项目，每项2-3句\n3) 详细分析: 基于子主题结构共计3000-5000字\n4) 参考资料: 所有独立来源编号列表\n5) 正文中所有关键论点包含[来源 N]形式的内联引用\n\n子主题结构:\n${subTopicGuide}\n\n中间合成结果:\n${findingsText}\n\n全部来源列表:\n${sourceList}\n\n请保持以下章节标题:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        es: `Escribe un informe final de investigación profunda sobre "${topic}".\n\nNo abrevies. Escribe con todo detalle. Cita todas las fuentes.\n\nRequisitos de salida:\n1) Resumen ejecutivo: 500-800 palabras\n2) Hallazgos clave: 10-20 ítems numerados, 2-3 oraciones cada uno\n3) Análisis detallado: 3000-5000 palabras basado en subtemas\n4) Referencias: todas las fuentes como lista numerada\n5) Citas en línea [Fuente N] para todas las afirmaciones\n\nEstructura de subtemas:\n${subTopicGuide}\n\nSíntesis intermedia:\n${findingsText}\n\nLista completa de fuentes:\n${sourceList}\n\nMantén estos encabezados:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        de: `Erstellen Sie einen abschließenden Tiefenrecherche-Bericht über "${topic}".\n\nNicht kürzen. Ausführlich schreiben. Alle Quellen zitieren.\n\nAusgabeanforderungen:\n1) Zusammenfassung: 500-800 Wörter\n2) Wichtige Erkenntnisse: 10-20 nummerierte Punkte, je 2-3 Sätze\n3) Detailanalyse: 3000-5000 Wörter basierend auf Unterthemen\n4) Referenzen: alle Quellen als nummerierte Liste\n5) Inline-Zitate [Quelle N] für alle Kernaussagen\n\nUnterthemen-Struktur:\n${subTopicGuide}\n\nZwischensynthese:\n${findingsText}\n\nVollständige Quellenliste:\n${sourceList}\n\nBehalten Sie diese Abschnittsüberschriften bei:\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
        fr: `Rédigez un rapport final de recherche approfondie sur \"${topic}\".\n\nNe pas abréger. Écrivez en détail. Citez toutes les sources.\n\nExigences de sortie :\n1) Résumé exécutif : 500-800 mots\n2) Découvertes clés : 10-20 éléments numérotés, 2-3 phrases chacun\n3) Analyse détaillée : 3000-5000 mots basés sur les sous-thèmes\n4) Références : toutes les sources en liste numérotée\n5) Citations en ligne [Source N] pour toutes les affirmations clés\n\nStructure des sous-thèmes :\n${subTopicGuide}\n\nSynthèse intermédiaire :\n${findingsText}\n\nListe complète des sources :\n${sourceList}\n\nConservez ces en-têtes de section :\n## ${h.summary}\n## ${h.findings}\n## ${h.analysis}\n## ${h.references}`,
    };
    return prompts[lang] || `Write a final deep-research report on "${topic}".\n\nDo not abbreviate. Write with full detail. Cite all sources.\n\n## Output Format\n\n### Structure (keep these ## headers in order):\n\n## ${h.summary}\n- 500-800 word overview\n- Highlight key conclusions with > blockquotes\n\n## ${h.findings}\n- 10-20 numbered items (1. 2. 3. ...)\n- Each 2-3 sentences with [Source N] citations\n\n## ${h.analysis}\n- Use ### subheadings per subtopic\n- 3000-5000 words total\n- Use **markdown tables** for comparisons\n- Use > **blockquotes** for key insights\n- Contrast opposing viewpoints explicitly\n\n## ${h.references}\n- All unique sources as numbered list ([N] Title - URL)\n\n### Markdown style rules:\n- **Bold**: key terms/numbers\n- > Blockquote: major conclusions\n- Tables: comparison analysis (| Item | A | B | format)\n- Inline citations: [Source N] for all key claims\n\nSubtopic structure:\n${subTopicGuide}\n\nIntermediate synthesis:\n${findingsText}\n\nFull source list:\n${sourceList}`;
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
        ko: '루프 {loop}: 웹 스크래핑 준비 ({scrapedCount}/{maxSources} 소스)',
        en: 'Loop {loop}: Preparing web scraping ({scrapedCount}/{maxSources} sources)',
        ja: 'ループ {loop}: ウェブスクレイピング準備 ({scrapedCount}/{maxSources}ソース)',
        zh: '循环 {loop}: 准备网页抓取 ({scrapedCount}/{maxSources}来源)',
        es: 'Bucle {loop}: Preparando web scraping ({scrapedCount}/{maxSources} fuentes)',
        de: 'Schleife {loop}: Web-Scraping vorbereiten ({scrapedCount}/{maxSources} Quellen)',
        fr: 'Boucle {loop} : Préparation du web scraping ({scrapedCount}/{maxSources} sources)',
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
    insufficientContent: {
        ko: '소스 콘텐츠 부족 (스크래핑 실패) — 경량 합성으로 전환',
        en: 'Insufficient source content (scraping failed) — switching to lightweight synthesis',
        ja: 'ソースコンテンツ不足（スクレイピング失敗）— 軽量合成に切替',
        zh: '源内容不足（抓取失败）— 切换到轻量合成',
        es: 'Contenido insuficiente (scraping fallido) — cambiando a síntesis ligera',
        de: 'Unzureichender Quellinhalt (Scraping fehlgeschlagen) — Wechsel zu leichter Synthese',
        fr: 'Contenu insuffisant (scraping échoué) — passage à la synthèse légère',
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
