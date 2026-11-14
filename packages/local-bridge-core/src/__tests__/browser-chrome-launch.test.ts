/**
 * launchChrome 인자(설계 B-9) — 띄우는 프로필과 기동 전에 고치는 `Default/Preferences` 가 같아야 한다.
 * Chrome 대신 받은 인자를 기록하고 `DevToolsActivePort` 를 쓰는 가짜 실행 파일(OMK_BRIDGE_CHROME)로 확인한다(Chrome 불필요).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchChrome } from '../browser/chrome';

const posix = process.platform === 'win32' ? describe.skip : describe;

posix('launchChrome 인자(B-9)', () => {
    let tmp = '';
    const saved = process.env.OMK_BRIDGE_CHROME;
    beforeEach(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-chromeargs-')));
        const bin = path.join(tmp, 'fake-chrome');
        fs.writeFileSync(bin, [
            '#!/bin/sh',
            'for a in "$@"; do case "$a" in --user-data-dir=*) d="${a#--user-data-dir=}";; esac; done',
            'printf \'%s\\n\' "$@" > "$d/args.txt"',
            'printf \'1234\\n/devtools/browser/x\\n\' > "$d/DevToolsActivePort"',
            'exec sleep 30',
        ].join('\n'), { mode: 0o755 });
        process.env.OMK_BRIDGE_CHROME = bin;
    });
    afterEach(() => {
        if (saved === undefined) delete process.env.OMK_BRIDGE_CHROME; else process.env.OMK_BRIDGE_CHROME = saved;
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('Local State 의 마지막 사용 프로필과 무관하게 Default 프로필로 띄운다', async () => {
        const profile = path.join(tmp, 'profile');
        fs.mkdirSync(profile);
        fs.writeFileSync(path.join(profile, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 1' } }));
        const { wsUrl, proc } = await launchChrome(profile);
        try {
            expect(wsUrl).toBe('ws://127.0.0.1:1234/devtools/browser/x');
            const args = fs.readFileSync(path.join(profile, 'args.txt'), 'utf8').split('\n');
            expect(args).toContain('--profile-directory=Default');
            expect(args).toContain(`--user-data-dir=${profile}`);
        } finally {
            proc.kill();
        }
    });
});
