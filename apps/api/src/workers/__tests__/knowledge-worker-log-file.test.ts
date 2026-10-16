/**
 * 별도 worker 프로세스의 로그 파일 분리 — API 와 같은 winston 파일을 두 프로세스가 회전시키지 않게
 * 진입점이 logger import 전에 LOG_FILE_PREFIX 를 정하고, logger 는 그 접두로 파일 이름을 만든다.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { logFilePath } from '../../utils/logger';

describe('logFilePath', () => {
    const saved = process.env.LOG_FILE_PREFIX;
    afterEach(() => {
        if (saved === undefined) delete process.env.LOG_FILE_PREFIX;
        else process.env.LOG_FILE_PREFIX = saved;
    });

    it('접두가 없으면 기존 이름 그대로(API)', () => {
        delete process.env.LOG_FILE_PREFIX;
        expect(basename(logFilePath('combined.log'))).toBe('combined.log');
        expect(basename(logFilePath('error.log'))).toBe('error.log');
    });

    it('접두가 있으면 파일 이름 앞에 붙인다(같은 logs/ 디렉터리)', () => {
        process.env.LOG_FILE_PREFIX = 'knowledge-worker-';
        expect(basename(logFilePath('combined.log'))).toBe('knowledge-worker-combined.log');
        delete process.env.LOG_FILE_PREFIX;
        const apiDir = resolve(logFilePath('combined.log'), '..');
        process.env.LOG_FILE_PREFIX = 'knowledge-worker-';
        expect(resolve(logFilePath('combined.log'), '..')).toBe(apiDir);
    });
});

describe('workers/knowledge-worker 진입점', () => {
    it('logger 를 import 하기 전에 LOG_FILE_PREFIX 를 정한다', () => {
        const src = readFileSync(resolve(__dirname, '../knowledge-worker.ts'), 'utf8');
        const setAt = src.indexOf("process.env.LOG_FILE_PREFIX = 'knowledge-worker-'");
        const loggerAt = src.indexOf("from '../utils/logger'");
        expect(setAt).toBeGreaterThan(0);
        expect(loggerAt).toBeGreaterThan(setAt);
        // logger 보다 앞선 import 는 dotenv·path 뿐이다(그 안에서 logger 가 먼저 로드되지 않게)
        const before = src.slice(0, setAt).match(/^import .+ from '([^']+)'/gm) ?? [];
        expect(before).toEqual(["import * as dotenv from 'dotenv'", "import * as path from 'path'"]);
    });
});
