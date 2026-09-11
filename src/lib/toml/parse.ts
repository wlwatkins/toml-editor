import type {
	ArrayNode,
	Entry,
	InlineTableNode,
	StringNode,
	TableNode,
	TomlDocument,
	ValueNode
} from './ast.ts';

export class TomlParseError extends Error {
	offset: number;
	line: number;
	column: number;

	constructor(message: string, offset: number, line: number, column: number) {
		super(`${message} (line ${line}, column ${column})`);
		this.name = 'TomlParseError';
		this.offset = offset;
		this.line = line;
		this.column = column;
	}
}

const BARE_KEY = /[A-Za-z0-9_-]/;

// Sticky patterns, tried in order of specificity at the current offset.
const RE_OFFSET_DT = /\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})/y;
const RE_LOCAL_DT = /\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?/y;
const RE_DATE = /\d{4}-\d{2}-\d{2}/y;
const RE_TIME = /\d{2}:\d{2}(:\d{2}(\.\d+)?)?/y;
const RE_FLOAT =
	/[+-]?(inf|nan)|[+-]?(0|[1-9](_?[0-9])*)(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9](_?[0-9])*)?/y;
const RE_INT =
	/[+-]?(0x[0-9A-Fa-f](_?[0-9A-Fa-f])*|0o[0-7](_?[0-7])*|0b[01](_?[01])*|0|[1-9](_?[0-9])*)/y;

class Parser {
	private src: string;
	private i = 0;
	private nextId = 1;
	private pending: string[] = [];
	private detached: string[][] = [];
	private tables: TableNode[] = [];
	private current: TableNode;
	private arrayTableCounts = new Map<string, number>();

	constructor(src: string) {
		this.src = src;
		this.current = {
			id: this.id(),
			kind: 'root',
			path: [],
			headerRaw: '',
			headerSpan: null,
			leadingComments: [],
			detachedComments: [],
			trailingComment: null,
			entries: []
		};
		this.tables.push(this.current);
	}

	parse(): TomlDocument {
		for (;;) {
			this.skipTrivia();
			if (this.eof()) break;
			if (this.ch() === '[') this.parseTableHeader();
			else this.parseEntry(this.current);
		}
		return { source: this.src, tables: this.tables };
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
		let line = 1;
		let column = 1;
		for (let k = 0; k < at && k < this.src.length; k++) {
			if (this.src[k] === '\n') {
				line++;
				column = 1;
			} else {
				column++;
			}
		}
		throw new TomlParseError(message, at, line, column);
	}

	private tryRe(re: RegExp): string | null {
		re.lastIndex = this.i;
		const m = re.exec(this.src);
		return m ? m[0] : null;
	}

	/**
	 * Consumes whitespace, blank lines and comment lines between statements,
	 * accumulating comments so they can be attached to whatever comes next.
	 * A blank line detaches the comments collected so far.
	 */
	private skipTrivia() {
		for (;;) {
			this.skipInlineWs();
			if (this.ch() === '#') {
				this.i++;
				const start = this.i;
				while (!this.eof() && !this.isNewline()) this.i++;
				this.pending.push(stripCommentMarker(this.src.slice(start, this.i)));
				this.eatNewline();
				continue;
			}
			if (this.eatNewline()) {
				// A blank line detaches the block from whatever follows, but does
				// not discard it: file banners and free-standing notes live here.
				if (this.pending.length) this.detached.push(this.takePending());
				continue;
			}
			return;
		}
	}

	/** Comment blocks parked above the statement now being parsed. */
	private takeDetached(): string[][] {
		return this.detached.splice(0);
	}

	private takePending(): string[] {
		const out = this.pending.slice();
		this.pending.length = 0;
		return out;
	}

	private parseTrailingComment(): string | null {
		if (this.ch() !== '#') return null;
		this.i++;
		const start = this.i;
		while (!this.eof() && !this.isNewline()) this.i++;
		return stripCommentMarker(this.src.slice(start, this.i));
	}

	private expectLineEnd() {
		this.skipInlineWs();
		if (this.eof() || this.isNewline()) return;
		this.fail(`unexpected ${JSON.stringify(this.ch())} after value`);
	}

	// ---- statements -------------------------------------------------------

	private parseTableHeader() {
		const detachedComments = this.takeDetached();
		const leadingComments = this.takePending();
		const start = this.i;
		this.i++; // [
		const isArray = this.ch() === '[';
		if (isArray) this.i++;
		this.skipInlineWs();
		const key = this.parseKey();
		this.skipInlineWs();
		if (this.ch() !== ']') this.fail('expected "]" to close the table header');
		this.i++;
		if (isArray) {
			if (this.ch() !== ']') this.fail('expected "]]" to close the array-of-tables header');
			this.i++;
		}
		const end = this.i;
		this.skipInlineWs();
		const trailingComment = this.parseTrailingComment();

		const table: TableNode = {
			id: this.id(),
			kind: isArray ? 'array-table' : 'table',
			path: key.parts,
			headerRaw: this.src.slice(start, end),
			headerSpan: { start, end },
			leadingComments,
			detachedComments,
			trailingComment,
			entries: []
		};
		if (isArray) {
			const k = JSON.stringify(key.parts);
			const n = this.arrayTableCounts.get(k) ?? 0;
			table.index = n;
			this.arrayTableCounts.set(k, n + 1);
		}
		this.tables.push(table);
		this.current = table;
		this.expectLineEnd();
	}

