import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { resolveDockerEnv } = require('../resolve-docker.cjs');

test('macOS ignores Desktop settings and discovers the dedicated external Colima profile', () => {
    assert.deepEqual(resolveDockerEnv({ platform: 'darwin', env: { DOCKER_HOST: 'unix:///desktop', DOCKER_CONTEXT: 'desktop-linux' }, userHome: '/Users/test', lookupContext: () => 'unix:///Volumes/App Data/Colima/openmake/docker.sock' }), {
        COLIMA_HOME: '/Volumes/App Data/Colima', DOCKER_HOST: 'unix:///Volumes/App Data/Colima/openmake/docker.sock', DOCKER_CONTEXT: '',
    });
});
test('explicit Colima home overrides context metadata', () => {
    const env = resolveDockerEnv({ platform: 'darwin', env: { COLIMA_HOME: '/chosen' }, lookupContext: () => { throw new Error('must not inspect'); } });
    assert.equal(env.DOCKER_HOST, 'unix:///chosen/openmake/docker.sock');
});
test('fresh macOS install defaults to the dedicated home profile', () => {
    assert.equal(resolveDockerEnv({ platform: 'darwin', env: {}, userHome: '/Users/test', lookupContext: () => '' }).DOCKER_HOST, 'unix:///Users/test/.colima/openmake/docker.sock');
});
test('unrelated or remote context endpoints are never adopted', () => {
    for (const endpoint of ['unix:///Users/test/.docker/run/docker.sock', 'tcp://host:2375']) {
        assert.equal(resolveDockerEnv({ platform: 'darwin', env: {}, userHome: '/Users/test', lookupContext: () => endpoint }).COLIMA_HOME, '/Users/test/.colima');
    }
});
test('Linux and Windows retain their configured Docker engine', () => {
    for (const platform of ['linux', 'win32']) assert.deepEqual(resolveDockerEnv({ platform, env: { DOCKER_HOST: 'tcp://engine' } }), {});
});
test('relative Colima home fails before selecting a different engine', () => {
    assert.throws(() => resolveDockerEnv({ platform: 'darwin', env: { COLIMA_HOME: 'relative' } }), /absolute/);
});
