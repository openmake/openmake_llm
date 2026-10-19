// PM2 entry points use the same dedicated-profile rules as scripts/lib/colima.sh.
/* eslint-disable @typescript-eslint/no-require-imports */ // PM2 loads this module with require().
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

function lookupColimaContext() {
    try {
        return execFileSync('docker', ['context', 'inspect', 'colima-openmake', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return ''; }
}

function resolveDockerEnv({ platform = process.platform, env = process.env, userHome = os.homedir(), lookupContext = lookupColimaContext } = {}) {
    if (platform !== 'darwin') return {};
    let root = env.COLIMA_HOME;
    if (!root) {
        const endpoint = lookupContext();
        if (endpoint.startsWith('unix:///') && endpoint.endsWith('/openmake/docker.sock')) {
            root = endpoint.slice('unix://'.length, -'/openmake/docker.sock'.length);
        }
    }
    root ||= path.join(userHome, '.colima');
    if (!path.isAbsolute(root)) throw new Error('COLIMA_HOME must be an absolute path');
    root = root.replace(/\/$/, '');
    return { COLIMA_HOME: root, DOCKER_HOST: `unix://${root}/openmake/docker.sock`, DOCKER_CONTEXT: '' };
}

module.exports = { resolveDockerEnv };
