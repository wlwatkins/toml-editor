import type { Document, Span, StringStyle, ValueNode } from './ast.ts';
import type { Drafts, Format, RenderContext } from './drafts.ts';
import {
	contextFor,
	draftContext,
	lineIndent,
	renderValue,
	sameItems,
	subtreeDirty
} from './drafts.ts';

export interface Edit {
	span: Span;
	text: string;
}

export interface EditPlan {
	edits: Edit[];
	/** Validation messages keyed by node id; a non-empty map blocks saving. */
	errors: Record<number, string>;
}

/**
 * Walks the document and turns pending drafts into the smallest set of source
 * replacements that expresses them.
 *
 * Scalars are patched individually, so untouched lines -- including every
 * comment, blank line and alignment choice -- come through a save untouched.
 * An array whose item list changed is re-rendered as a whole, since there is no
 * original text for the items that were just added.
 */
export function collectEdits(doc: Document, drafts: Drafts, format: Format): EditPlan {
	const edits: Edit[] = [];
	const errors: Record<number, string> = {};
	const ctx: RenderContext = contextFor(doc, drafts, format);
	const source = doc.source;

	const validateSubtree = (node: ValueNode) => {
		if (node.kind === 'array') {
			for (const item of drafts.arrays[node.id] ?? node.items) validateSubtree(item);
			return;
		}
		if (node.kind === 'inline-table') {
			for (const entry of node.entries) validateSubtree(entry.value);
			return;
		}
		const draft = drafts.scalars[node.id];
		if (draft === undefined) return;
		const error = format.validateDraft(node, draft);
		if (error) errors[node.id] = error;
	};

	const visit = (node: ValueNode, indent: string) => {
		if (node.kind === 'array') {
			const items = drafts.arrays[node.id];
			const structural = items !== undefined && !sameItems(items, node.items);
			if (structural) {
				// The whole array is rewritten, so nothing inside it needs its own edit.
				validateSubtree(node);
				if (node.span) {
					const at = lineIndent(source, node.span.start);
					edits.push({ span: node.span, text: renderValue(node, ctx, at) });
				}
				return;
			}
			for (const item of node.items) visit(item, indent);
			return;
		}
		if (node.kind === 'inline-table') {
			for (const entry of node.entries) visit(entry.value, indent);
			return;
		}

		const draft = drafts.scalars[node.id];
		if (draft === undefined || !node.span) return;
		const error = format.validateDraft(node, draft);
		if (error) {
			errors[node.id] = error;
			return;
		}
		const dc = draftContext(node, source, indent);
		const text = format.serializeDraft(node, draft, dc);
		if (text !== dc.original) edits.push({ span: node.span, text });
	};

	for (const table of doc.tables) {
		for (const entry of table.entries) {
			visit(entry.value, lineIndent(source, entry.span.start));
		}
	}
	return { edits, errors };
}

/** Applies non-overlapping replacements back-to-front so offsets stay valid. */
export function applyEdits(source: string, edits: Edit[]): string {
	const ordered = [...edits].sort((a, b) => b.span.start - a.span.start);
	let out = source;
	let previousStart = Number.POSITIVE_INFINITY;
	for (const edit of ordered) {
		if (edit.span.end > previousStart) {
			throw new Error('internal error: overlapping edits');
		}
		out = out.slice(0, edit.span.start) + edit.text + out.slice(edit.span.end);
		previousStart = edit.span.start;
	}
	return out;
}

/** Convenience wrapper: drafts in, new file text out. */
export function applyDrafts(doc: Document, drafts: Drafts, format: Format): string {
	return applyEdits(doc.source, collectEdits(doc, drafts, format).edits);
}

let syntheticId = -1;

/**
 * Builds a fresh array item. Existing items act as a template so that adding to
 * an array of inline tables reproduces its shape with blank values.
 */
export function makeItem(template: ValueNode | undefined): ValueNode {
	const id = syntheticId--;
	if (!template) return { id, kind: 'string', value: '', style: 'basic', span: null };

	switch (template.kind) {
		case 'string':
			return { id, kind: 'string', value: '', style: blankStyle(template.style), span: null };
		case 'integer':
			return { id, kind: 'integer', raw: '0', value: 0, span: null };
		case 'float':
			return { id, kind: 'float', raw: '0.0', value: 0, span: null };
		case 'boolean':
			return { id, kind: 'boolean', value: false, span: null };
		case 'datetime':
			return { id, kind: 'datetime', sub: template.sub, raw: blankDateTime(template.sub), span: null };
		case 'literal':
			// A new item modelled on `null` starts out null; one modelled on an
			// alias cannot be reproduced, so it starts out null too.
			return { id, kind: 'literal', raw: 'null', label: 'null', editable: true, span: null };
		case 'array':
			return { id, kind: 'array', items: [], multiline: false, flow: template.flow, span: null };
		case 'inline-table':
			return {
				id,
				kind: 'inline-table',
				span: null,
				flow: template.flow,
				entries: template.entries.map((entry) => ({
					id: syntheticId--,
					key: entry.key,
					keyRaw: entry.keyRaw,
					value: makeItem(entry.value),
					span: { start: 0, end: 0 },
					leadingComments: [],
					detachedComments: [],
					trailingComment: null,
					path: entry.path
				}))
			};
	}
}

/** A new string keeps the quoting family of its template, but never its length. */
function blankStyle(style: StringStyle): StringStyle {
	switch (style) {
		case 'literal':
		case 'multiline-literal':
			return 'literal';
		case 'json':
			return 'json';
		case 'single':
			return 'single';
		case 'double':
		case 'block-literal':
		case 'block-folded':
			return 'double';
		case 'plain':
			return 'plain';
		default:
			return 'basic';
	}
}

function blankDateTime(sub: 'offset' | 'local' | 'date' | 'time'): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
	switch (sub) {
		case 'date':
			return date;
		case 'time':
			return time;
		case 'local':
			return `${date}T${time}`;
		case 'offset':
			return `${date}T${time}Z`;
	}
}

/** True when any draft differs from the source. */
export function hasChanges(doc: Document, drafts: Drafts, format: Format): boolean {
	const ctx = contextFor(doc, drafts, format);
	for (const table of doc.tables) {
		for (const entry of table.entries) {
			if (subtreeDirty(entry.value, ctx)) return true;
		}
	}
	return false;
}
