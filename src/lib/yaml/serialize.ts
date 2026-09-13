import { parse as parseYamlValue } from 'yaml';
import type {
	ArrayNode,
	Entry,
	InlineTableNode,
	ScalarNode,
	StringStyle,
	ValueNode
} from '../format/ast.ts';
import type { DraftContext, Format, RenderContext } from '../format/drafts.ts';
import { columnIndent, renderValue, shiftIndent } from '../format/drafts.ts';
import { parseYaml } from './parse.ts';

/** Reads a fragment the way YAML would, or throws. */
function readValue(text: string): unknown {
	return parseYamlValue(text);
}

/**
 * True when the value holds a character that only double quotes can carry.
 * A tab is fine; a line feed is handled separately by each quoting style.
 */
function hasControl(value: string): boolean {
	for (const chr of value) {
		const code = chr.codePointAt(0) ?? 0;
		if (code === 0x7f) return true;
		if (code < 0x20 && code !== 0x09 && code !== 0x0a) return true;
	}
	return false;
}

/**
 * True when the text can be written without quotes and still read back as the
 * same string. Anything that would come back as a number, a boolean or null --
 * `2`, `yes`, `~` -- has to be quoted, or saving would change the type.
 */
export function isPlainSafe(value: string): boolean {
	if (value === '') return false;
	if (/^\s|\s$/.test(value)) return false;
	if (/[\n\r\t]/.test(value)) return false;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
	if (/:\s/.test(value) || /\s#/.test(value)) return false;
	if (value.endsWith(':')) return false;
	if (hasControl(value)) return false;
	try {
		return typeof readValue(value) === 'string';
	} catch {
		return false;
	}
}

/** Single quotes can hold anything on one line; `'` doubles up. */
function canSingleQuote(value: string): boolean {
	return !value.includes('\n') && !value.includes('\r') && !hasControl(value);
}

/** The column a block scalar's content sits at, taken from the file if possible. */
function blockIndent(ctx: DraftContext): string {
	if (ctx.original) {
		const match = /\n([ \t]+)/.exec(ctx.original);
		if (match) return match[1];
	}
	return ctx.indent + '  ';
}

/**
 * Writes the value as a block scalar, or returns null when a block scalar
 * cannot express it exactly -- a first line that starts with a space, trailing
 * spaces on a line, or an unusual run of final newlines. The caller then falls
 * back to double quotes, which can always express it.
 *
 * A folded block (`>`) is written back as a literal block (`|`): re-folding an
 * edited value would move its line breaks.
 */
function blockScalar(value: string, ctx: DraftContext): string | null {
	if (value === '') return null;
	const trailing = /\n*$/.exec(value)?.[0].length ?? 0;
	if (trailing > 1) return null;
	const body = trailing === 1 ? value.slice(0, -1) : value;
	const lines = body.split('\n');
	if (/^[ \t]/.test(lines[0])) return null;
	if (lines.some((line) => /[ \t]$/.test(line))) return null;
	if (body.includes('\r') || hasControl(body)) return null;

	const indent = blockIndent(ctx);
	// The file's own line break after the value supplies the one `|` keeps.
	const header = trailing === 1 ? '|' : '|-';
	return `${header}\n${lines.map((line) => (line === '' ? '' : indent + line)).join('\n')}`;
}

export function serializeString(value: string, style: StringStyle, ctx: DraftContext): string {
	switch (style) {
		case 'plain':
			if (isPlainSafe(value)) return value;
			break;
		case 'single':
			if (canSingleQuote(value)) return `'${value.replace(/'/g, "''")}'`;
			break;
		case 'block-literal':
		case 'block-folded': {
			const block = blockScalar(value, ctx);
			if (block) return block;
			break;
		}
	}
	// Double quotes use the same escapes as JSON and can hold anything.
	return JSON.stringify(value);
}

/** Returns an error message, or null when the draft is a valid YAML value. */
export function validateDraft(node: ScalarNode, draft: string | boolean): string | null {
	if (node.kind === 'boolean' || node.kind === 'string') return null;

	const text = String(draft).trim();
	if (text === '') return 'Value is required';

	let parsed: unknown;
	try {
		parsed = readValue(text);
	} catch {
		return 'Not a valid YAML value';
	}

	switch (node.kind) {
		case 'integer':
			return typeof parsed === 'number' && Number.isInteger(parsed)
				? null
				: 'Not a valid YAML integer (e.g. 42, -7, 0x1f)';
		case 'float':
			return typeof parsed === 'number' ? null : 'Not a valid YAML number (e.g. 3.14, -1e6, .inf)';
		case 'literal':
			if (!node.editable) return 'This value cannot be edited here';
			if (parsed !== null && typeof parsed === 'object') {
				return 'Expected a single value, not a list or a mapping';
			}
			return null;
	}
	return null;
}

export function serializeDraft(
	node: ScalarNode,
	draft: string | boolean,
	ctx: DraftContext
): string {
	switch (node.kind) {
		case 'boolean':
			return draft ? 'true' : 'false';
		case 'string':
			return serializeString(String(draft), node.style, ctx);
		default:
			return String(draft).trim();
	}
}

function serializeScalar(node: ScalarNode, ctx: DraftContext): string {
	switch (node.kind) {
		case 'string':
			return serializeString(node.value, node.style, ctx);
		case 'boolean':
			return node.value ? 'true' : 'false';
		default:
			return node.raw;
	}
}

/** A key, quoted only when writing it plainly would change what it means. */
function keyText(entry: Entry): string {
	const key = entry.key[entry.key.length - 1] ?? entry.keyRaw;
	return isPlainSafe(key) ? key : JSON.stringify(key);
}

/**
 * True when the value is written as an indented block under its key rather
 * than on the same line, so the key needs a line of its own.
 */
function isBlock(node: ValueNode, ctx: RenderContext): boolean {
	if (node.kind === 'array') {
		return node.flow !== true && (ctx.drafts.arrays[node.id] ?? node.items).length > 0;
	}
	if (node.kind === 'inline-table') {
		return node.flow !== true && node.entries.length > 0;
	}
	return false;
}

function renderArray(
	node: ArrayNode,
	items: ValueNode[],
	ctx: RenderContext,
	indent: string
): string {
	if (items.length === 0) return '[]';
	if (node.flow === true) {
		return `[${items.map((item) => renderValue(item, ctx, indent)).join(', ')}]`;
	}
	// Each item's own text begins two columns in, just past the `- `.
	const inner = indent + '  ';
	return items.map((item) => `- ${renderValue(item, ctx, inner)}`).join(`\n${indent}`);
}

function renderTable(node: InlineTableNode, ctx: RenderContext, indent: string): string {
	if (node.entries.length === 0) return '{}';
	if (node.flow === true) {
		const parts = node.entries.map(
			(entry) => `${keyText(entry)}: ${renderValue(entry.value, ctx, indent)}`
		);
		return `{ ${parts.join(', ')} }`;
	}
	const inner = indent + '  ';
	const parts = node.entries.map((entry) => {
		const text = renderValue(entry.value, ctx, inner);
		if (isBlock(entry.value, ctx)) return `${keyText(entry)}:\n${inner}${text}`;
		return `${keyText(entry)}: ${text}`;
	});
	return parts.join(`\n${indent}`);
}

export const yaml: Format = {
	id: 'yaml',
	label: 'YAML',
	extensions: ['.yaml', '.yml'],
	commentMarker: '#',
	parse: parseYaml,
	validateDraft,
	serializeDraft,
	serializeScalar,
	renderArray,
	renderTable,
	// Indentation is the structure in YAML, so text reused at a new depth has
	// to move with it -- measured from the column the value starts at, which
	// in `- name: x` is two past the dash.
	reindent: (text: string, source: string, start: number, to: string) =>
		shiftIndent(text, columnIndent(source, start), to)
};
