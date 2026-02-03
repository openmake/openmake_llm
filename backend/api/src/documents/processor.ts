import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/env';
import { ProgressCallback, createProgressEvent } from './progress';

const execAsync = promisify(exec);

export interface DocumentResult {
    filename: string;
    type: string;
    text: string;
    pages?: number;
    info?: Record<string, any>;
}

/**
 * PDF 파일에서 텍스트 추출 (pdf-parse 메인 + OCR 폴백)
 */
export async function extractPdfText(
    filePath: string,
    onProgress?: ProgressCallback
): Promise<DocumentResult> {
    const buffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    let extractedText = '';
    let numPages = 0;

    onProgress?.(createProgressEvent('pdf_parse', 'PDF 텍스트 추출 시도 중...', filename, 10));

    // 1차 시도: pdf-parse (Node.js 환경에서 가장 안정적)
    try {
        // 라이브러리 내부에서 발생하는 지저분한 경고(DOMMatrix, canvas 등)를 숨기기 위해
        // 잠시 console 출력을 억제합니다.
        const originalWarn = console.warn;
        const originalError = console.error;
        console.warn = () => { };
        console.error = () => { };

        try {
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(buffer);

            // 콘솔 복구
            console.warn = originalWarn;
            console.error = originalError;

            if (data.text && data.text.length > 0) {
                extractedText = data.text.trim();
                numPages = data.numpages;
                console.log(`[PDF/텍스트] 추출 성공: ${numPages}페이지, ${extractedText.length}자`);
            }
        } catch (innerError) {
            console.warn = originalWarn;
            console.error = originalError;
            throw innerError;
        }
    } catch (e: unknown) {
        // 텍스트 추출이 불가능한 경우 (이미지 PDF 등)
        console.log('[PDF] 텍스트 레이어가 없습니다. 이미지 정밀 분석(OCR)을 준비합니다...');
        onProgress?.(createProgressEvent('ocr_prepare', 'OCR 프로세스 준비 중...', filename, 20));
    }

    // 2차 시도: OCR (텍스트가 없거나 너무 짧은 경우 - 이미지 PDF 또는 인코딩 문제)
    if (extractedText.length < 100) {
        try {
            console.log(`[PDF/OCR] 텍스트가 부족합니다(${extractedText.length}자). LLM 보정을 위한 OCR 프로세스 시작...`);
            onProgress?.(createProgressEvent('ocr_prepare', `텍스트 부족(${extractedText.length}자). OCR 시작...`, filename, 25));
            const Tesseract = require('tesseract.js');

            // 임시 디렉토리 생성
            const tempDir = path.join(path.dirname(filePath), `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            try {
                // pdftoppm 사용 (Poppler) - 모든 페이지를 개별 PNG로 변환
                // macOS: brew install poppler
                console.log(`[PDF/OCR] pdftoppm으로 전체 페이지 이미지 변환 중...`);
                onProgress?.(createProgressEvent('ocr_convert', 'PDF 페이지를 이미지로 변환 중...', filename, 35));

                // pdftoppm 사용: -png 옵션으로 PNG 출력, -r 200 으로 200 DPI 설정
                const { stdout: pdftoppmPath } = await execAsync('which pdftoppm').catch(() => ({ stdout: '' }));

                if (pdftoppmPath.trim()) {
                    // pdftoppm이 설치된 경우 사용 (권장)
                    await execAsync(`pdftoppm -png -r 200 "${filePath}" "${tempDir}/page"`);
                } else {
                    // pdftoppm 없으면 sips 사용 (첫 페이지만 - 폴백)
                    console.log(`[PDF/OCR] pdftoppm을 찾을 수 없어 sips 폴백 (첫 페이지만 추출됩니다. 'brew install poppler'로 pdftoppm 설치 권장)`);
                    await execAsync(`sips -s format png --resampleHeightWidthMax 3000 "${filePath}" --out "${tempDir}"`);
                }

                const imageFiles = fs.readdirSync(tempDir)
                    .filter(file => file.endsWith('.png'))
                    .sort((a, b) => {
                        // page-01.png, page-02.png 형식으로 정렬
                        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                        return numA - numB;
                    });

                if (imageFiles.length > 0) {
                    const config = getConfig();
                    console.log(`[PDF/OCR] 변환된 이미지 ${imageFiles.length}장 분석 (모델: ${config.ollamaDefaultModel} 연동용)`);

                    let ocrText = '';
                    // 전체 페이지 분석 (메모리 효율을 위해 최대 30페이지로 제한)
                    const maxPages = Math.min(imageFiles.length, 30);

                    for (let i = 0; i < maxPages; i++) {
                        const imgPath = path.join(tempDir, imageFiles[i]);
                        const progressPercent = 40 + Math.round((i / maxPages) * 50);  // 40~90%
                        onProgress?.(createProgressEvent(
                            'ocr_recognize',
                            `OCR 분석 중: ${i + 1}/${maxPages} 페이지 (총 ${imageFiles.length}페이지)`,
                            filename,
                            progressPercent
                        ));
                        const result = await Tesseract.recognize(imgPath, 'kor+eng');
                        ocrText += `\n--- Page ${i + 1} ---\n${result.data.text}\n`;
                    }

                    if (imageFiles.length > maxPages) {
                        ocrText += `\n\n[... ${maxPages}페이지 이후 ${imageFiles.length - maxPages}페이지 생략 (OCR 성능 최적화) ...]`;
                    }

                    if (ocrText.trim().length > extractedText.length) {
                        extractedText = `[OCR Raw Data]\n(이 문서는 이미지 PDF입니다. 아래 텍스트는 OCR 추출 결과이며 오타가 있을 수 있습니다. 문맥을 파악하여 해석해 주세요.)\n\n${ocrText.trim()}`;
                        console.log(`[PDF/OCR] 최종 추출 완료: ${extractedText.length}자`);
                        onProgress?.(createProgressEvent('ocr_complete', `OCR 추출 완료: ${extractedText.length}자`, filename, 95));
                    }
                }
            } finally {
                // 청소
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (cleanupError) {
                    // 임시 파일 정리 실패는 무시 - 시스템이 자체 정리
                }
            }
        } catch (e: unknown) {
            console.error('[PDF/OCR] 프로세스 오류:', (e instanceof Error ? e.message : String(e)));
        }
    }

    // 최종 실패 처리
    if (extractedText.length < 50) {
        extractedText = `[PDF 파일: ${filename}]
        
⚠️ 텍스트 추출 실패

이 문서에서 텍스트를 추출하지 못했습니다. 
이미지 PDF일 가능성이 높으나 OCR 처리 중 오류가 발생했습니다.

파일 크기: ${(buffer.length / 1024).toFixed(1)} KB`;
    }

    return {
        filename,
        type: 'pdf',
        text: extractedText,
        pages: numPages || undefined
    };
}

/**
 * 텍스트 파일 읽기
 */
export async function extractTextFile(
    filePath: string,
    onProgress?: ProgressCallback
): Promise<DocumentResult> {
    const filename = path.basename(filePath);
    onProgress?.(createProgressEvent('text_read', '텍스트 파일 읽는 중...', filename, 50));
    const text = fs.readFileSync(filePath, 'utf-8');
    onProgress?.(createProgressEvent('complete', `텍스트 추출 완료: ${text.length}자`, filename, 100));
    return {
        filename,
        type: 'text',
        text
    };
}

/**
 * 이미지 파일에서 OCR 텍스트 추출
 */
export async function extractImageText(
    filePath: string,
    onProgress?: ProgressCallback
): Promise<DocumentResult> {
    const filename = path.basename(filePath);

    try {
        const Tesseract = require('tesseract.js');
        console.log(`[OCR] 이미지 분석 시작: ${filename}`);
        onProgress?.(createProgressEvent('image_ocr', '이미지 OCR 분석 시작...', filename, 20));

        const result = await Tesseract.recognize(filePath, 'kor+eng', {
            logger: (m: { status: string; progress: number }) => {
                if (m.status === 'recognizing text') {
                    const progress = 20 + Math.round(m.progress * 70);  // 20~90%
                    console.log(`[OCR] 진행률: ${(m.progress * 100).toFixed(0)}%`);
                    onProgress?.(createProgressEvent(
                        'ocr_recognize',
                        `OCR 분석 중: ${(m.progress * 100).toFixed(0)}%`,
                        filename,
                        progress
                    ));
                }
            }
        });

        const text = result.data.text.trim();
        console.log(`[OCR] 추출 완료: ${text.length}자`);
        onProgress?.(createProgressEvent('ocr_complete', `OCR 추출 완료: ${text.length}자`, filename, 95));

        const stats = fs.statSync(filePath);
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');

        return {
            filename,
            type: 'image',
            text: `[OCR Raw Data]\n(이미지 OCR 결과입니다. LLM이 문맥을 파악해 주세요.)\n\n${text}`,
            info: {
                confidence: result.data.confidence,
                base64: base64,
                mime: `image/${path.extname(filePath).slice(1)}`
            }
        };
    } catch (e: unknown) {
        console.error('[OCR] 오류:', (e instanceof Error ? e.message : String(e)));

        // 이미지 파일인 경우 텍스트 추출에 실패해도 base64 데이터는 지원 (Vision 모델용)
        try {
            const buffer = fs.readFileSync(filePath);
            const base64 = buffer.toString('base64');
            return {
                filename,
                type: 'image',
                text: `[이미지 파일: ${filename}] 텍스트 추출 실패. 모델의 Vision 기능을 사용하여 분석해 주세요.`,
                info: { base64: base64 }
            };
        } catch (readErr) {
            return {
                filename,
                type: 'image',
                text: `[이미지 파일: ${filename}] OCR 처리 및 파일 읽기 오류: ${(e instanceof Error ? e.message : String(e))}`
            };
        }
    }
}

/**
 * Excel 파일에서 텍스트 추출
 */
export async function extractExcelText(
    filePath: string,
    onProgress?: ProgressCallback
): Promise<DocumentResult> {
    const filename = path.basename(filePath);

    try {
        const ExcelJS = require('exceljs');
        onProgress?.(createProgressEvent('excel_parse', 'Excel 파일 분석 중...', filename, 30));

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        let allText = '';
        console.log(`[Excel] 시트 ${workbook.worksheets.length}개 처리 중...`);

        workbook.eachSheet((worksheet: { name: string; eachRow: (cb: (row: { values: unknown[] | Record<string, unknown> }, rowNumber: number) => void) => void }, sheetId: number) => {
            allText += `\n\n=== 시트: ${worksheet.name} ===\n\n`;

            worksheet.eachRow((row: { values: unknown[] | Record<string, unknown> }, rowNumber: number) => {
                const rowValues = row.values;
                if (Array.isArray(rowValues)) {
                    // exceljs row.values is 1-indexed array, with index 0 abandoned
                    const rowText = rowValues
                        .slice(1)
                        .map((cell: unknown) => {
                            if (cell && typeof cell === 'object' && 'result' in cell && (cell as { result: unknown }).result !== undefined) {
                                return String((cell as { result: unknown }).result);
                            }
                            return cell !== undefined && cell !== null ? String(cell) : '';
                        })
                        .join(' | ');
                    allText += rowText + '\n';
                }
            });
        });

        console.log(`[Excel] 추출 완료: ${allText.length}자, ${workbook.worksheets.length}개 시트`);
        onProgress?.(createProgressEvent('complete', `Excel 추출 완료: ${workbook.worksheets.length}개 시트`, filename, 100));

        return {
            filename,
            type: 'excel',
            text: allText.trim(),
            info: { sheets: workbook.worksheets.length }
        };
    } catch (e: unknown) {
        console.error('[Excel] 오류:', (e instanceof Error ? e.message : String(e)));
        return {
            filename,
            type: 'excel',
            text: `[Excel 파일: ${filename}] 처리 오류: ${(e instanceof Error ? e.message : String(e))}`
        };
    }
}

/**
 * 바이너리/기타 파일 정보
 */
export async function extractBinaryInfo(filePath: string): Promise<DocumentResult> {
    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    return {
        filename,
        type: 'binary',
        text: `[파일: ${filename}]

파일 형식: ${ext || '(확장자 없음)'}
파일 크기: ${(stats.size / 1024).toFixed(1)} KB
수정일: ${stats.mtime.toLocaleString('ko-KR')}

⚠️ 이 파일 형식은 텍스트 추출을 지원하지 않습니다.
지원되는 형식: PDF, TXT, MD, 이미지(OCR), Excel, CSV, JSON, HTML, 코드 파일`
    };
}

/**
 * 파일 확장자에 따라 텍스트 추출
 */
export async function extractDocument(
    filePath: string,
    onProgress?: ProgressCallback
): Promise<DocumentResult> {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    console.log(`[Extract] 파일 처리: ${filename} (${ext})`);
    onProgress?.(createProgressEvent('extract', `파일 분석 시작: ${filename}`, filename, 5));

    // PDF
    if (ext === '.pdf') {
        return extractPdfText(filePath, onProgress);
    }

    // 이미지 (OCR)
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp'].includes(ext)) {
        return extractImageText(filePath, onProgress);
    }

    // Excel
    if (['.xlsx', '.xls', '.xlsm', '.xlsb'].includes(ext)) {
        return extractExcelText(filePath, onProgress);
    }

    // 텍스트 기반 파일
    const textExtensions = [
        '.txt', '.md', '.json', '.csv', '.xml', '.html', '.htm',
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
        '.css', '.scss', '.less', '.sql', '.sh', '.bat', '.ps1', '.yaml', '.yml',
        '.ini', '.cfg', '.conf', '.log', '.env', '.gitignore', '.dockerfile'
    ];

    if (textExtensions.includes(ext)) {
        return extractTextFile(filePath, onProgress);
    }

    // 확장자가 없거나 알 수 없는 파일 - 텍스트로 시도
    try {
        const buffer = fs.readFileSync(filePath);
        // 바이너리 파일 감지 (null 바이트 체크)
        const isText = !buffer.slice(0, 1000).includes(0);

        if (isText) {
            return extractTextFile(filePath, onProgress);
        }
    } catch (e) {
        // 무시
    }

    // 바이너리 파일 정보만 반환
    return extractBinaryInfo(filePath);
}

/**
 * 문서 요약 프롬프트 생성 (JSON 형식)
 */
export function createSummaryPrompt(document: DocumentResult, language: string = 'ko'): string {
    const maxLength = 30000;
    let text = document.text;
    if (text.length > maxLength) {
        text = text.substring(0, maxLength) + '\n\n[... 문서의 나머지 부분 생략 ...]';
    }

    return `You are a professional document analyst. Analyze the provided document and generate a structured summary in JSON format.
The output MUST be a valid JSON object without any markdown formatting or code blocks.

Document Info:
- Filename: ${document.filename}
${document.pages ? `- Pages: ${document.pages}` : ''}

Document Content:
${text}

---

Response Format (JSON):
{
  "title": "Document Title",
  "category": "Document Type (e.g., Law, Report, Paper, etc.)",
  "summary": ["Key point 1", "Key point 2", "Key point 3"],
  "sections": [
    {
      "title": "Section Title",
      "content": "Summary of this section"
    }
  ],
  "implications": "Implications or conclusion"
}

Ensure the response is valid JSON. Translate all content to Korean.`;
}

/**
 * Q&A 프롬프트 생성 (JSON 형식)
 */
export function createQAPrompt(document: DocumentResult, question: string): string {
    const maxLength = 28000;
    let text = document.text;
    if (text.length > maxLength) {
        text = text.substring(0, maxLength) + '\n\n[... 문서의 나머지 부분 생략 ...]';
    }

    return `You are a professional document analyst. Answer the user's question based on the document content.
The output MUST be a valid JSON object without any markdown formatting or code blocks.

Document Info:
- Filename: ${document.filename}

Document Content:
${text}

Question:
${question}

---

Response Format (JSON):
{
  "answer": "Direct answer to the question",
  "evidence": "Quote or reference from the document supporting the answer",
  "additional_info": "Any additional context or limitations (optional)"
}

Ensure the response is valid JSON. Translate all content to Korean. If the answer cannot be found in the document, state that clearly in the "answer" field.`;
}
