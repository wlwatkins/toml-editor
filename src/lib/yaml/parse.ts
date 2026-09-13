import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { Alias, Node, Scalar, YAMLMap, YAMLSeq } from 'yaml';
import type {
	ArrayNode,
	Document,
	Entry,
	InlineTableNode,
	Span,
	StringStyle,
	TableNode,
	ValueNode
} from '../format/ast.ts';
import { ParseError, parseErrorAt, stripCommentMarker } from '../format/ast.ts';

/**
 * YAML is read with the `yaml` package rather than a parser of our own: its
 * node tree carries a source range for every node, which is exactly what the
 * edit planner needs, and getting YAML 1.2 right by hand is not a weekend's
 * work.
 *
 * What is ours is the mapping onto the shared document model, and the rule
 * about what may be edited: a value the parser can see but cannot safely
 * rewrite -- an alias, a tagged node -- becomes a read-only literal rather
 * than being silently dropped.
 */

const STYLES: Record<string, StringStyle> = {
	PLAIN: 'plain',
	QUOTE_SINGLE: 'single',
	QUOTE_DOUBLE: 'double',
	BLOCK_LITERAL: 'block-literal',
	BLOCK_FOLDED: 'block-folded'
};

class Builder {
	private src: string;
	private nextId = 1;
	private tables: TableNode[] = [];

	constructor(src: string) {
		this.src = src;
	}

	private id() {
		return this.nextId++;
	}

	/**
	 * The node's own text, with any trailing newline left outside.
	 *
	 * A block scalar's range runs past the final line break, and a block
	 * collection's runs to the end of its last item; keeping the break out of
	 * the span means an edit replaces the value and nothing else.
	 */
	private spanOf(node: Node | Alias): Span | null {
		const range = node.range;
		if (!range) return null;
		let start = range[0];
		let end = range[1];
		while (end > start && (this.src[end - 1] === '\n' || this.src[end - 1] === '\r')) end--;
		// An anchor sits just before the value it names and is not part of the
		// node's range, so reusing the text without it would lose the anchor.
		const anchor = (node as { anchor?: string }).anchor;
		if (anchor) {
			const marker = `&${anchor}`;
			const before = this.src.lastIndexOf(marker, start);
			if (before >= 0 && /^[ \t\n\r]*$/.test(this.src.slice(before + marker.length, start))) {
				start = before;
			}
		}
		return { start, end };
	}

	private text(span: Span | null): string {
		return span ? this.src.slice(span.start, span.end) : '';
	}

	// ---- comments ---------------------------------------------------------

	/**
	 * The last block of a comment run is the one touching the key; anything
	 * above it is detached, exactly as in the TOML reader.
	 */
	private commentBlocks(text: string | null | undefined): {
		leading: string[];
		detached: string[][];
	} {
		if (!text) return { leading: [], detached: [] };
		const blocks = commentRun(text);
		// A blank line before the key detaches the whole run from it.
		const detachedAll = /\n\s*$/.test(text);
		if (detachedAll || blocks.length === 0) return { leading: [], detached: blocks };
		return { leading: blocks[blocks.length - 1], detached: blocks.slice(0, -1) };
	}

	// ---- values -----------------------------------------------------------

	private literal(span: Span | null, label: string, editable: boolean): ValueNode {
		return { id: this.id(), kind: 'literal', raw: this.text(span), label, editable, span };
	}

	private value(node: unknown): ValueNode {
		if (isAlias(node)) {
			// `*ref` stands for a value defined elsewhere; rewriting the reference
			// here would not change what it points at.
			return this.literal(this.spanOf(node), 'alias', false);
		}
		if (isMap(node)) return this.inlineTable(node);
		if (isSeq(node)) return this.array(node);
		if (isScalar(node)) return this.scalar(node);
		// An unrecognised node still has a range, so it can at least be shown.
		const span = node && typeof node === 'object' && 'range' in node ? this.spanOf(node as Node) : null;
		return this.literal(span, 'raw', false);
	}

	private scalar(node: Scalar): ValueNode {
		const span = this.spanOf(node);
		const raw = this.text(span);
		// A tag changes what the text means; we cannot re-serialise it safely.
		if (node.tag) return this.literal(span, 'tagged', false);

		const value = node.value;
		if (value === null || value === undefined) {
			return { id: this.id(), kind: 'literal', raw, label: 'null', editable: true, span };
		}
		if (typeof value === 'boolean') {
			return { id: this.id(), kind: 'boolean', value, span };
		}
		if (typeof value === 'number') {
			if (Number.isInteger(value) && !/[.eE]/.test(raw) && Number.isFinite(value)) {
				return { id: this.id(), kind: 'integer', raw, value, span };
			}
			return { id: this.id(), kind: 'float', raw, value, span };
		}
		if (typeof value === 'string') {
			const style = STYLES[String(node.type ?? 'PLAIN')] ?? 'plain';
			return { id: this.id(), kind: 'string', value, style, span };
		}
		return this.literal(span, 'raw', false);
	}

	private array(node: YAMLSeq): ArrayNode {
		const span = this.spanOf(node);
		const items = node.items.map((item) => this.value(item));
		return {
			id: this.id(),
			kind: 'array',
			items,
			multiline: !node.flow,
			flow: node.flow === true,
			span
		};
	}

