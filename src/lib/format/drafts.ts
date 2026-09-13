import type {
	ArrayNode,
	Document,
	InlineTableNode,
	ScalarNode,
	ValueNode
} from './ast.ts';

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

export type FormatId = 'toml' | 'json' | 'jsonc' | 'yaml';

/** What a scalar needs to know about its surroundings to be written back. */
export interface DraftContext {
	/** Leading whitespace of the line the value starts on. */
	indent: string;
	/** The exact source text of this node, or null for a synthetic one. */
	original: string | null;
}

/** Everything a container needs to re-render itself. */
export interface RenderContext {
	format: Format;
	drafts: Drafts;
	source: string;
}

/**
 * Everything that differs between TOML, JSON, JSONC and YAML.
 *
 * The document model, the draft bookkeeping and the edit planner are shared;
 * a format supplies only its own parser and its own value syntax.
 */
export interface Format {
	id: FormatId;
	/** Shown in the UI, e.g. "JSON with comments". */
	label: string;
	/** Lower-case, dot-prefixed, first one is the canonical extension. */
	extensions: string[];
	/** The marker a comment starts with, or null when the format has none. */
	commentMarker: string | null;
	parse(source: string): Document;
	/** Returns an error message, or null when the draft is a valid value. */
	validateDraft(node: ScalarNode, draft: string | boolean): string | null;
	/** Renders an edited leaf as source text. */
	serializeDraft(node: ScalarNode, draft: string | boolean, ctx: DraftContext): string;
	/** Renders an untouched leaf from its parsed value, ignoring drafts. */
	serializeScalar(node: ScalarNode, ctx: DraftContext): string;
	renderArray(node: ArrayNode, items: ValueNode[], ctx: RenderContext, indent: string): string;
	renderTable(node: InlineTableNode, ctx: RenderContext, indent: string): string;
	/**
	 * Re-indents source text that is being reused at a different depth, given
	 * where it came from. What counts as its old depth differs by format --
	 * JSON lines up with the start of its line, YAML with the column the value
	 * itself begins at -- so the format works it out rather than the caller.
	 *
	 * Only formats whose layout is whitespace-sensitive need this. TOML must
	 * not have it: shifting the lines of a multi-line string would change the
	 * string.
	 */
	reindent?(text: string, source: string, start: number, to: string): string;
}

/** The leading whitespace of the line containing `offset`. */
export function lineIndent(source: string, offset: number): string {
	const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
	const match = /^[ \t]*/.exec(source.slice(lineStart, offset));
	return match ? match[0] : '';
}

/**
 * Spaces as wide as the column `offset` sits at. In YAML the lines under a
 * value line up with the value itself, which is not the same as the start of
 * its line: in `- name: x` the mapping begins two columns past the dash.
 */
export function columnIndent(source: string, offset: number): string {
	const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
	return ' '.repeat(Math.max(0, offset - lineStart));
}

/** The context a leaf is written back in: where it sits, and what it said. */
export function draftContext(node: ValueNode, source: string, indent: string): DraftContext {
	if (!node.span) return { indent, original: null };
	return {
		// A value knows its own column, which is what block styles measure from.
		indent: lineIndent(source, node.span.start),
		original: source.slice(node.span.start, node.span.end)
	};
}

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

/** Item lists match when they hold the same nodes in the same order. */
export function sameItems(a: ValueNode[], b: ValueNode[]): boolean {
	return a.length === b.length && a.every((item, k) => item.id === b[k].id);
}

/** True when anything under `node` has been edited and needs re-rendering. */
export function subtreeDirty(node: ValueNode, ctx: RenderContext): boolean {
	if (node.kind === 'array') {
		const items = ctx.drafts.arrays[node.id];
		if (items && !sameItems(items, node.items)) return true;
		return (items ?? node.items).some((item) => subtreeDirty(item, ctx));
	}
	if (node.kind === 'inline-table') {
		return node.entries.some((entry) => subtreeDirty(entry.value, ctx));
	}
	const draft = ctx.drafts.scalars[node.id];
	if (draft === undefined) return false;
	if (!node.span) return true;
	const dc = draftContext(node, ctx.source, '');
	return ctx.format.serializeDraft(node, draft, dc) !== dc.original;
}

/**
 * Renders a value, reusing the untouched original source wherever possible so
 * that comments, spacing and number formatting survive a save.
 */
export function renderValue(node: ValueNode, ctx: RenderContext, indent: string): string {
	if (node.span && !subtreeDirty(node, ctx)) {
		const text = ctx.source.slice(node.span.start, node.span.end);
		// Reused text carries its old indentation on every line but the first,
		// which is wrong as soon as the value moves to a different depth.
		if (ctx.format.reindent && text.includes('\n')) {
			return ctx.format.reindent(text, ctx.source, node.span.start, indent);
		}
		return text;
	}
	if (node.kind === 'array') {
		return ctx.format.renderArray(node, ctx.drafts.arrays[node.id] ?? node.items, ctx, indent);
	}
	if (node.kind === 'inline-table') {
		return ctx.format.renderTable(node, ctx, indent);
	}
	const dc = draftContext(node, ctx.source, indent);
	const draft = ctx.drafts.scalars[node.id];
	if (draft === undefined) return ctx.format.serializeScalar(node, dc);
	return ctx.format.serializeDraft(node, draft, dc);
}

/**
 * Shifts every line but the first from one indent to another, leaving the
 * relative shape of the block alone.
 */
export function shiftIndent(text: string, from: string, to: string): string {
	const lines = text.split('\n');
	return lines
		.map((line, i) => {
			if (i === 0) return line;
			if (line.trim() === '') return line;
			return line.startsWith(from) ? to + line.slice(from.length) : line;
		})
		.join('\n');
}

/** Convenience for callers that only have a document and its drafts. */
export function contextFor(doc: Document, drafts: Drafts, format: Format): RenderContext {
	return { format, drafts, source: doc.source };
}
