import type { ScalarNode, StringStyle, ValueNode } from './ast.ts';

/**
 * Pending user edits, keyed by node id.
 *
 * `scalars` holds the editable text (or boolean) for a leaf value; a missing
 * entry means "untouched", which lets us reproduce the original source byte for
 * byte instead of re-serialising it.
 *
 * `arrays` holds a replacement item list for an array whose length or order the
 * user changed.
 */
export interface Drafts {
	scalars: Record<number, string | boolean>;
	arrays: Record<number, ValueNode[]>;
}

export const emptyDrafts = (): Drafts => ({ scalars: {}, arrays: {} });

const RE_DEC_INT = /^[+-]?(0|[1-9](_?[0-9])*)$/;
const RE_RADIX_INT = /^(0x[0-9A-Fa-f](_?[0-9A-Fa-f])*|0o[0-7](_?[0-7])*|0b[01](_?[01])*)$/;
const RE_FLOAT_FULL =
	/^([+-]?(inf|nan)|[+-]?(0|[1-9](_?[0-9])*)((\.[0-9](_?[0-9])*)([eE][+-]?[0-9](_?[0-9])*)?|([eE][+-]?[0-9](_?[0-9])*)))$/;
const RE_OFFSET_DT_FULL = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/;
const RE_LOCAL_DT_FULL = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const RE_DATE_FULL = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME_FULL = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** The editable representation of a leaf value, before the user touches it. */
export function originalDraft(node: ScalarNode): string | boolean {
	switch (node.kind) {
		case 'string':
			return node.value;
		case 'boolean':
			return node.value;
		default:
			return node.raw;
	}
}

/** Returns an error message, or null when the draft is a valid TOML value. */
export function validateDraft(node: ScalarNode, draft: string | boolean): string | null {
	if (node.kind === 'boolean') return null;
	if (node.kind === 'string') return null;

	const text = String(draft).trim();
	if (text === '') return 'Value is required';

	switch (node.kind) {
		case 'integer':
			return RE_DEC_INT.test(text) || RE_RADIX_INT.test(text)
				? null
				: 'Not a valid TOML integer (e.g. 42, -7, 1_000, 0xff)';
		case 'float':
			// A bare integer is accepted and normalised to `N.0` on save.
			return RE_FLOAT_FULL.test(text) || RE_DEC_INT.test(text)
				? null
				: 'Not a valid TOML float (e.g. 3.14, -1e6, inf)';
		case 'datetime':
			switch (node.sub) {
				case 'offset':
					return RE_OFFSET_DT_FULL.test(text)
						? null
						: 'Expected an offset date-time (e.g. 1979-05-27T07:32:00Z)';
				case 'local':
					return RE_LOCAL_DT_FULL.test(text)
						? null
						: 'Expected a local date-time (e.g. 1979-05-27T07:32:00)';
				case 'date':
					return RE_DATE_FULL.test(text) ? null : 'Expected a date (e.g. 1979-05-27)';
				case 'time':
					return RE_TIME_FULL.test(text) ? null : 'Expected a time (e.g. 07:32:00)';
			}
	}
	return null;
}

/**
 * Renders a draft as TOML source. Invalid drafts fall back to the raw text --
 * saving is blocked separately by {@link validateDraft}, so this never has to
 * throw mid-render.
 */
export function serializeDraft(node: ScalarNode, draft: string | boolean): string {
	switch (node.kind) {
		case 'boolean':
			return draft ? 'true' : 'false';
		case 'string':
			return serializeString(String(draft), node.style);
		case 'float': {
			const text = String(draft).trim();
			return RE_DEC_INT.test(text) ? `${text}.0` : text;
		}
		default:
			return String(draft).trim();
	}
}

const ESCAPES: Record<string, string> = {
	'"': '\\"',
	'\\': '\\\\',
	'\n': '\\n',
	'\r': '\\r',
	'\t': '\\t',
	'\b': '\\b',
	'\f': '\\f'
};

function escapeBasic(value: string): string {
	let out = '';
	for (const chr of value) {
		const mapped = ESCAPES[chr];
		if (mapped !== undefined) {
			out += mapped;
			continue;
		}
		const code = chr.codePointAt(0) ?? 0;
		out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : chr;
	}
	return out;
}

