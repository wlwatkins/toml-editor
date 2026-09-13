import type {
	ArrayNode,
	InlineTableNode,
	ScalarNode,
	StringStyle,
	ValueNode
} from '../format/ast.ts';
import type { DraftContext, Format, RenderContext } from '../format/drafts.ts';
import { renderValue } from '../format/drafts.ts';
import { parseToml } from './parse.ts';

const RE_DEC_INT = /^[+-]?(0|[1-9](_?[0-9])*)$/;
const RE_RADIX_INT = /^(0x[0-9A-Fa-f](_?[0-9A-Fa-f])*|0o[0-7](_?[0-7])*|0b[01](_?[01])*)$/;
const RE_FLOAT_FULL =
	/^([+-]?(inf|nan)|[+-]?(0|[1-9](_?[0-9])*)((\.[0-9](_?[0-9])*)([eE][+-]?[0-9](_?[0-9])*)?|([eE][+-]?[0-9](_?[0-9])*)))$/;
const RE_OFFSET_DT_FULL = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/;
const RE_LOCAL_DT_FULL = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const RE_DATE_FULL = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME_FULL = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Returns an error message, or null when the draft is a valid TOML value. */
export function validateDraft(node: ScalarNode, draft: string | boolean): string | null {
	if (node.kind === 'boolean') return null;
	if (node.kind === 'string') return null;
	// TOML has no null and no aliases, so a literal node never reaches here.
	if (node.kind === 'literal') return null;

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

/** Serialises a leaf straight from its parsed value, ignoring drafts. */
function serializeScalar(node: ScalarNode): string {
	switch (node.kind) {
		case 'string':
			return serializeString(node.value, node.style);
		case 'boolean':
			return node.value ? 'true' : 'false';
		default:
			return node.raw;
	}
}

function renderArray(
	node: ArrayNode,
	items: ValueNode[],
	ctx: RenderContext,
	indent: string
): string {
	if (items.length === 0) return '[]';
	const inner = indent + '  ';
	const parts = items.map((item) => renderValue(item, ctx, inner));
	const oneLine = `[${parts.join(', ')}]`;
	if (!node.multiline && !oneLine.includes('\n') && oneLine.length + indent.length <= 96) {
		return oneLine;
	}
	return `[\n${parts.map((part) => inner + part).join(',\n')},\n${indent}]`;
}

function renderTable(node: InlineTableNode, ctx: RenderContext, indent: string): string {
	if (node.entries.length === 0) return '{}';
	const parts = node.entries.map(
		(entry) => `${entry.keyRaw} = ${renderValue(entry.value, ctx, indent)}`
	);
	return `{ ${parts.join(', ')} }`;
}

export const toml: Format = {
	id: 'toml',
	label: 'TOML',
	extensions: ['.toml', '.tml'],
	commentMarker: '#',
	parse: parseToml,
	validateDraft,
	serializeDraft: (node: ScalarNode, draft: string | boolean, _ctx: DraftContext) =>
		serializeDraft(node, draft),
	serializeScalar: (node: ScalarNode, _ctx: DraftContext) => serializeScalar(node),
	renderArray,
	renderTable
	// No `reindent`: shifting the lines of a multi-line string would change it.
};
