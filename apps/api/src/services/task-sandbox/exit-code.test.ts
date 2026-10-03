import { interpretExitCode } from './exit-code';

describe('종료 코드 해석', () => {
    it('grep·rg 의 1 은 일치 없음이다', () => {
        expect(interpretExitCode('grep -rn "TODO" src', 1)).toContain('일치 없음');
        expect(interpretExitCode('rg foo', 1)).toContain('일치 없음');
        expect(interpretExitCode('/usr/bin/grep foo a.txt', 1)).toContain('일치 없음');
        expect(interpretExitCode('git grep foo', 1)).toContain('일치 없음');
    });

    it('diff·cmp 의 1 은 차이 있음이다', () => {
        expect(interpretExitCode('diff a.txt b.txt', 1)).toContain('차이');
        expect(interpretExitCode('git diff --exit-code', 1)).toContain('차이');
    });

    it('test·[ 의 1 은 조건 거짓이다', () => {
        expect(interpretExitCode('test -f a.txt', 1)).toContain('거짓');
        expect(interpretExitCode('[ -d build ]', 1)).toContain('거짓');
    });

    it('환경변수 대입과 리다이렉션은 건너뛴다', () => {
        expect(interpretExitCode('LC_ALL=C grep foo a.txt 2>/dev/null', 1)).toContain('일치 없음');
        expect(interpretExitCode('grep foo a.txt 2>&1', 1)).toContain('일치 없음');
    });

    it('파이프는 마지막 명령으로 본다', () => {
        expect(interpretExitCode('cat a.txt | grep foo', 1)).toContain('일치 없음');
        expect(interpretExitCode('grep foo a.txt | sort', 1)).toBeNull();
    });

    it('따옴표 안의 연산자는 명령 구분으로 보지 않는다', () => {
        expect(interpretExitCode('grep "a && b" x.txt', 1)).toContain('일치 없음');
        expect(interpretExitCode("grep 'a; b | c' x.txt", 1)).toContain('일치 없음');
    });

    it('여러 명령을 이은 경우는 어느 명령의 코드인지 알 수 없어 해석하지 않는다', () => {
        expect(interpretExitCode('cd src && grep foo a.txt', 1)).toBeNull();
        expect(interpretExitCode('make build; grep foo a.txt', 1)).toBeNull();
        expect(interpretExitCode('grep foo a.txt || true', 1)).toBeNull();
        expect(interpretExitCode('grep foo $(cat list.txt)', 1)).toBeNull();
    });

    it('그 밖의 코드와 명령은 해석하지 않는다(오류로 남는다)', () => {
        expect(interpretExitCode('grep foo nofile', 2)).toBeNull();
        expect(interpretExitCode('npm test', 1)).toBeNull();
        expect(interpretExitCode('grep foo a.txt', 0)).toBeNull();
    });
});
