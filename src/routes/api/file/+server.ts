import { error, json } from '@sveltejs/kit';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import type { RequestHandler } from './$types';

const ALLOWED_EXTENSIONS = new Set(['.toml', '.tml']);

/**
 * Both handlers refuse anything that is not a TOML file. This is a local tool,
 * so the point is not to sandbox a hostile caller -- it is to make a mistyped
 * path fail loudly instead of overwriting something unrelated.
 */
function checkPath(raw: string | null): string {
	if (!raw) error(400, 'Missing "path" parameter');
	const path = resolve(raw.trim());
	if (!isAbsolute(path)) error(400, 'Path must be absolute');
	if (!ALLOWED_EXTENSIONS.has(extname(path).toLowerCase())) {
		error(400, 'Only .toml and .tml files can be opened');
	}
	return path;
}

export const GET: RequestHandler = async ({ url }) => {
	const path = checkPath(url.searchParams.get('path'));
	let text: string;
	let info;
	try {
		text = await readFile(path, 'utf8');
		info = await stat(path);
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') error(404, `No such file: ${path}`);
		if (code === 'EACCES' || code === 'EPERM') error(403, `Permission denied: ${path}`);
		if (code === 'EISDIR') error(400, `That path is a directory: ${path}`);
		error(500, `Could not read ${path}: ${String(cause)}`);
	}
	return json({ path, text, mtimeMs: info.mtimeMs, size: info.size });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		path?: string;
		text?: string;
		mtimeMs?: number;
	};
	const path = checkPath(body.path ?? null);
	if (typeof body.text !== 'string') error(400, 'Missing "text"');

	// Refuse to clobber a file that changed underneath the open editor.
	if (typeof body.mtimeMs === 'number' && body.mtimeMs > 0) {
		try {
			const current = await stat(path);
			if (Math.abs(current.mtimeMs - body.mtimeMs) > 1) {
				error(409, 'The file changed on disk since it was opened. Reload before saving.');
			}
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
			error(404, `No such file: ${path}`);
		}
	}

	// Write to a sibling temp file and rename, so a crash mid-write cannot
	// truncate the original.
	const temp = `${path}.tmp-${Date.now().toString(36)}`;
	try {
		await writeFile(temp, body.text, 'utf8');
		await rename(temp, path);
	} catch (cause) {
		await unlink(temp).catch(() => {});
		const code = (cause as NodeJS.ErrnoException).code;
		if (code === 'EACCES' || code === 'EPERM') error(403, `Permission denied: ${path}`);
		error(500, `Could not write ${path}: ${String(cause)}`);
	}

	const info = await stat(path);
	return json({ path, mtimeMs: info.mtimeMs, size: info.size });
};
