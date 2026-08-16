/**
 * OpenAPI 응답 계약 검증 헬퍼 (축 1 Step 4)
 *
 * packages/api-contracts/openapi.v1.json 의 응답 스키마로 실핸들러 응답 body 를
 * 검증한다. ajv(기설치, draft-07) 사용 — OpenAPI 3.0 의 `nullable: true` 는
 * JSON Schema 표준이 아니므로 로드 시 `type: [T, 'null']` 로 변환한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv, { ValidateFunction } from 'ajv';

const CONTRACT_PATH = path.resolve(
    __dirname,
    '../../../../../packages/api-contracts/openapi.v1.json',
);

/** OpenAPI `nullable: true` → JSON Schema type 배열 변환 (재귀) */
function convertNullable(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(convertNullable);
    if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            out[k] = convertNullable(v);
        }
        if (out.nullable === true) {
            delete out.nullable;
            if (typeof out.type === 'string') out.type = [out.type, 'null'];
        }
        return out;
    }
    return node;
}

const contractDoc = convertNullable(
    JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')),
) as Record<string, unknown>;

const ajv = new Ajv({ allErrors: true });
ajv.addSchema(contractDoc as object, 'openapi');

function escapePointer(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

const validatorCache = new Map<string, ValidateFunction>();

export interface ContractResult {
    valid: boolean;
    errors: string;
}

/**
 * 응답 body 를 계약 스키마로 검증한다.
 * @param apiPath 계약 path key (예: '/api/auth/login')
 * @param method HTTP 메서드 소문자
 * @param status 응답 상태코드 문자열 (예: '200')
 */
export function validateContract(
    apiPath: string,
    method: string,
    status: string,
    body: unknown,
): ContractResult {
    const pointer =
        `openapi#/paths/${escapePointer(apiPath)}/${method}/responses/${status}` +
        `/content/${escapePointer('application/json')}/schema`;
    let validateFn = validatorCache.get(pointer);
    if (!validateFn) {
        validateFn = ajv.compile({ $ref: pointer });
        validatorCache.set(pointer, validateFn);
    }
    const valid = validateFn(body) as boolean;
    return { valid, errors: valid ? '' : ajv.errorsText(validateFn.errors) };
}

/** 검증 실패 시 위반 내용을 담아 throw — 테스트에서 단언용 */
export function expectContract(
    apiPath: string,
    method: string,
    status: string,
    body: unknown,
): void {
    const result = validateContract(apiPath, method, status, body);
    if (!result.valid) {
        throw new Error(
            `계약 위반 ${method.toUpperCase()} ${apiPath} ${status}: ${result.errors}\n` +
            `body: ${JSON.stringify(body).slice(0, 500)}`,
        );
    }
}
