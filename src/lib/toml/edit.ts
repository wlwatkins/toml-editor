import type { Span, TomlDocument, ValueNode } from './ast.ts';
import type { Drafts } from './serialize.ts';
import {
	lineIndent,
	renderValue,
	sameItems,
	serializeDraft,
	subtreeDirty,
	validateDraft
} from './serialize.ts';

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
export function collectEdits(doc: TomlDocument, drafts: Drafts): EditPlan {
	const edits: Edit[] = [];
	const errors: Record<number, string> = {};
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
		const error = validateDraft(node, draft);
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
					edits.push({ span: node.span, text: renderValue(node, drafts, source, indent) });
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
		const error = validateDraft(node, draft);
		if (error) {
			errors[node.id] = error;
			return;
		}
		const text = serializeDraft(node, draft);
		if (text !== source.slice(node.span.start, node.span.end)) {
			edits.push({ span: node.span, text });
		}
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
export function applyDrafts(doc: TomlDocument, drafts: Drafts): string {
	return applyEdits(doc.source, collectEdits(doc, drafts).edits);
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
			return {
				id,
				kind: 'string',
				value: '',
				style: template.style === 'literal' ? 'literal' : 'basic',
				span: null
			};
		case 'integer':
			return { id, kind: 'integer', raw: '0', value: 0, span: null };
		case 'float':
			return { id, kind: 'float', raw: '0.0', value: 0, span: null };
		case 'boolean':
			return { id, kind: 'boolean', value: false, span: null };
		case 'datetime':
			return { id, kind: 'datetime', sub: template.sub, raw: blankDateTime(template.sub), span: null };
		case 'array':
			return { id, kind: 'array', items: [], multiline: false, span: null };
		case 'inline-table':
			return {
				id,
				kind: 'inline-table',
				span: null,
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
export function hasChanges(doc: TomlDocument, drafts: Drafts): boolean {
	for (const table of doc.tables) {
		for (const entry of table.entries) {
			if (subtreeDirty(entry.value, drafts, doc.source)) return true;
		}
	}
	return false;
}