	private inlineTable(node: YAMLMap): InlineTableNode {
		return {
			id: this.id(),
			kind: 'inline-table',
			entries: this.entriesOf(node),
			flow: node.flow === true,
			span: this.spanOf(node)
		};
	}

	/** Turns a mapping's pairs into entries, keeping whatever comments they carry. */
	private entriesOf(node: YAMLMap): Entry[] {
		const out: Entry[] = [];
		for (const pair of node.items) {
			const key = (pair.key ?? null) as Scalar | null;
			const keySpan = key ? this.spanOf(key) : null;
			// A complex key (`? [a, b]`) is not a scalar, so it is named by the
			// text the file used for it.
			const keyText = key && isScalar(key) ? String(key.value) : this.text(keySpan);
			const valueSpan = pair.value ? this.spanOf(pair.value as Node) : null;
			const comments = this.commentBlocks(
				(key as { commentBefore?: string | null } | null)?.commentBefore
			);
			const trailing =
				(pair.value as { comment?: string | null } | null)?.comment ??
				(key as { comment?: string | null } | null)?.comment ??
				null;

			out.push({
				id: this.id(),
				key: [keyText],
				keyRaw: keyText,
				value: this.value(pair.value),
				span: {
					start: keySpan?.start ?? valueSpan?.start ?? 0,
					end: valueSpan?.end ?? keySpan?.end ?? 0
				},
				leadingComments: comments.leading,
				detachedComments: comments.detached,
				trailingComment: trailing ? stripCommentMarker(trailing) : null,
				path: [keyText]
			});
		}
		return out;
	}

	// ---- document shape ---------------------------------------------------

	/**
	 * A mapping reached from a table becomes a table of its own, the same way a
	 * TOML `[section]` does; a mapping reached from inside a sequence stays an
	 * inline table, because that is a list of records rather than a section.
	 */
	build(contents: unknown, banner: string[][]): TableNode[] {
		const rootTable: TableNode = {
			id: this.id(),
			kind: 'root',
			path: [],
			headerRaw: '',
			headerSpan: null,
			leadingComments: [],
			detachedComments: banner,
			trailingComment: null,
			entries: []
		};
		this.tables = [rootTable];

		if (contents === null || contents === undefined) return this.tables;

		if (!isMap(contents)) {
			const value = this.value(contents);
			rootTable.entries.push({
				id: this.id(),
				key: [],
				keyRaw: '(document)',
				value,
				span: value.span ?? { start: 0, end: 0 },
				leadingComments: [],
				detachedComments: [],
				trailingComment: null,
				path: []
			});
			return this.tables;
		}

		this.walk(this.entriesOf(contents), rootTable, []);

		return this.tables.filter(
			(table) =>
				table.kind === 'root' ||
				table.entries.length > 0 ||
				table.leadingComments.length > 0 ||
				table.detachedComments.length > 0
		);
	}

	private walk(entries: Entry[], table: TableNode, path: string[]) {
		for (const entry of entries) {
			const childPath = [...path, entry.keyRaw];
			const value = entry.value;
			// A flow mapping (`{ a: 1 }`) is written as one value, so it reads as
			// one field rather than as a section of its own.
			if (value.kind === 'inline-table' && value.flow !== true) {
				const child: TableNode = {
					id: this.id(),
					kind: 'table',
					path: childPath,
					headerRaw: childPath.join('.'),
					headerSpan: entry.span,
					leadingComments: entry.leadingComments,
					detachedComments: entry.detachedComments,
					trailingComment: entry.trailingComment,
					entries: []
				};
				this.tables.push(child);
				this.walk(value.entries, child, childPath);
				continue;
			}
			let detachedComments = entry.detachedComments;
			// A banner above the first key describes the file, not that key.
			if (table.kind === 'root' && table.entries.length === 0 && detachedComments.length > 0) {
				table.detachedComments.push(...detachedComments);
				detachedComments = [];
			}
			table.entries.push({ ...entry, detachedComments, path: childPath });
		}
	}
}

export function parseYaml(source: string): Document {
	const documents = parseAllDocuments(source, { prettyErrors: false });

	if (documents.length === 0) {
		return { source, tables: new Builder(source).build(null, []) };
	}
	if (documents.length > 1) {
		throw new ParseError(
			'This file holds several YAML documents separated by "---", which this editor cannot edit safely.',
			0,
			0,
			0
		);
	}

	const doc = documents[0];
	const failure = doc.errors[0];
	if (failure) {
		throw parseErrorAt(source, failure.message.replace(/\s*at line \d+.*$/i, ''), failure.pos[0]);
	}

	const builder = new Builder(source);
	const banner = doc.commentBefore ? commentRun(doc.commentBefore) : [];
	return { source, tables: builder.build(doc.contents, banner) };
}

/**
 * Splits a run of comment text into blocks, one per run of adjacent lines.
 * The `yaml` package hands the whole run over as one string, with a blank
 * line in the file showing up as an empty line here.
 */
function commentRun(text: string): string[][] {
	const blocks: string[][] = [];
	let current: string[] = [];
	for (const line of text.split('\n')) {
		if (line.trim() === '') {
			if (current.length) blocks.push(current);
			current = [];
			continue;
		}
		current.push(stripCommentMarker(line));
	}
	if (current.length) blocks.push(current);
	return blocks;
}
