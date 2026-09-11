/**
 * A span of characters in the original source text.
 * `null` spans belong to synthetic nodes (e.g. an array item the user just added)
 * which have no representation in the file yet.
 */
export interface Span {
	start: number;
	end: number;
}

export type StringStyle = 'basic' | 'literal' | 'multiline-basic' | 'multiline-literal';
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
export interface ArrayNode extends NodeBase {
	kind: 'array';
	items: ValueNode[];
	/** True when the array spanned multiple lines in the source. */
	multiline: boolean;
}
export interface InlineTableNode extends NodeBase {
	kind: 'inline-table';
	entries: Entry[];
}

export type ValueNode =
	| StringNode
	| IntegerNode
	| FloatNode
	| BooleanNode
	| DateTimeNode
	| ArrayNode
	| InlineTableNode;

export type ScalarNode = StringNode | IntegerNode | FloatNode | BooleanNode | DateTimeNode;

export interface Entry {
	id: number;
	/** Dotted key split into parts, with quotes resolved. */
	key: string[];
	/** The key exactly as written, including any quoting. */
	keyRaw: string;
	value: ValueNode;
	/** Covers `key = value`, excluding any trailing comment. */
	span: Span;
	/** `#` comment lines directly above, with the `#` and surrounding space stripped. */
	leadingComments: string[];
	/**
	 * Further comment blocks above that one, each separated from the next by a
	 * blank line. They still belong here -- they are just not touching the key.
	 */
	detachedComments: string[][];
	/** `#` comment on the same line, if any. */
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

export interface TomlDocument {
	source: string;
	/** In source order; the root table is always first (possibly with no entries). */
	tables: TableNode[];
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
		case 'array':
			return 'array';
		case 'inline-table':
			return 'table';
	}
}
