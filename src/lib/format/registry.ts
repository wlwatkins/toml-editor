import type { Format, FormatId } from './drafts.ts';
import { json, jsonc } from '../json/serialize.ts';
import { toml } from '../toml/serialize.ts';
import { yaml } from '../yaml/serialize.ts';

/** Every format the editor can open, in the order the UI should list them. */
export const FORMATS: Format[] = [toml, json, jsonc, yaml];

/** Every extension that may be opened, lower-case and dot-prefixed. */
export const EXTENSIONS: string[] = FORMATS.flatMap((format) => format.extensions);

export function formatById(id: FormatId): Format {
	const found = FORMATS.find((format) => format.id === id);
	if (!found) throw new Error(`unknown format: ${id}`);
	return found;
}

/** The extension of a path, lower-cased, including the dot. */
export function extensionOf(path: string): string {
	const name = path.replace(/^.*[\\/]/, '');
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** The format that reads this path, or null when nothing here can. */
export function formatForPath(path: string): Format | null {
	const extension = extensionOf(path);
	return FORMATS.find((format) => format.extensions.includes(extension)) ?? null;
}

/** `.toml, .tml, .json, ...` -- for error messages and placeholder text. */
export function extensionList(): string {
	return EXTENSIONS.join(', ');
}
