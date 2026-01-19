const { spawnSync } = require('child_process');
const path = require('path');

// Arguments passed to pnpm run generate-cc <version>
const versionArg = process.argv[2];
const STASH_VERSION = versionArg || process.env.STASH_VERSION || '';

console.log(`[Vexxx] Starting cross-compilation for version: ${STASH_VERSION || '(auto from git)'}`);

// Commands to run relative to ui/v2.5
const preCommands = [
    'make -C ../.. generate',
    'make -C ../.. ui',
    'docker pull stashapp/compiler'
];

for (const cmd of preCommands) {
    console.log(`> ${cmd}`);
    const result = spawnSync(cmd, { shell: true, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
}

// Docker command needs to run from the root directory
const rootDir = path.resolve(__dirname, '../../');
const dockerCmd = `docker run --rm -v ".:/stash" -e STASH_VERSION -e GITHASH -e BUILD_DATE -e OFFICIAL_BUILD -e STASH_RELEASE_REPO -w /stash stashapp/compiler /bin/bash -c "make build-cc-all"`;

console.log(`[Vexxx] Running Docker cross-compilation from ${rootDir}...`);
console.log(`> ${dockerCmd}`);

const result = spawnSync(dockerCmd, {
    shell: true,
    stdio: 'inherit',
    cwd: rootDir,
    env: { ...process.env, STASH_VERSION } // Pass the version into the env for docker run -e
});

process.exit(result.status || 0);
