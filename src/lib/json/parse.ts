import type {
	ArrayNode,
	Document,
	Entry,
	InlineTableNode,
	StringNode,
	TableNode,
	ValueNode
} from '../format/ast.ts';
import { parseErrorAt, stripCommentMarker } from '../format/ast.ts';

/**
 * A JSON parser that records where every value sits in the source.
 *
 * The span on each node is what lets a save replace exactly the text of the
 * values that changed, leaving indentation, key order and -- in JSONC --
 * comments untouched.
 */

const RE_NUMBER = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

interface Options {
	/** JSONC: `//` and slash-star comments, and a trailing comma before a closer. */
	comments: boolean;
}

class Parser {
	private src: string;
	private i = 0;
	private nextId = 1;
	private pending: string[] = [];
	private detached: string[][] = [];
	private options: Options;

	constructor(src: string, options: Options) {
		this.src = src;
		this.options = options;
	}

	parse(): Document {
		this.skipTrivia();
		// Comments above the opening brace describe the file, not its first key.
		const banner = this.takeDetached();
		const leading = this.takePending();
		if (leading.length) banner.push(leading);

		if (this.eof()) this.fail('the file is empty');
		const root = this.parseValue();
		this.skipTrivia();
		if (!this.eof()) this.fail(`unexpected ${JSON.stringify(this.ch())} after the document`);

		return { source: this.src, tables: this.buildTables(root, banner) };
	}

	// ---- primitives -------------------------------------------------------

	private id() {
		return this.nextId++;
	}
	private eof() {
		return this.i >= this.src.length;
	}
	private ch(offset = 0) {
		return this.src[this.i + offset];
	}
	private isNewline() {
		const c = this.ch();
		return c === '\n' || c === '\r';
	}
	private eatNewline(): boolean {
		if (this.ch() === '\r' && this.ch(1) === '\n') {
			this.i += 2;
			return true;
		}
		if (this.ch() === '\n') {
			this.i += 1;
			return true;
		}
		return false;
	}
	private skipInlineWs() {
		while (this.ch() === ' ' || this.ch() === '\t') this.i++;
	}

	private fail(message: string, at = this.i): never {
		throw parseErrorAt(this.src, message, at);
	}

	/**
	 * Consumes whitespace, blank lines and comments, accumulating comment text
	 * so it can be attached to whatever comes next. A blank line detaches the
	 * block collected so far without discarding it.
	 */
	private skipTrivia() {
		for (;;) {
			this.skipInlineWs();
			if (this.options.comments && this.ch() === '/' && this.ch(1) === '/') {
				this.i += 2;
				const start = this.i;
				while (!this.eof() && !this.isNewline()) this.i++;
				this.pending.push(stripCommentMarker(this.src.slice(start, this.i)));
				this.eatNewline();
				continue;
			}
			if (this.options.comments && this.ch() === '/' && this.ch(1) === '*') {
				this.readBlockComment().forEach((line) => this.pending.push(line));
				// A block comment on its own line should not look like a blank line.
				this.skipInlineWs();
				this.eatNewline();
				continue;
			}
			if (this.eatNewline()) {
				if (this.pending.length) this.detached.push(this.takePending());
				continue;
			}
			return;
		}
	}

	/** Reads a slash-star comment, returning one entry per line of its body. */
	private readBlockComment(): string[] {
		const start = this.i;
		this.i += 2;
		const from = this.i;
		while (!this.eof() && !(this.ch() === '*' && this.ch(1) === '/')) this.i++;
		if (this.eof()) this.fail('unterminated comment', start);
		const body = this.src.slice(from, this.i);
		this.i += 2;
		return body
			.split(/\r?\n/)
			.map((line) => stripCommentMarker(line.replace(/^\s*\*(?!\/)/, '')))
			.filter((line, index, all) => !(line === '' && (index === 0 || index === all.length - 1)));
	}

	private takeDetached(): string[][] {
		return this.detached.splice(0);
	}

	private takePending(): string[] {
		const out = this.pending.slice();
		this.pending.length = 0;
		return out;
	}

