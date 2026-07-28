/**
 * detectDangerousArg 단위 테스트 — 도구 인자 위험 패턴 검증(best-effort).
 * B1 보강: key 부분일치(snake_case 경계) + path/file 민감파일 탐지.
 */
import { detectDangerousArg } from '../unified-client';

describe('detectDangerousArg', () => {
    it('shell 메타문자를 command 계열 key 에서 차단한다', () => {
        expect(detectDangerousArg('command', 'rm -rf / ; echo')).toBe('shell');
        expect(detectDangerousArg('cmd', 'a `whoami`')).toBe('shell');
        // 변형 key 도 커버 (기존엔 무검사였던 케이스)
        expect(detectDangerousArg('user_command', 'x | y')).toBe('shell');
    });

    it('SQL DDL 을 sql/query 계열 key 에서 차단한다', () => {
        expect(detectDangerousArg('sql', 'DROP TABLE users')).toBe('SQL');
        expect(detectDangerousArg('db_query', 'GRANT ALL')).toBe('SQL');
    });

    it('위험 URL scheme 을 차단한다', () => {
        expect(detectDangerousArg('url', 'file:///etc/passwd')).toBe('URL scheme');
        expect(detectDangerousArg('callback_uri', 'javascript:alert(1)')).toBe('URL scheme');
    });

    it('path/file 계열 key 에서 민감파일 접근을 차단한다 (B1 신규)', () => {
        expect(detectDangerousArg('path', '/home/u/.ssh/id_rsa')).toBe('sensitive-path');
        expect(detectDangerousArg('file_path', '../../.env')).toBe('sensitive-path');
        expect(detectDangerousArg('filename', 'secret.pem')).toBe('sensitive-path');
        expect(detectDangerousArg('source', '~/.aws/credentials')).toBe('sensitive-path');
    });

    it('정상 인자는 통과시킨다 (오탐 방지)', () => {
        // 일반 검색어/경로/텍스트
        expect(detectDangerousArg('text', 'hello world')).toBeNull();
        expect(detectDangerousArg('path', '/home/u/docs/report.md')).toBeNull();
        expect(detectDangerousArg('file_path', 'project/src/index.ts')).toBeNull();
        // 위험 의미 없는 key 는 값에 메타문자가 있어도 무검사(코드/JSON 등 오탐 방지)
        expect(detectDangerousArg('code', 'a = 1; b = (2)')).toBeNull();
        expect(detectDangerousArg('content', 'use $var and `tick`')).toBeNull();
        // 'recommendation' 은 command 룰에 안 걸림(부분일치 오매칭 방지)
        expect(detectDangerousArg('recommendation', 'buy (now)')).toBeNull();
    });
});
