/**
 * Text filtering for the form view.
 *
 * A field is kept when the query appears in its key, in its value, or -- only
 * while comments are being shown -- in its comments. Hiding a comment and then
 * matching on it would make fields appear for a reason the user cannot see, so
 * the comment mode decides whether comments are part of the haystack at all.
 *
 * Plain TS on purpose: it reads the document model and the editor's drafts
 * through a small interface rather than importing either.
 */

import type { ArrayNode, Document, Entry, ScalarNode, TableNode, ValueNode } from './format/ast.ts';

/** The part of the editor the filter needs: current values, including drafts. */
export interface ValueSource {
	textOf(node: ScalarNode): string;
	itemsOf(node: ArrayNode): ValueNode[];
}

export interface FilterOptions {
	/** False when comments are hidden, which keeps them out of the search. */
	comments: boolean;
	source: ValueSource;
}

export interface FilterResult {
	/** Tables with something left to show. */
	tables: Set<number>;
	/** Entries to render. A table whose own name matched keeps all of its own. */
	entries: Set<number>;
	/** Entries kept, for the count beside the field. */
	count: number;
}

const contains = (haystack: string | null | undefined, needle: string) =>
	!!haystack && haystack.toLowerCase().includes(needle);

const some = (parts: (string | null)[], needle: string) =>
	parts.some((part) => contains(part, needle));

/** Every piece of text a value shows, flattened: nested keys and leaves alike. */
function valueText(node: ValueNode, opts: FilterOptions, out: string[]) {
	if (node.kind === 'array') {
		for (const item of opts.source.itemsOf(node)) valueText(item, opts, out);
		return;
	}
	if (node.kind === 'inline-table') {
		for (const entry of node.entries) {
			out.push(entry.keyRaw);
			if (opts.comments) commentText(entry, out);
			valueText(entry.value, opts, out);
		}
		return;
	}
	out.push(opts.source.textOf(node));
}

function commentText(node: Entry | TableNode, out: string[]) {
	for (const block of node.detachedComments) out.push(...block);
	out.push(...node.leadingComments);
	if (node.trailingComment) out.push(node.trailingComment);
}

function entryMatches(entry: Entry, needle: string, opts: FilterOptions): boolean {
	if (some([entry.keyRaw, entry.key.join('.'), entry.path.join('.')], needle)) return true;

	const text: string[] = [];
	valueText(entry.value, opts, text);
	if (opts.comments) commentText(entry, text);
	return some(text, needle);
}

function tableMatches(table: TableNode, needle: string, opts: FilterOptions): boolean {
	if (some([table.headerRaw, table.path.join('.')], needle)) return true;
	if (!opts.comments) return false;
	const text: string[] = [];
	commentText(table, text);
	return some(text, needle);
}

/**
 * Works out what the form should show. `null` means "no query", which is not
 * the same as a query that matched nothing.
 */
export function filterDocument(
	doc: Document,
	query: string,
	opts: FilterOptions
): FilterResult | null {
	const needle = query.trim().toLowerCase();
	if (!needle) return null;

	const tables = new Set<number>();
	const entries = new Set<number>();
	let count = 0;

	for (const table of doc.tables) {
		// A section named by the query is shown whole; otherwise only the fields
		// that matched on their own.
		const whole = tableMatches(table, needle, opts);
		let kept = 0;
		for (const entry of table.entries) {
			if (!whole && !entryMatches(entry, needle, opts)) continue;
			entries.add(entry.id);
			kept++;
		}
		if (kept > 0 || (whole && table.entries.length === 0)) tables.add(table.id);
		count += kept;
	}

	return { tables, entries, count };
}