	/** A comment sitting after a value on the same line. */
	private parseTrailingComment(): string | null {
		if (!this.options.comments) return null;
		const save = this.i;
		this.skipInlineWs();
		if (this.ch() === '/' && this.ch(1) === '/') {
			this.i += 2;
			const start = this.i;
			while (!this.eof() && !this.isNewline()) this.i++;
			return stripCommentMarker(this.src.slice(start, this.i));
		}
		if (this.ch() === '/' && this.ch(1) === '*') {
			const lines = this.readBlockComment();
			return lines.join(' ').trim() || null;
		}
		this.i = save;
		return null;
	}

	// ---- values -----------------------------------------------------------

	private parseValue(): ValueNode {
		const c = this.ch();
		if (c === '{') return this.parseObject();
		if (c === '[') return this.parseArray();
		if (c === '"') return this.parseString();

		const start = this.i;
		for (const word of ['true', 'false', 'null'] as const) {
			if (this.src.startsWith(word, this.i)) {
				this.i += word.length;
				const span = { start, end: this.i };
				if (word === 'null') {
					return { id: this.id(), kind: 'literal', raw: 'null', label: 'null', editable: true, span };
				}
				return { id: this.id(), kind: 'boolean', value: word === 'true', span };
			}
		}

		RE_NUMBER.lastIndex = this.i;
		const match = RE_NUMBER.exec(this.src);
		if (match && match.index === this.i && match[0].length > 0) {
			const raw = match[0];
			this.i += raw.length;
			const span = { start, end: this.i };
			// JSON has one number type; the split is for the form control, and
			// anything with a fraction or an exponent gets the float input.
			if (/[.eE]/.test(raw)) {
				return { id: this.id(), kind: 'float', raw, value: Number(raw), span };
			}
			return { id: this.id(), kind: 'integer', raw, value: Number(raw), span };
		}
		this.fail('expected a value');
	}

	private parseString(): StringNode {
		const start = this.i;
		this.i++; // opening quote
		let out = '';
		for (;;) {
			if (this.eof() || this.isNewline()) this.fail('unterminated string', start);
			const c = this.ch();
			if (c === '"') {
				this.i++;
				break;
			}
			if (c === '\\') {
				out += this.readEscape();
				continue;
			}
			out += c;
			this.i++;
		}
		return { id: this.id(), kind: 'string', value: out, style: 'json', span: { start, end: this.i } };
	}

	private readEscape(): string {
		this.i++; // backslash
		const c = this.ch();
		switch (c) {
			case '"':
			case '\\':
			case '/':
				this.i++;
				return c;
			case 'b':
				this.i++;
				return '\b';
			case 'f':
				this.i++;
				return '\f';
			case 'n':
				this.i++;
				return '\n';
			case 'r':
				this.i++;
				return '\r';
			case 't':
				this.i++;
				return '\t';
			case 'u': {
				this.i++;
				const hex = this.src.slice(this.i, this.i + 4);
				if (hex.length !== 4 || !/^[0-9A-Fa-f]{4}$/.test(hex)) this.fail('invalid unicode escape');
				this.i += 4;
				return String.fromCharCode(parseInt(hex, 16));
			}
		}
		this.fail('invalid escape sequence');
	}

	/** Eats the separator after an item, saying whether one was there. */
	private eatComma(): boolean {
		const save = this.i;
		this.skipInlineWs();
		if (this.ch() === ',') {
			this.i++;
			return true;
		}
		this.i = save;
		return false;
	}

	private parseArray(): ArrayNode {
		const start = this.i;
		this.i++; // [
		const items: ValueNode[] = [];
		for (;;) {
			this.skipTrivia();
			if (this.eof()) this.fail('unterminated array', start);
			if (this.ch() === ']') {
				this.i++;
				break;
			}
			items.push(this.parseValue());
			const comma = this.eatComma();
			this.skipTrivia();
			if (this.eof()) this.fail('unterminated array', start);
			if (this.ch() === ']') {
				// Strict JSON has no trailing comma; JSONC allows one.
				if (comma && !this.options.comments) this.fail('trailing comma');
				this.i++;
				break;
			}
			if (!comma) this.fail('expected "," or "]" in array');
		}
		// Comments collected inside the brackets belong to no key; drop them so
		// they cannot leak onto the next entry.
		this.takePending();
		this.takeDetached();
		const span = { start, end: this.i };
		return {
			id: this.id(),
			kind: 'array',
			items,
			multiline: this.src.slice(start, this.i).includes('\n'),
			span
		};
	}

