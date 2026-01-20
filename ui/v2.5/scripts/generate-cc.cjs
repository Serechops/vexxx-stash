const { spawnSync } = require('child_process');
const path = require('path');

// --- Helper Functions ---

function getGitTags() {
    const result = spawnSync('git', ['tag', '-l', 'v*'], { encoding: 'utf-8' });
    if (result.error) {
        console.error('Failed to list git tags:', result.error);
        return [];
    }
    return result.stdout.split('\n').map(t => t.trim()).filter(Boolean);
}

function parseVersion(tag) {
    // Matches v1.0.0 or v1.0.0-rc.1
    const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/);
    if (!match) return null;
    return {
        full: tag,
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        rc: match[4] ? parseInt(match[4]) : null
    };
}

function getLatestVersions() {
    const tags = getGitTags();
    let latestOfficial = null;
    let latestRC = null;

    tags.forEach(tag => {
        const v = parseVersion(tag);
        if (!v) return;

        if (v.rc === null) {
            if (!latestOfficial || compareVersions(v, latestOfficial) > 0) {
                latestOfficial = v;
            }
        } else {
            if (!latestRC || compareVersions(v, latestRC) > 0) {
                latestRC = v;
            }
        }
    });

    return { latestOfficial, latestRC };
}

function compareVersions(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    // For RCs, if one is RC and other isn't (official), the official one is "greater" effectively but 
    // usually we compare same-base versions. 
    // Here: 1.0.0 > 1.0.0-rc.1. But we usually compare within types.
    // Let's just compare RC numbers if bases are equal.
    const aRc = a.rc || Infinity; // Infinity for official release
    const bRc = b.rc || Infinity;
    return aRc - bRc;
}

function calculateNextVersion(type, latestOfficial, latestRC) {
    // Default start if no tags exist
    if (!latestOfficial) {
        return type === 'release' ? 'v1.0.0' : 'v1.0.0-rc.1';
    }

    // Determine base version from latest official
    let nextMajor = latestOfficial.major;
    let nextMinor = latestOfficial.minor;
    let nextPatch = latestOfficial.patch;

    // Strategy: We are iterating on Minor versions as per user request (v1.0 -> v1.1)
    // If you want patch increments (1.0.0 -> 1.0.1), change this logic.
    // Assuming "iteration" implies new features/minor release for this project context.

    // Check if we have an active RC newer than the latest official
    const rcIsNewer = latestRC && (
        latestRC.major > latestOfficial.major ||
        (latestRC.major === latestOfficial.major && latestRC.minor > latestOfficial.minor) ||
        (latestRC.major === latestOfficial.major && latestRC.minor === latestOfficial.minor && latestRC.patch > latestOfficial.patch) // unlikely for RC to have higher patch than official base
    );

    if (type === 'rc') {
        if (rcIsNewer) {
            // Increment existing RC
            return `v${latestRC.major}.${latestRC.minor}.${latestRC.patch}-rc.${latestRC.rc + 1}`;
        } else {
            // Start new RC sequence from next minor version
            return `v${nextMajor}.${nextMinor + 1}.0-rc.1`;
        }
    } else if (type === 'release') {
        if (rcIsNewer) {
            // Promote RC to official
            return `v${latestRC.major}.${latestRC.minor}.${latestRC.patch}`;
        } else {
            // No active RC, just bump minor version directly
            return `v${nextMajor}.${nextMinor + 1}.0`;
        }
    }
}

// --- Main Execution ---

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isRC = args.includes('--rc');
const isRelease = args.includes('--release');
const customVersion = args.find(a => !a.startsWith('--'));

if (isRC && isRelease) {
    console.error('Error: Cannot specify both --rc and --release');
    process.exit(1);
}

let STASH_VERSION = customVersion || process.env.STASH_VERSION;

if (!STASH_VERSION && (isRC || isRelease)) {
    console.log('[Vexxx] Calculating next version...');
    const { latestOfficial, latestRC } = getLatestVersions();

    console.log(`Current Official: ${latestOfficial ? latestOfficial.full : 'None'}`);
    console.log(`Current RC:       ${latestRC ? latestRC.full : 'None'}`);

    STASH_VERSION = calculateNextVersion(isRelease ? 'release' : 'rc', latestOfficial, latestRC);
    console.log(`Target Version:   ${STASH_VERSION}`);

    if (isDryRun) {
        console.log('[Dry Run] Skipping git tag creation and push.');
    } else {
        console.log(`[Git] Creating tag ${STASH_VERSION}...`);
        const tagResult = spawnSync('git', ['tag', '-a', STASH_VERSION, '-m', `Release ${STASH_VERSION}`], { stdio: 'inherit' });
        if (tagResult.status !== 0) {
            console.error('Failed to create git tag.');
            process.exit(1);
        }

        console.log(`[Git] Pushing tag ${STASH_VERSION}...`);
        const pushResult = spawnSync('git', ['push', 'origin', STASH_VERSION], { stdio: 'inherit' });
        if (pushResult.status !== 0) {
            console.error('Failed to push git tag.');
            process.exit(1);
        }
    }
} else if (!STASH_VERSION) {
    // Fallback if no flags and no env var
    // Try to get exact match for current commit? Or just leave empty to let makefile handle it (git hash)
    // The original script defaulted to empty string.
    STASH_VERSION = '';
}