	private parseEntry(table: TableNode) {
		let detachedComments = this.takeDetached();
		const leadingComments = this.takePending();

		// A banner above the first key of the untitled root table describes the
		// file, not that key, so it is hoisted onto the document instead.
		if (table.kind === 'root' && table.entries.length === 0 && detachedComments.length > 0) {
			table.detachedComments.push(...detachedComments);
			detachedComments = [];
		}
		const start = this.i;
		const key = this.parseKey();
		this.skipInlineWs();
		if (this.ch() !== '=') this.fail('expected "=" after key');
		this.i++;
		this.skipInlineWs();
		const value = this.parseValue();
		const end = this.i;
		this.skipInlineWs();
		const trailingComment = this.parseTrailingComment();

		table.entries.push({
			id: this.id(),
			key: key.parts,
			keyRaw: key.raw,
			value,
			span: { start, end },
			leadingComments,
			detachedComments,
			trailingComment,
			path: [...table.path, ...key.parts]
		});
		this.expectLineEnd();
	}

	private parseKey(): { parts: string[]; raw: string } {
		const start = this.i;
		const parts = [this.parseKeyPart()];
		for (;;) {
			const save = this.i;
			this.skipInlineWs();
			if (this.ch() !== '.') {
				this.i = save;
				break;
			}
			this.i++;
			this.skipInlineWs();
			parts.push(this.parseKeyPart());
		}
		return { parts, raw: this.src.slice(start, this.i) };
	}

	private parseKeyPart(): string {
		const c = this.ch();
		if (c === '"' || c === "'") return this.parseString().value;
		const start = this.i;
		while (!this.eof() && BARE_KEY.test(this.ch())) this.i++;
		if (this.i === start) this.fail('expected a key');
		return this.src.slice(start, this.i);
	}

	// ---- values -----------------------------------------------------------

	private parseValue(): ValueNode {
		const c = this.ch();
		if (c === '"' || c === "'") return this.parseString();
		if (c === '[') return this.parseArray();
		if (c === '{') return this.parseInlineTable();

		const start = this.i;
		if (this.src.startsWith('true', this.i)) {
			this.i += 4;
			return { id: this.id(), kind: 'boolean', value: true, span: { start, end: this.i } };
		}
		if (this.src.startsWith('false', this.i)) {
			this.i += 5;
			return { id: this.id(), kind: 'boolean', value: false, span: { start, end: this.i } };
		}
		return this.parseNumberOrDate();
	}

	private parseNumberOrDate(): ValueNode {
		const start = this.i;
		const span = () => ({ start, end: this.i });

		let raw = this.tryRe(RE_OFFSET_DT);
		if (raw) {
			this.i += raw.length;
			return { id: this.id(), kind: 'datetime', sub: 'offset', raw, span: span() };
		}
		raw = this.tryRe(RE_LOCAL_DT);
		if (raw) {
			this.i += raw.length;
			return { id: this.id(), kind: 'datetime', sub: 'local', raw, span: span() };
		}
		raw = this.tryRe(RE_DATE);
		if (raw) {
			this.i += raw.length;
			return { id: this.id(), kind: 'datetime', sub: 'date', raw, span: span() };
		}
		raw = this.tryRe(RE_TIME);
		if (raw) {
			this.i += raw.length;
			return { id: this.id(), kind: 'datetime', sub: 'time', raw, span: span() };
		}

		// A float only wins over an integer if it actually carries a fraction,
		// an exponent, or is inf/nan -- otherwise `1` would parse as a float.
		raw = this.tryRe(RE_FLOAT);
		if (raw && /[.eE]|inf|nan/.test(raw)) {
			this.i += raw.length;
			return { id: this.id(), kind: 'float', raw, value: floatValue(raw), span: span() };
		}
		raw = this.tryRe(RE_INT);
		if (raw) {
			this.i += raw.length;
			return { id: this.id(), kind: 'integer', raw, value: intValue(raw), span: span() };
		}
		this.fail('expected a value');
	}