	private parseObject(): InlineTableNode {
		const start = this.i;
		this.i++; // {
		const entries: Entry[] = [];
		for (;;) {
			this.skipTrivia();
			if (this.eof()) this.fail('unterminated object', start);
			if (this.ch() === '}') {
				this.i++;
				break;
			}

			const detachedComments = this.takeDetached();
			const leadingComments = this.takePending();
			const entryStart = this.i;
			if (this.ch() !== '"') this.fail('expected a quoted key');
			const key = this.parseString();
			this.skipTrivia();
			if (this.ch() !== ':') this.fail('expected ":" after the key');
			this.i++;
			this.skipTrivia();
			const value = this.parseValue();
			const entryEnd = this.i;
			// Comments written inside the entry, between the key and its value,
			// belong to nobody; dropping them stops them leaking onto the next key.
			this.takePending();
			this.takeDetached();

			// The note on this line may sit either side of the separator:
			// `"a": 1, // why` is as common as `"a": 1 // why`.
			let trailingComment = this.parseTrailingComment();
			const comma = this.eatComma();
			if (trailingComment === null && comma) trailingComment = this.parseTrailingComment();

			entries.push({
				id: this.id(),
				key: [key.value],
				keyRaw: key.value,
				value,
				span: { start: entryStart, end: entryEnd },
				leadingComments,
				detachedComments,
				trailingComment,
				path: [key.value]
			});

			this.skipTrivia();
			if (this.eof()) this.fail('unterminated object', start);
			if (this.ch() === '}') {
				if (comma && !this.options.comments) this.fail('trailing comma');
				this.i++;
				break;
			}
			if (!comma) this.fail('expected "," or "}" in object');
		}
		// Comments between the last entry and the closing brace belong to nothing.
		this.takePending();
		this.takeDetached();
		const span = { start, end: this.i };
		return {
			id: this.id(),
			kind: 'inline-table',
			entries,
			// An object written on one line reads as a single value, so it stays
			// a field rather than becoming a section of its own.
			flow: !this.src.slice(start, this.i).includes('\n'),
			span
		};
	}

	// ---- document shape ---------------------------------------------------

	/**
	 * Turns the value tree into the table list the form renders.
	 *
	 * An object reached from a table becomes a table of its own, exactly as a
	 * TOML `[section]` would; an object reached from inside an array stays an
	 * inline table, because that is an array of records, not a section.
	 */
	private buildTables(root: ValueNode, banner: string[][]): TableNode[] {
		const tables: TableNode[] = [];
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
		tables.push(rootTable);

		if (root.kind !== 'inline-table') {
			// A document whose root is an array (or a bare scalar) has no keys to
			// group by, so it is offered as a single unnamed field.
			rootTable.entries.push({
				id: this.id(),
				key: [],
				keyRaw: '(document)',
				value: root,
				span: root.span ?? { start: 0, end: 0 },
				leadingComments: [],
				detachedComments: [],
				trailingComment: null,
				path: []
			});
			return tables;
		}

		const walk = (object: InlineTableNode, table: TableNode, path: string[]) => {
			for (const entry of object.entries) {
				const childPath = [...path, entry.keyRaw];
				if (entry.value.kind === 'inline-table' && entry.value.flow !== true) {
					tables.push({
						id: this.id(),
						kind: 'table',
						path: childPath,
						headerRaw: childPath.join('.'),
						headerSpan: entry.span,
						leadingComments: entry.leadingComments,
						detachedComments: entry.detachedComments,
						trailingComment: entry.trailingComment,
						entries: []
					});
					const child = tables[tables.length - 1];
					walk(entry.value, child, childPath);
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
		};
		walk(root, rootTable, []);

		// An object that holds nothing but other objects would render as an empty
		// card; its children carry the full path, so it adds nothing.
		return tables.filter(
			(table) =>
				table.kind === 'root' ||
				table.entries.length > 0 ||
				table.leadingComments.length > 0 ||
				table.detachedComments.length > 0
		);
	}
}

export function parseJson(source: string): Document {
	return new Parser(source, { comments: false }).parse();
}

export function parseJsonc(source: string): Document {
	return new Parser(source, { comments: true }).parse();
}