console.log(`[Vexxx] Starting cross-compilation for version: ${STASH_VERSION || '(auto from git)'}`);

if (isDryRun) {
    console.log('[Dry Run] Build steps will be skipped (printing commands only).');
}

// Commands to run relative to ui/v2.5
const preCommands = [
    'make -C ../.. generate',
    'make -C ../.. ui',
    'docker pull stashapp/compiler'
];

for (const cmd of preCommands) {
    console.log(`> ${cmd}`);
    if (!isDryRun) {
        const result = spawnSync(cmd, { shell: true, stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status || 1);
    }
}

// Docker command needs to run from the root directory
const rootDir = path.resolve(__dirname, '../../../');
const dockerCmd = `docker run --rm -v ".:/stash" -e STASH_VERSION -e GITHASH -e BUILD_DATE -e OFFICIAL_BUILD -e STASH_RELEASE_REPO -w /stash stashapp/compiler /bin/bash -c "make build-cc-all"`;

console.log(`[Vexxx] Running Docker cross-compilation from ${rootDir}...`);
console.log(`> ${dockerCmd}`);

if (!isDryRun) {
    const result = spawnSync(dockerCmd, {
        shell: true,
        stdio: 'inherit',
        cwd: rootDir,
        env: { ...process.env, STASH_VERSION } // Pass the version into the env for docker run -e
    });

    if (result.status !== 0) {
        process.exit(result.status);
    }
}

console.log(`[Vexxx] Building Docker image for export...`);
const dockerBuildCmd = `make docker-build STASH_VERSION=${STASH_VERSION} GITHASH=${process.env.GITHASH || 'dev'}`;
console.log(`> ${dockerBuildCmd}`);
if (!isDryRun) {
    const buildResult = spawnSync(dockerBuildCmd, { shell: true, stdio: 'inherit', cwd: rootDir });
    if (buildResult.status !== 0) process.exit(buildResult.status);
}

console.log(`[Vexxx] Saving and compressing Docker image to dist/stash-docker.tar.gz...`);
if (!isDryRun) {
    const fs = require('fs');
    const zlib = require('zlib');
    const { spawn } = require('child_process');

    const distDir = path.join(rootDir, 'dist');
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    const outFile = path.join(distDir, 'stash-docker.tar.gz');
    const outStream = fs.createWriteStream(outFile);
    const gzip = zlib.createGzip();

    // Spawn docker save and pipe to gzip -> file
    const dockerSave = spawn('docker', ['save', 'stash/build'], { cwd: rootDir, shell: true });

    dockerSave.stdout.pipe(gzip).pipe(outStream);

    dockerSave.stderr.on('data', (data) => {
        process.stderr.write(data);
    });

    dockerSave.on('close', (code) => {
        if (code !== 0) {
            console.error(`docker save process exited with code ${code}`);
            process.exit(code);
        } else {
            generateReleaseNotes();
        }
    });
} else {
    // For dry run, we just exit since we can't async wait in this sync script structure easily without bigger refactor,
    // or just print what we would do.
    console.log('[Vexxx] All artifacts generated successfully (Dry Run).');
    process.exit(0);
}

function generateReleaseNotes() {
    console.log('[Vexxx] Generating release notes...');
    // We need to run this from the root dir so it finds the 'dist' folder correctly relative to itself if it relied on CWD, 
    // but the script uses 'dist' directly. Let's run from rootDir.
    const releaseNotesCmd = `go run scripts/generate_release_notes.go`;
    console.log(`> ${releaseNotesCmd}`);

    // Check if we have env vars, if not use defaults or passed ones
    const version = STASH_VERSION; // Captured from closure

    const result = spawnSync(releaseNotesCmd, {
        shell: true,
        stdio: 'inherit',
        cwd: rootDir,
        env: {
            ...process.env,
            STASH_VERSION: version,
            GITHASH: process.env.GITHASH || 'dev',
            STASH_RELEASE_REPO: process.env.STASH_RELEASE_REPO || 'Serechops/vexxx-stash'
        }
    });

    if (result.status !== 0) {
        console.error('Failed to generate release notes');
        process.exit(result.status);
    }

    console.log('[Vexxx] All artifacts generated successfully.');
    process.exit(0);
}
