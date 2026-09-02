/** UserSandbox.validatePath 심링크 탈출 차단 (2026-09-02 보안 리뷰 B5 NV 후속) */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-sandbox-'));
jest.mock('../../config/env', () => ({ getConfig: () => ({ userDataPath: root }) }));

import { UserSandbox } from '../user-sandbox';

describe('UserSandbox.validatePath realpath', () => {
    const userRoot = path.join(root, 'u1');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-outside-'));
    beforeAll(() => {
        fs.mkdirSync(path.join(userRoot, 'workspace'), { recursive: true });
        fs.writeFileSync(path.join(userRoot, 'workspace', 'ok.txt'), 'x');
        fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
        fs.symlinkSync(outside, path.join(userRoot, 'workspace', 'escape'));
    });
    afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });

    it('루트 안 실재 파일은 허용', () => {
        expect(UserSandbox.validatePath('u1', path.join(userRoot, 'workspace', 'ok.txt'))).toBe(true);
    });
    it('아직 없는 하위 경로도 허용(조상만 검사)', () => {
        expect(UserSandbox.validatePath('u1', path.join(userRoot, 'workspace', 'new', 'file.txt'))).toBe(true);
    });
    it('어휘적으로는 루트 안이지만 심링크가 밖을 가리키면 거부', () => {
        expect(UserSandbox.validatePath('u1', path.join(userRoot, 'workspace', 'escape', 'secret.txt'))).toBe(false);
        expect(UserSandbox.validatePath('u1', path.join(userRoot, 'workspace', 'escape'))).toBe(false);
    });
    it('어휘적 탈출(..)은 종전대로 거부', () => {
        expect(UserSandbox.validatePath('u1', path.join(userRoot, '..', 'u2', 'x'))).toBe(false);
    });
});
