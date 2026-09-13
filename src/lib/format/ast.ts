/**
 * The document model every format parses into.
 *
 * It is deliberately TOML-shaped -- tables of entries, each entry holding one
 * value -- because that shape is what the form UI renders. JSON and YAML map
 * onto it: an object reached from a table becomes a table of its own, and an
 * object reached from inside an array stays an inline table.
 */

/**
 * A span of characters in the original source text.
 * `null` spans belong to synthetic nodes (e.g. an array item the user just added)
 * which have no representation in the file yet.
 */
export interface Span {
	start: number;
	end: number;
}

/**
 * How a string was written. Each format only ever emits its own styles; the
 * union is shared so that {@link StringNode} stays format-neutral.
 */
export type StringStyle =
	// TOML
	| 'basic'
	| 'literal'
	| 'multiline-basic'
	| 'multiline-literal'
	// JSON and JSONC -- only one way to write a string
	| 'json'
	// YAML
	| 'plain'
	| 'single'
	| 'double'
	| 'block-literal'
	| 'block-folded';

export type DateTimeKind = 'offset' | 'local' | 'date' | 'time';

interface NodeBase {
	/** Unique within a parsed document; used to key draft edits. */
	id: number;
	span: Span | null;
}

export interface StringNode extends NodeBase {
	kind: 'string';
	value: string;
	style: StringStyle;
}
export interface IntegerNode extends NodeBase {
	kind: 'integer';
	raw: string;
	value: number;
}
export interface FloatNode extends NodeBase {
	kind: 'float';
	raw: string;
	value: number;
}
export interface BooleanNode extends NodeBase {
	kind: 'boolean';
	value: boolean;
}
export interface DateTimeNode extends NodeBase {
	kind: 'datetime';
	sub: DateTimeKind;
	raw: string;
}
/**
 * A leaf that is edited as the literal text the file holds, rather than as a
 * typed value: `null`, YAML's `~`, and anything the parser can see but not
 * model (an alias, a tagged node). `editable` is false for the latter -- the
 * form shows the text and refuses to change it, because rewriting it would
 * change what the file means somewhere else.
 */
export interface LiteralNode extends NodeBase {
	kind: 'literal';
	raw: string;
	/** The badge shown next to the field: `null`, `alias`, `tagged`. */
	label: string;
	editable: boolean;
}
export interface ArrayNode extends NodeBase {
	kind: 'array';
	items: ValueNode[];
	/** True when the array spanned multiple lines in the source. */
	multiline: boolean;
	/** YAML only: false for a block sequence, true for `[a, b]`. */
	flow?: boolean;
}
export interface InlineTableNode extends NodeBase {
	kind: 'inline-table';
	entries: Entry[];
	/** YAML only: false for a block mapping, true for `{ a: 1 }`. */
	flow?: boolean;
}

export type ValueNode =
	| StringNode
	| IntegerNode
	| FloatNode
	| BooleanNode
	| DateTimeNode
	| LiteralNode
	| ArrayNode
	| InlineTableNode;

export type ScalarNode =
	| StringNode
	| IntegerNode
	| FloatNode
	| BooleanNode
	| DateTimeNode
	| LiteralNode;

export interface Entry {
	id: number;
	/** Dotted key split into parts, with quotes resolved. */
	key: string[];
	/** The key exactly as written, including any quoting. */
	keyRaw: string;
	value: ValueNode;
	/** Covers `key = value`, excluding any trailing comment. */
	span: Span;
	/** Comment lines directly above, with the marker and surrounding space stripped. */
	leadingComments: string[];
	/**
	 * Further comment blocks above that one, each separated from the next by a
	 * blank line. They still belong here -- they are just not touching the key.
	 */
	detachedComments: string[][];
	/** Comment on the same line, if any. */
	trailingComment: string | null;
	/** Full path including the containing table's path. */
	path: string[];
}

export interface TableNode {
	id: number;
	kind: 'root' | 'table' | 'array-table';
	path: string[];
	/** `[server.http]` exactly as written; empty for the root table. */
	headerRaw: string;
	headerSpan: Span | null;
	leadingComments: string[];
	/** As on Entry: blocks above, separated by blank lines. */
	detachedComments: string[][];
	trailingComment: string | null;
	entries: Entry[];
	/** Occurrence number for `[[array-of-tables]]` headers. */
	index?: number;
}

export interface Document {
	source: string;
	/** In source order; the root table is always first (possibly with no entries). */
	tables: TableNode[];
}

/** Raised by every parser, so the editor can report a position uniformly. */
export class ParseError extends Error {
	offset: number;
	line: number;
	column: number;

	constructor(message: string, offset: number, line: number, column: number) {
		super(line > 0 ? `${message} (line ${line}, column ${column})` : message);
		this.name = 'ParseError';
		this.offset = offset;
		this.line = line;
		this.column = column;
	}
}

/** Builds a {@link ParseError} with the line and column worked out from an offset. */
export function parseErrorAt(source: string, message: string, offset: number): ParseError {
	let line = 1;
	let column = 1;
	for (let k = 0; k < offset && k < source.length; k++) {
		if (source[k] === '\n') {
			line++;
			column = 1;
		} else {
			column++;
		}
	}
	return new ParseError(message, offset, line, column);
}

export function isScalar(node: ValueNode): node is ScalarNode {
	return node.kind !== 'array' && node.kind !== 'inline-table';
}

/** Human-readable type label, used for the badge next to each field. */
export function typeLabel(node: ValueNode): string {
	switch (node.kind) {
		case 'string':
			return 'string';
		case 'integer':
			return 'int';
		case 'float':
			return 'float';
		case 'boolean':
			return 'bool';
		case 'datetime':
			return node.sub === 'date' ? 'date' : node.sub === 'time' ? 'time' : 'datetime';
		case 'literal':
			return node.label;
		case 'array':
			return 'array';
		case 'inline-table':
			return 'table';
	}
}

/**
 * Turns the text after a comment marker into comment content. A single leading
 * space is conventional padding and comes off; anything beyond that is
 * indentation the author chose, and Markdown rendering depends on it surviving.
 */
export function stripCommentMarker(text: string): string {
	return (text.startsWith(' ') ? text.slice(1) : text).replace(/\s+$/, '');
}
