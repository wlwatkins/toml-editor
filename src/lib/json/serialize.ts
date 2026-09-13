import type { ArrayNode, InlineTableNode, ScalarNode, ValueNode } from '../format/ast.ts';
import type { DraftContext, Format, RenderContext } from '../format/drafts.ts';
import { lineIndent, renderValue, shiftIndent } from '../format/drafts.ts';
import { parseJson, parseJsonc } from './parse.ts';

const RE_NUMBER_FULL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

/** Returns an error message, or null when the draft is a valid JSON value. */
export function validateDraft(node: ScalarNode, draft: string | boolean): string | null {
	if (node.kind === 'boolean' || node.kind === 'string') return null;

	const text = String(draft).trim();
	if (text === '') return 'Value is required';

	if (node.kind === 'literal') {
		if (!node.editable) return 'This value cannot be edited here';
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return 'Expected a JSON value (null, true, false, a number, or a quoted string)';
		}
		if (parsed !== null && typeof parsed === 'object') {
			return 'Expected a single value, not an object or an array';
		}
		return null;
	}

	if (node.kind === 'integer' || node.kind === 'float') {
		return RE_NUMBER_FULL.test(text) ? null : 'Not a valid JSON number (e.g. 42, -7, 1.5, 2e10)';
	}
	return null;
}

/**
 * Renders a draft as JSON source. Invalid drafts fall back to the raw text --
 * saving is blocked separately by {@link validateDraft}.
 */
export function serializeDraft(node: ScalarNode, draft: string | boolean): string {
	switch (node.kind) {
		case 'boolean':
			return draft ? 'true' : 'false';
		case 'string':
			return JSON.stringify(String(draft));
		default:
			return String(draft).trim();
	}
}

function serializeScalar(node: ScalarNode): string {
	switch (node.kind) {
		case 'string':
			return JSON.stringify(node.value);
		case 'boolean':
			return node.value ? 'true' : 'false';
		default:
			return node.raw;
	}
}

/**
 * The indentation step this file uses, read back from the container's own
 * source, so a re-rendered array matches the two-space or four-space or
 * tab-indented file it sits in.
 */
function indentStep(ctx: RenderContext, node: ValueNode, indent: string): string {
	if (!node.span) return '  ';
	const text = ctx.source.slice(node.span.start, node.span.end);
	const match = /\n([ \t]+)\S/.exec(text);
	if (!match) return '  ';
	const inner = match[1];
	return inner.startsWith(indent) ? inner.slice(indent.length) || '  ' : '  ';
}

function renderArray(
	node: ArrayNode,
	items: ValueNode[],
	ctx: RenderContext,
	indent: string
): string {
	if (items.length === 0) return '[]';
	const step = indentStep(ctx, node, indent);
	const inner = indent + step;
	const parts = items.map((item) => renderValue(item, ctx, inner));
	if (!node.multiline && !parts.some((part) => part.includes('\n'))) {
		const oneLine = `[${parts.join(', ')}]`;
		if (oneLine.length + indent.length <= 96) return oneLine;
	}
	return `[\n${parts.map((part) => inner + part).join(',\n')}\n${indent}]`;
}

function renderTable(node: InlineTableNode, ctx: RenderContext, indent: string): string {
	if (node.entries.length === 0) return '{}';
	const step = indentStep(ctx, node, indent);
	const multiline = node.flow !== true;
	const inner = multiline ? indent + step : indent;
	const parts = node.entries.map(
		(entry) =>
			`${JSON.stringify(entry.key[entry.key.length - 1] ?? entry.keyRaw)}: ${renderValue(entry.value, ctx, inner)}`
	);
	if (!multiline && !parts.some((part) => part.includes('\n'))) {
		return `{ ${parts.join(', ')} }`;
	}
	return `{\n${parts.map((part) => inner + part).join(',\n')}\n${indent}}`;
}

const shared = {
	validateDraft,
	serializeDraft: (node: ScalarNode, draft: string | boolean, _ctx: DraftContext) =>
		serializeDraft(node, draft),
	serializeScalar: (node: ScalarNode, _ctx: DraftContext) => serializeScalar(node),
	renderArray,
	renderTable,
	// JSON whitespace carries no meaning, so reused text can safely be moved to
	// a new depth -- and it looks wrong if it is not. Its block lines line up
	// with the start of the line the value opens on.
	reindent: (text: string, source: string, start: number, to: string) =>
		shiftIndent(text, lineIndent(source, start), to)
};

export const json: Format = {
	id: 'json',
	label: 'JSON',
	extensions: ['.json'],
	commentMarker: null,
	parse: parseJson,
	...shared
};

export const jsonc: Format = {
	id: 'jsonc',
	label: 'JSON with comments',
	extensions: ['.jsonc'],
	commentMarker: '//',
	parse: parseJsonc,
	...shared
};
