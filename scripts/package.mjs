/**
 * Builds the installer.
 *
 * electron-builder unpacks ~200 MB of Electron into `<output>/win-unpacked.tmp`
 * and immediately renames that directory into place. On Windows, a real-time
 * scanner is often still reading the freshly written .exe/.dll files, and the
 * rename fails with EPERM. It is timing-dependent and it happens reliably when
 * the output lands inside a watched project tree.
 *
 * So the heavy staging happens under the OS temp directory and only the
 * finished installer is copied back into ./release. Overriding the scanner's
 * configuration would be the other fix, but that is the machine's business,
 * not the build's.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'release');
const staging = mkdtempSync(join(tmpdir(), 'toml-editor-build-'));

const args = process.argv.slice(2);
console.log(`Staging in ${staging}`);

// electron-builder's own JS entry point, run with this Node. Going through
// `npx` would mean spawning a .cmd, which Node refuses to do without a shell.
const cli = join(root, 'node_modules', 'electron-builder', 'cli.js');
const result = spawnSync(
	process.execPath,
	[cli, `--config.directories.output=${staging}`, ...args],
	{ cwd: root, stdio: 'inherit' }
);

if (result.error) {
	console.error(`Could not run electron-builder: ${result.error.message}`);
	rmSync(staging, { recursive: true, force: true });
	process.exit(1);
}
if (result.status !== 0) {
	console.error(`electron-builder exited with code ${result.status}`);
	rmSync(staging, { recursive: true, force: true });
	process.exit(result.status ?? 1);
}

mkdirSync(outDir, { recursive: true });

// Copy the artifacts, but not the unpacked app directory -- that is the very
// thing whose files the scanner holds on to.
const copied = [];
for (const name of readdirSync(staging)) {
	const from = join(staging, name);
	if (statSync(from).isDirectory()) continue;
	if (name === 'builder-debug.yml') continue;
	cpSync(from, join(outDir, name), { force: true });
	copied.push(name);
}

rmSync(staging, { recursive: true, force: true });

console.log('\nInstaller written to release/');
for (const name of copied) {
	const bytes = existsSync(join(outDir, name)) ? statSync(join(outDir, name)).size : 0;
	console.log(`  ${name}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}
