/**
 * Base ↔ Add-on 경계 래칫 — 콘텐츠 자산을 직접 참조하는 Base 파일은 동결 목록 안에서만 허용된다.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    ADDON_CONTENT_ASSET_PATTERNS, ADDON_NAME_ALLOWED_PREFIXES, ADDON_SPECIFIC_NAME_PATTERNS, CONTENT_REFERENCE_ALLOWLIST,
} from '../addon-boundary';

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const SELF = 'config/addon-boundary.ts';

function listSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listSourceFiles(full, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** 주석 줄은 참조가 아니다 — 코드 줄만 본다. */
function referencesContent(file: string): boolean {
    return fs.readFileSync(file, 'utf-8').split('\n').some(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return false;
        return ADDON_CONTENT_ASSET_PATTERNS.some(p => p.test(line));
    });
}

describe('addon-boundary', () => {
    const referencing = listSourceFiles(SRC_ROOT)
        .filter(referencesContent)
        .map(f => path.relative(SRC_ROOT, f).split(path.sep).join('/'))
        .filter(f => f !== SELF)
        .sort();

    it('콘텐츠 자산을 참조하는 Base 파일은 동결 목록 안에만 있다', () => {
        const outside = referencing.filter(f => !CONTENT_REFERENCE_ALLOWLIST.includes(f));
        expect(outside).toEqual([]);
    });

    it('동결 목록에 더는 참조하지 않는 항목이 남아 있지 않다(래칫 — 줄었으면 목록에서도 지운다)', () => {
        const stale = CONTENT_REFERENCE_ALLOWLIST.filter(f => !referencing.includes(f));
        expect(stale).toEqual([]);
    });

    it('server.ts·bootstrap.ts 는 콘텐츠 시더를 직접 알지 않는다', () => {
        expect(referencing).not.toContain('server.ts');
        expect(referencing).not.toContain('bootstrap.ts');
    });
});

describe('Base 는 특정 add-on 의 이름을 모른다', () => {
    const isComment = (line: string): boolean => {
        const t = line.trim();
        return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
    };

    it('add-on 고유 이름은 add-on 모듈과 addon-host 밖의 코드 줄에 나오지 않는다', () => {
        const hits: string[] = [];
        for (const file of listSourceFiles(SRC_ROOT)) {
            const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
            if (rel === SELF || ADDON_NAME_ALLOWED_PREFIXES.some(p => rel.startsWith(p))) continue;
            fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
                if (!isComment(line) && ADDON_SPECIFIC_NAME_PATTERNS.some(p => p.test(line))) hits.push(`${rel}:${i + 1}`);
            });
        }
        expect(hits).toEqual([]);
    });
});