	private parseString(): StringNode {
		const start = this.i;
		const q = this.ch();
		const isBasic = q === '"';

		if (this.ch(1) === q && this.ch(2) === q) {
			this.i += 3;
			this.eatNewline(); // a newline directly after the opening delimiter is trimmed
			let out = '';
			for (;;) {
				if (this.eof()) this.fail('unterminated multi-line string', start);
				if (this.ch() === q && this.ch(1) === q && this.ch(2) === q) {
					// Up to two extra quotes may appear immediately before the delimiter.
					let n = 0;
					while (this.ch(n) === q) n++;
					const extra = Math.min(n - 3, 2);
					out += q.repeat(extra);
					this.i += extra + 3;
					break;
				}
				if (isBasic && this.ch() === '\\') {
					out += this.readEscape(true);
					continue;
				}
				out += this.ch();
				this.i++;
			}
			return {
				id: this.id(),
				kind: 'string',
				value: out,
				style: isBasic ? 'multiline-basic' : 'multiline-literal',
				span: { start, end: this.i }
			};
		}

		this.i++;
		let out = '';
		for (;;) {
			if (this.eof() || this.isNewline()) this.fail('unterminated string', start);
			if (this.ch() === q) {
				this.i++;
				break;
			}
			if (isBasic && this.ch() === '\\') {
				out += this.readEscape(false);
				continue;
			}
			out += this.ch();
			this.i++;
		}
		return {
			id: this.id(),
			kind: 'string',
			value: out,
			style: isBasic ? 'basic' : 'literal',
			span: { start, end: this.i }
		};
	}

	private readEscape(multiline: boolean): string {
		this.i++; // backslash
		const c = this.ch();
		switch (c) {
			case 'b':
				this.i++;
				return '\b';
			case 't':
				this.i++;
				return '\t';
			case 'n':
				this.i++;
				return '\n';
			case 'f':
				this.i++;
				return '\f';
			case 'r':
				this.i++;
				return '\r';
			case 'e':
				this.i++;
				return String.fromCharCode(0x1b);
			case '"':
				this.i++;
				return '"';
			case '\\':
				this.i++;
				return '\\';
			case 'u':
			case 'U': {
				const len = c === 'u' ? 4 : 8;
				this.i++;
				const hex = this.src.slice(this.i, this.i + len);
				if (hex.length !== len || !/^[0-9A-Fa-f]+$/.test(hex)) {
					this.fail('invalid unicode escape');
				}
				this.i += len;
				return String.fromCodePoint(parseInt(hex, 16));
			}
		}
		if (multiline && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
			// Line-ending backslash: swallow the newline and all following whitespace.
			while (!this.eof() && ' \t\n\r'.includes(this.ch())) this.i++;
			return '';
		}
		this.fail('invalid escape sequence');
	}

	private parseArray(): ArrayNode {
		const start = this.i;
		this.i++; // [
		const items: ValueNode[] = [];
		let multiline = false;

		const trivia = () => {
			const before = this.i;
			for (;;) {
				this.skipInlineWs();
				if (this.ch() === '#') {
					while (!this.eof() && !this.isNewline()) this.i++;
					continue;
				}
				if (this.eatNewline()) continue;
				break;
			}
			if (this.src.slice(before, this.i).includes('\n')) multiline = true;
		};

		for (;;) {
			trivia();
			if (this.eof()) this.fail('unterminated array', start);
			if (this.ch() === ']') {
				this.i++;
				break;
			}
			items.push(this.parseValue());
			trivia();
			if (this.ch() === ',') {
				this.i++;
				continue;
			}
			if (this.ch() === ']') {
				this.i++;
				break;
			}
			this.fail('expected "," or "]" in array');
		}
		return { id: this.id(), kind: 'array', items, multiline, span: { start, end: this.i } };
	}

	private parseInlineTable(): InlineTableNode {
		const start = this.i;
		this.i++; // {
		const entries: Entry[] = [];
		this.skipInlineWs();
		if (this.ch() === '}') {
			this.i++;
			return { id: this.id(), kind: 'inline-table', entries, span: { start, end: this.i } };
		}
		for (;;) {
			this.skipInlineWs();
			const eStart = this.i;
			const key = this.parseKey();
			this.skipInlineWs();
			if (this.ch() !== '=') this.fail('expected "=" in inline table');
			this.i++;
			this.skipInlineWs();
			const value = this.parseValue();
			entries.push({
				id: this.id(),
				key: key.parts,
				keyRaw: key.raw,
				value,
				span: { start: eStart, end: this.i },
				leadingComments: [],
				detachedComments: [],
				trailingComment: null,
				path: key.parts
			});
			this.skipInlineWs();
			if (this.ch() === ',') {
				this.i++;
				continue;
			}
			if (this.ch() === '}') {
				this.i++;
				break;
			}
			this.fail('expected "," or "}" in inline table');
		}
		return { id: this.id(), kind: 'inline-table', entries, span: { start, end: this.i } };
	}
}

/**
 * Turns the text after a `#` into comment content. A single leading space is
 * conventional padding and comes off; anything beyond that is indentation the
 * author chose, and Markdown rendering depends on it surviving.
 */
function stripCommentMarker(text: string): string {
	return (text.startsWith(' ') ? text.slice(1) : text).replace(/\s+$/, '');
}

function floatValue(raw: string): number {
	const clean = raw.replace(/_/g, '');
	if (/inf$/.test(clean)) return clean.startsWith('-') ? -Infinity : Infinity;
	if (/nan$/.test(clean)) return NaN;
	return Number(clean);
}

function intValue(raw: string): number {
	return Number(raw.replace(/_/g, ''));
}

export function parseToml(source: string): TomlDocument {
	return new Parser(source).parse();
}
