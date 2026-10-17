/**
 * CLI 공용 터미널 헬퍼 — 입력 프롬프트·설정 확인.
 * index.ts 에서 분리(파일 크기 가드). 명령 모듈(index·share)이 함께 쓴다.
 */
import * as readline from 'readline';
import { loadConfig } from './config';

export function prompt(q: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a.trim()); }));
}

export function requireConfig(): { serverUrl: string; apiKey: string } {
    const cfg = loadConfig();
    if (!cfg) { console.error('먼저 `openmake-code login` 을 실행하세요.'); process.exit(1); }
    return cfg;
}