/** Multi-line basic strings keep real newlines and tabs; everything else escapes. */
function escapeMultilineBasic(value: string): string {
	let out = '';
	for (const chr of value) {
		if (chr === '\\') {
			out += '\\\\';
			continue;
		}
		if (chr === '\n' || chr === '\t' || chr === '\r') {
			out += chr;
			continue;
		}
		const code = chr.codePointAt(0) ?? 0;
		out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : chr;
	}
	// A run of three quotes would close the string early.
	return out.replace(/"{3,}/g, (run) => '\\"'.repeat(run.length));
}

/** True when the value holds a control character that literal quoting cannot express. */
function hasControl(value: string): boolean {
	for (const chr of value) {
		const code = chr.codePointAt(0) ?? 0;
		if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
	}
	return false;
}

/**
 * Renders a string value, keeping the quoting style the file already used
 * whenever that style can still represent the value.
 */
export function serializeString(value: string, preferred: StringStyle): string {
	const multilineWanted =
		value.includes('\n') || preferred === 'multiline-basic' || preferred === 'multiline-literal';

	if (multilineWanted) {
		const literalOk =
			preferred === 'multiline-literal' &&
			!value.includes("'''") &&
			!value.endsWith("'") &&
			!value.includes('\r') &&
			!hasControl(value);
		if (literalOk) return `'''\n${value}'''`;
		return `"""\n${escapeMultilineBasic(value)}"""`;
	}

	const literalOk =
		preferred === 'literal' && !value.includes("'") && !value.includes('\r') && !hasControl(value);
	if (literalOk) return `'${value}'`;
	return `"${escapeBasic(value)}"`;
}

/** Serialises a node straight from its parsed value, ignoring drafts. */
function serializeNode(node: ValueNode, drafts: Drafts, source: string, indent: string): string {
	switch (node.kind) {
		case 'string':
			return serializeString(node.value, node.style);
		case 'boolean':
			return node.value ? 'true' : 'false';
		case 'integer':
		case 'float':
		case 'datetime':
			return node.raw;
		case 'array':
			return renderArray(node.multiline, drafts.arrays[node.id] ?? node.items, drafts, source, indent);
		case 'inline-table':
			return renderInlineTable(node.entries, drafts, source, indent);
	}
}

/** True when anything under `node` has been edited and needs re-rendering. */
export function subtreeDirty(node: ValueNode, drafts: Drafts, source: string): boolean {
	if (node.kind === 'array') {
		const items = drafts.arrays[node.id];
		if (items && !sameItems(items, node.items)) return true;
		return (items ?? node.items).some((item) => subtreeDirty(item, drafts, source));
	}
	if (node.kind === 'inline-table') {
		return node.entries.some((entry) => subtreeDirty(entry.value, drafts, source));
	}
	const draft = drafts.scalars[node.id];
	if (draft === undefined) return false;
	if (!node.span) return true;
	return serializeDraft(node, draft) !== source.slice(node.span.start, node.span.end);
}

/** Item lists match when they hold the same nodes in the same order. */
export function sameItems(a: ValueNode[], b: ValueNode[]): boolean {
	return a.length === b.length && a.every((item, k) => item.id === b[k].id);
}

/**
 * Renders a value, reusing the untouched original source wherever possible so
 * that comments, spacing and number formatting survive a save.
 */
export function renderValue(
	node: ValueNode,
	drafts: Drafts,
	source: string,
	indent: string
): string {
	if (node.span && !subtreeDirty(node, drafts, source)) {
		return source.slice(node.span.start, node.span.end);
	}
	if (node.kind === 'array' || node.kind === 'inline-table') {
		return serializeNode(node, drafts, source, indent);
	}
	const draft = drafts.scalars[node.id];
	if (draft === undefined) return serializeNode(node, drafts, source, indent);
	return serializeDraft(node, draft);
}

function renderArray(
	multiline: boolean,
	items: ValueNode[],
	drafts: Drafts,
	source: string,
	indent: string
): string {
	if (items.length === 0) return '[]';
	const inner = indent + '  ';
	const parts = items.map((item) => renderValue(item, drafts, source, inner));
	const oneLine = `[${parts.join(', ')}]`;
	if (!multiline && !oneLine.includes('\n') && oneLine.length + indent.length <= 96) {
		return oneLine;
	}
	return `[\n${parts.map((part) => inner + part).join(',\n')},\n${indent}]`;
}

function renderInlineTable(
	entries: { keyRaw: string; value: ValueNode }[],
	drafts: Drafts,
	source: string,
	indent: string
): string {
	if (entries.length === 0) return '{}';
	const parts = entries.map(
		(entry) => `${entry.keyRaw} = ${renderValue(entry.value, drafts, source, indent)}`
	);
	return `{ ${parts.join(', ')} }`;
}

/** The leading whitespace of the line containing `offset`. */
export function lineIndent(source: string, offset: number): string {
	const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
	const match = /^[ \t]*/.exec(source.slice(lineStart, offset));
	return match ? match[0] : '';
}
