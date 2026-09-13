/**
 * Converting a whole document from one format to another.
 *
 * This is the one operation that deliberately sets aside the core invariant.
 * Everywhere else the file is patched, so untouched text survives byte for
 * byte; here the output is *generated* from the parsed document, because the
 * target format has different syntax for everything. Layout is therefore
 * rewritten, and anything the target cannot express is lost.
 *
 * So the job is only half "emit the other syntax". The other half is saying
 * honestly what it costs: {@link convert} returns the output together with a
 * list of {@link Warning}s naming every loss it made, and the UI shows them
 * before anything is written to disk.
 *
 * Plain TS, no Svelte import -- the node test runner loads this directly.
 */
import type {
	DateTimeKind,
	Document,
	Entry,
	StringStyle,
	TableNode,
	ValueNode
} from './ast.ts';
import type { Format } from './drafts.ts';
import { serializeString as tomlString } from '../toml/serialize.ts';
import { isPlainSafe, serializeString as yamlString } from '../yaml/serialize.ts';

// ---------------------------------------------------------------------------
// The intermediate tree
// ---------------------------------------------------------------------------

/**
 * A value stripped of the syntax it was written in, but not of its type.
 *
 * The document model is TOML-shaped and carries spans, quoting styles and raw
 * text that only make sense against the original source. Conversion flattens
 * that into the smallest description a foreign emitter needs: what the value
 * *is*, plus the couple of hints (a string's style, a number's raw text) that
 * let the output keep the shape of the input where the target allows it.
 */
export type ConvValue =
	| { kind: 'string'; value: string; style: StringStyle }
	| { kind: 'number'; raw: string; value: number; float: boolean }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'datetime'; sub: DateTimeKind; raw: string }
	| { kind: 'null' }
	/** An alias or a tagged node: visible in the source, not re-expressible. */
	| { kind: 'opaque'; raw: string; label: string }
	| { kind: 'list'; items: ConvValue[]; multiline: boolean }
	| {
			kind: 'map';
			map: ConvMap;
			/** Written on one line in the source (`{ a = 1 }`), not as a section. */
			inline: boolean;
			/** Comments above this item, when it is an item of a list. */
			blocks: string[][];
	  };

export interface ConvField {
	key: string;
	value: ConvValue;
	/**
	 * Comment blocks above the key, oldest first, each block a run of adjacent
	 * lines. Detached blocks and the touching block are kept apart only by
	 * being separate entries -- emitters put a blank line between them.
	 */
	blocks: string[][];
	trailing: string | null;
	/** Full dotted path, for naming a value in a warning. */
	path: string[];
}

export interface ConvMap {
	fields: ConvField[];
}

export interface Warning {
	/** `loss` is something the target cannot hold; `note` is a change of shape. */
	level: 'loss' | 'note';
	text: string;
}

export interface Conversion {
	text: string;
	warnings: Warning[];
	/** Set when the document cannot be expressed in the target format at all. */
	error: string | null;
}

const INDENT = '  ';

// ---------------------------------------------------------------------------
// Document -> intermediate tree
// ---------------------------------------------------------------------------

function blocksOf(source: {
	leadingComments: string[];
	detachedComments: string[][];
}): string[][] {
	const blocks = source.detachedComments.filter((block) => block.length > 0);
	if (source.leadingComments.length > 0) blocks.push(source.leadingComments);
	return blocks;
}

function valueOf(node: ValueNode): ConvValue {
	switch (node.kind) {
		case 'string':
			return { kind: 'string', value: node.value, style: node.style };
		case 'integer':
			return { kind: 'number', raw: node.raw, value: node.value, float: false };
		case 'float':
			return { kind: 'number', raw: node.raw, value: node.value, float: true };
		case 'boolean':
			return { kind: 'boolean', value: node.value };
		case 'datetime':
			return { kind: 'datetime', sub: node.sub, raw: node.raw };
		case 'literal':
			return node.label === 'null'
				? { kind: 'null' }
				: { kind: 'opaque', raw: node.raw, label: node.label };
		case 'array':
			return { kind: 'list', items: node.items.map(valueOf), multiline: node.multiline };
		case 'inline-table':
			return {
				kind: 'map',
				map: { fields: node.entries.map(fieldOf) },
				// TOML inline tables carry no `flow` and are inline by definition;
				// JSON and YAML set it from whether the source spanned a newline.
				inline: node.flow !== false,
				blocks: []
			};
	}
}

function fieldOf(entry: Entry): ConvField {
	return {
		key: entry.key[entry.key.length - 1] ?? entry.keyRaw,
		value: valueOf(entry.value),
		blocks: blocksOf(entry),
		trailing: entry.trailingComment,
		path: entry.path
	};
}

function find(map: ConvMap, key: string): ConvField | undefined {
	return map.fields.find((field) => field.key === key);
}

/** The map at `key`, creating it (or replacing a clashing value) if need be. */
function mapAt(map: ConvMap, key: string, path: string[]): ConvMap {
	const existing = find(map, key);
	if (existing && existing.value.kind === 'map') return existing.value.map;
	// A list is how an array-of-tables got here; its sections continue in the
	// item most recently opened.
	if (existing && existing.value.kind === 'list') {
		const last = existing.value.items[existing.value.items.length - 1];
		if (last && last.kind === 'map') return last.map;
	}
	const fresh: ConvMap = { fields: [] };
	const value: ConvValue = { kind: 'map', map: fresh, inline: false, blocks: [] };
	if (existing) existing.value = value;
	else map.fields.push({ key, value, blocks: [], trailing: null, path: [...path, key] });
	return fresh;
}

/**
 * Rebuilds the nesting the flat table list describes.
 *
 * `tables` is in source order with each table naming its own full path, so a
 * single pass that walks each path from the root reproduces the tree, and
 * `[[array-of-tables]]` headers accumulate into a list as they are met.
 */
export function buildTree(doc: Document): {
	root: ConvMap;
	banner: string[][];
	/** A YAML document whose content is not a mapping has no fields at all. */
	bare: ConvValue | null;
} {
	const root: ConvMap = { fields: [] };
	let banner: string[][] = [];
	let bare: ConvValue | null = null;

	for (const table of doc.tables) {
		const target = openTable(root, table);
		if (table.kind === 'root') banner = blocksOf(table);

		for (const entry of table.entries) {
			// A YAML file whose content is a list or a scalar is modelled as one
			// nameless entry on the root table.
			if (entry.key.length === 0 && table.kind === 'root') {
				bare = valueOf(entry.value);
				continue;
			}
			// A dotted key (`a.b = 1`) nests inside the table it sits in.
			const parts = entry.key.length > 0 ? entry.key : [entry.keyRaw];
			let owner = target;
			for (let k = 0; k < parts.length - 1; k++) {
				owner = mapAt(owner, parts[k], table.path);
			}
			owner.fields.push({ ...fieldOf(entry), key: parts[parts.length - 1] });
		}
	}

	return { root, banner, bare };
}

/** Finds or creates the map a table's entries belong in. */
function openTable(root: ConvMap, table: TableNode): ConvMap {
	if (table.kind === 'root') return root;

	let parent = root;
	for (let k = 0; k < table.path.length - 1; k++) {
		parent = mapAt(parent, table.path[k], table.path.slice(0, k));
	}
	const key = table.path[table.path.length - 1];
	const blocks = blocksOf(table);

	if (table.kind === 'array-table') {
		let field = find(parent, key);
		if (!field) {
			field = {
				key,
				value: { kind: 'list', items: [], multiline: true },
				blocks,
				trailing: null,
				path: table.path
			};
			parent.fields.push(field);
		} else if (field.value.kind !== 'list') {
			field.value = { kind: 'list', items: [], multiline: true };
		}
		const list = field.value as Extract<ConvValue, { kind: 'list' }>;
		// The comments above the first `[[header]]` introduce the list; the ones
		// above a later header belong to that item alone.
		const item: ConvValue = {
			kind: 'map',
			map: { fields: [] },
			inline: false,
			blocks: list.items.length === 0 ? [] : blocks
		};
		list.items.push(item);
		return item.map;
	}

	// Comments on a `[section]` header describe the section, so they travel
	// with the key it becomes.
	const map = mapAt(parent, key, table.path.slice(0, -1));
	const field = find(parent, key);
	if (field) {
		if (blocks.length > 0) field.blocks = blocks;
		if (field.trailing === null) field.trailing = table.trailingComment;
	}
	return map;
}

// ---------------------------------------------------------------------------
// Loss accounting
// ---------------------------------------------------------------------------

/**
 * Collects what the emitter had to give up, so the warning list can name it
 * once with a count rather than once per value.
 */
class Loss {
	comments = 0;
	nullKeys: string[] = [];
	opaqueCount = 0;
	/** Only the TOML emitter knows a path at the point it gives up on one. */
	opaqueKeys: string[] = [];
	datetimes = 0;
	numbers = 0;
	nonFinite = 0;
	reordered = false;

	/**
	 * Values already accounted for. An emitter may render the same value twice
	 * -- once speculatively, to see whether it fits on one line, and once for
	 * real -- and a count that grew each time would overstate the damage.
	 */
	private seen = new Set<ConvValue>();

	/** True the first time this exact value is reported, false afterwards. */
	first(value: ConvValue): boolean {
		if (this.seen.has(value)) return false;
		this.seen.add(value);
		return true;
	}

	countComments(map: ConvMap) {
		for (const field of map.fields) {
			this.comments += field.blocks.reduce((n, block) => n + block.length, 0);
			if (field.trailing !== null) this.comments++;
			this.countValue(field.value);
		}
	}

	private countValue(value: ConvValue) {
		if (value.kind === 'map') {
			this.comments += value.blocks.reduce((n, block) => n + block.length, 0);
			this.countComments(value.map);
		} else if (value.kind === 'list') {
			for (const item of value.items) this.countValue(item);
		}
	}
}

function pathText(path: string[]): string {
	return path.length > 0 ? path.join('.') : '(root)';
}

/** `a, b and 2 more` -- enough to find them without filling the dialog. */
function nameSome(paths: string[], limit = 4): string {
	const shown = paths.slice(0, limit).join(', ');
	const rest = paths.length - limit;
	return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

function warningsFor(loss: Loss, target: Format): Warning[] {
	const out: Warning[] = [];

	out.push({
		level: 'note',
		text:
			'The file is written out fresh, so blank lines, indentation, alignment and ' +
			'quoting style are not carried over. Only the keys, values and comments are.'
	});

	if (loss.comments > 0 && target.commentMarker === null) {
		out.push({
			level: 'loss',
			text: `${plural(loss.comments, 'comment line')} will be dropped: ${target.label} has no comment syntax.`
		});
	} else if (loss.comments > 0) {
		out.push({
			level: 'note',
			text: `${plural(loss.comments, 'comment line')} will be kept, rewritten with "${target.commentMarker}".`
		});
	}

	if (loss.nullKeys.length > 0) {
		out.push({
			level: 'loss',
			text:
				`${plural(loss.nullKeys.length, 'null value')} will be omitted -- TOML has no null. ` +
				`Keys: ${nameSome(loss.nullKeys)}.`
		});
	}

	if (loss.opaqueCount > 0) {
		out.push({
			level: 'loss',
			text:
				loss.opaqueKeys.length > 0
					? `${plural(loss.opaqueCount, 'value')} the editor cannot re-express (a YAML alias ` +
						`or a tagged node) will be omitted. Keys: ${nameSome(loss.opaqueKeys)}.`
					: `${plural(loss.opaqueCount, 'value')} the editor cannot re-express (a YAML alias ` +
						`or a tagged node) will be written out as its literal text, which may not mean ` +
						`the same thing where it lands.`
		});
	}

	if (loss.datetimes > 0) {
		const count = plural(loss.datetimes, 'date or time value');
		const become = loss.datetimes === 1 ? 'becomes' : 'become';
		out.push({
			level: target.id === 'yaml' ? 'note' : 'loss',
			text:
				target.id === 'yaml'
					? `${count} ${become} an unquoted scalar; a YAML 1.2 reader hands it back as text.`
					: `${count} ${become} a quoted string -- JSON has no date type.`
		});
	}

	if (loss.nonFinite > 0) {
		out.push({
			level: 'loss',
			text:
				`${plural(loss.nonFinite, 'infinite or NaN number')} ` +
				`${loss.nonFinite === 1 ? 'becomes' : 'become'} null -- JSON cannot write one.`
		});
	}

	if (loss.numbers > 0) {
		out.push({
			level: 'note',
			text: `${plural(loss.numbers, 'number')} will be rewritten in plain decimal (a form like 1_000 or 0xff does not carry over).`
		});
	}

	if (loss.reordered) {
		out.push({
			level: 'note',
			text: 'Keys move above their sub-sections, as TOML requires, so some ordering changes.'
		});
	}

	return out;
}

// ---------------------------------------------------------------------------
// TOML output
// ---------------------------------------------------------------------------

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;
const TOML_INT = /^[+-]?(0|[1-9](_?[0-9])*)$/;
const TOML_RADIX =
	/^(0x[0-9A-Fa-f](_?[0-9A-Fa-f])*|0o[0-7](_?[0-7])*|0b[01](_?[01])*)$/;
const TOML_FLOAT =
	/^([+-]?(inf|nan)|[+-]?(0|[1-9](_?[0-9])*)((\.[0-9](_?[0-9])*)([eE][+-]?[0-9](_?[0-9])*)?|([eE][+-]?[0-9](_?[0-9])*)))$/;

function tomlKey(key: string): string {
	return TOML_BARE_KEY.test(key) && key !== '' ? key : tomlString(key, 'basic');
}

/** TOML's own string styles pass through; a foreign one picks the nearest. */
function tomlStyle(style: StringStyle): StringStyle {
	switch (style) {
		case 'basic':
		case 'literal':
		case 'multiline-basic':
		case 'multiline-literal':
			return style;
		case 'block-literal':
		case 'block-folded':
			return 'multiline-basic';
		default:
			return 'basic';
	}
}

function decimal(value: number, float: boolean): string {
	if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf';
	const text = String(value);
	if (!float) return text;
	return /[.eE]/.test(text) ? text : `${text}.0`;
}

function tomlNumber(value: Extract<ConvValue, { kind: 'number' }>, loss: Loss): string {
	const raw = value.raw.trim();
	const ok = value.float ? TOML_FLOAT.test(raw) : TOML_INT.test(raw) || TOML_RADIX.test(raw);
	if (ok) return raw;
	if (loss.first(value)) loss.numbers++;
	return decimal(value.value, value.float);
}

function isSection(value: ConvValue): boolean {
	return value.kind === 'map' && !value.inline;
}

/** A list that TOML would rather write as a run of `[[header]]` blocks. */
function isSectionList(value: ConvValue): boolean {
	return (
		value.kind === 'list' &&
		value.items.length > 0 &&
		value.items.every((item) => item.kind === 'map' && !item.inline)
	);
}

/** Renders an inline value, or null when TOML has no way to write it. */
function tomlValue(value: ConvValue, indent: string, loss: Loss, path: string[]): string | null {
	switch (value.kind) {
		case 'string':
			return tomlString(value.value, tomlStyle(value.style));
		case 'number':
			return tomlNumber(value, loss);
		case 'boolean':
			return value.value ? 'true' : 'false';
		case 'datetime':
			return value.raw;
		case 'null':
			if (loss.first(value)) loss.nullKeys.push(pathText(path));
			return null;
		case 'opaque':
			if (loss.first(value)) {
				loss.opaqueCount++;
				loss.opaqueKeys.push(pathText(path));
			}
			return null;
		case 'list': {
			if (value.items.length === 0) return '[]';
			const inner = indent + INDENT;
			const parts: string[] = [];
			for (const [k, item] of value.items.entries()) {
				const text = tomlValue(item, inner, loss, [...path, String(k)]);
				// An unrepresentable item cannot just vanish: dropping it would
				// silently shorten the array and shift every index after it.
				parts.push(text ?? '""');
			}
			const oneLine = `[${parts.join(', ')}]`;
			if (!value.multiline && !oneLine.includes('\n') && oneLine.length + indent.length <= 96) {
				return oneLine;
			}
			return `[\n${parts.map((part) => inner + part).join(',\n')},\n${indent}]`;
		}
		case 'map': {
			const parts: string[] = [];
			for (const field of value.map.fields) {
				const text = tomlValue(field.value, indent, loss, [...path, field.key]);
				if (text === null) continue;
				parts.push(`${tomlKey(field.key)} = ${text}`);
			}
			return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
		}
	}
}

function tomlComments(blocks: string[][], out: string[]) {
	for (const [k, block] of blocks.entries()) {
		if (k > 0) out.push('');
		for (const line of block) out.push(line === '' ? '#' : `# ${line}`);
	}
}

function emitToml(root: ConvMap, banner: string[][], loss: Loss): string {
	const out: string[] = [];
	if (banner.length > 0) {
		tomlComments(banner, out);
		out.push('');
	}

	const writeTable = (map: ConvMap, path: string[]) => {
		const plain = map.fields.filter(
			(field) => !isSection(field.value) && !isSectionList(field.value)
		);
		const sections = map.fields.filter(
			(field) => isSection(field.value) || isSectionList(field.value)
		);
		// Say so only when the split actually moves something: a table whose
		// sections already come last reads out in its original order.
		if (plain.length > 0 && sections.length > 0) {
			const firstSection = map.fields.findIndex(
				(field) => isSection(field.value) || isSectionList(field.value)
			);
			if (map.fields.slice(firstSection).some((field) => plain.includes(field))) {
				loss.reordered = true;
			}
		}

		for (const field of plain) {
			const text = tomlValue(field.value, '', loss, field.path);
			if (text === null) continue;
			tomlComments(field.blocks, out);
			const trailing = field.trailing ? `  # ${field.trailing}` : '';
			out.push(`${tomlKey(field.key)} = ${text}${trailing}`);
		}

		for (const field of sections) {
			const childPath = [...path, field.key];
			const header = childPath.map(tomlKey).join('.');
			if (field.value.kind === 'map') {
				if (out.length > 0) out.push('');
				tomlComments(field.blocks, out);
				out.push(`[${header}]${field.trailing ? `  # ${field.trailing}` : ''}`);
				writeTable(field.value.map, childPath);
				continue;
			}
			const list = field.value as Extract<ConvValue, { kind: 'list' }>;
			for (const [k, item] of list.items.entries()) {
				if (out.length > 0) out.push('');
				const map = item as Extract<ConvValue, { kind: 'map' }>;
				tomlComments(k === 0 ? field.blocks : map.blocks, out);
				out.push(`[[${header}]]`);
				writeTable(map.map, childPath);
			}
		}
	};

	writeTable(root, []);
	return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`;
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

function jsonNumber(value: Extract<ConvValue, { kind: 'number' }>, loss: Loss): string {
	if (!Number.isFinite(value.value)) {
		if (loss.first(value)) loss.nonFinite++;
		return 'null';
	}
	const raw = value.raw.trim();
	if (JSON_NUMBER.test(raw)) return raw;
	if (loss.first(value)) loss.numbers++;
	return String(value.value);
}

/** True when this field would lose something by being put on one line. */
function hasComments(field: ConvField): boolean {
	return field.blocks.length > 0 || field.trailing !== null;
}

function emitJson(
	root: ConvMap,
	bare: ConvValue | null,
	banner: string[][],
	comments: boolean,
	loss: Loss
): string {
	const lines: string[] = [];

	const comment = (blocks: string[][], indent: string) => {
		if (!comments) return;
		for (const [k, block] of blocks.entries()) {
			if (k > 0) lines.push('');
			for (const line of block) lines.push(line === '' ? `${indent}//` : `${indent}// ${line}`);
		}
	};

	/** Everything that fits on one line; null when it must be written as a block. */
	const flat = (value: ConvValue): string | null => {
		switch (value.kind) {
			case 'string':
				return JSON.stringify(value.value);
			case 'number':
				return jsonNumber(value, loss);
			case 'boolean':
				return value.value ? 'true' : 'false';
			case 'null':
				return 'null';
			case 'datetime':
				if (loss.first(value)) loss.datetimes++;
				return JSON.stringify(value.raw);
			case 'opaque':
				if (loss.first(value)) loss.opaqueCount++;
				return JSON.stringify(value.raw);
			case 'list': {
				if (value.items.length === 0) return '[]';
				if (value.multiline) return null;
				const parts = value.items.map(flat);
				if (parts.some((part) => part === null)) return null;
				const text = `[${parts.join(', ')}]`;
				return text.length <= 72 ? text : null;
			}
			case 'map': {
				if (value.map.fields.length === 0) return '{}';
				if (!value.inline) return null;
				if (comments && value.map.fields.some(hasComments)) return null;
				const parts = value.map.fields.map((field) => {
					const text = flat(field.value);
					return text === null ? null : `${JSON.stringify(field.key)}: ${text}`;
				});
				if (parts.some((part) => part === null)) return null;
				const text = `{ ${parts.join(', ')} }`;
				return text.length <= 72 ? text : null;
			}
		}
	};

	/** Writes `value`, with `head` (`"key": ` or nothing) before its opening. */
	const block = (value: ConvValue, indent: string, head: string, tail: string) => {
		const inline = flat(value);
		if (inline !== null) {
			lines.push(`${indent}${head}${inline}${tail}`);
			return;
		}
		if (value.kind === 'list') {
			lines.push(`${indent}${head}[`);
			for (const [k, item] of value.items.entries()) {
				if (item.kind === 'map') comment(item.blocks, indent + INDENT);
				block(item, indent + INDENT, '', k === value.items.length - 1 ? '' : ',');
			}
			lines.push(`${indent}]${tail}`);
			return;
		}
		const map = value as Extract<ConvValue, { kind: 'map' }>;
		lines.push(`${indent}${head}{`);
		for (const [k, field] of map.map.fields.entries()) {
			comment(field.blocks, indent + INDENT);
			const end = k === map.map.fields.length - 1 ? '' : ',';
			const note = comments && field.trailing ? ` // ${field.trailing}` : '';
			block(field.value, indent + INDENT, `${JSON.stringify(field.key)}: `, end + note);
		}
		lines.push(`${indent}}${tail}`);
	};

	comment(banner, '');
	if (banner.length > 0 && comments) lines.push('');
	block(bare ?? { kind: 'map', map: root, inline: false, blocks: [] }, '', '', '');
	return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// YAML output
// ---------------------------------------------------------------------------

const YAML_INT = /^[-+]?([0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/;
const YAML_FLOAT =
	/^([-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$/;

function yamlNumber(value: Extract<ConvValue, { kind: 'number' }>, loss: Loss): string {
	if (!Number.isFinite(value.value)) {
		// YAML does have these, so nothing is lost -- only the spelling changes.
		return Number.isNaN(value.value) ? '.nan' : value.value > 0 ? '.inf' : '-.inf';
	}
	const raw = value.raw.trim();
	if (value.float ? YAML_FLOAT.test(raw) : YAML_INT.test(raw)) return raw;
	if (loss.first(value)) loss.numbers++;
	return String(value.value);
}

/** YAML's own styles pass through; a multi-line value prefers a block scalar. */
function yamlStyle(value: string, style: StringStyle): StringStyle {
	if (value.includes('\n')) return 'block-literal';
	switch (style) {
		case 'plain':
		case 'single':
		case 'double':
			return style;
		default:
			return 'plain';
	}
}

function yamlKey(key: string): string {
	return isPlainSafe(key) ? key : JSON.stringify(key);
}

function emitYaml(root: ConvMap, bare: ConvValue | null, banner: string[][], loss: Loss): string {
	const lines: string[] = [];

	const comment = (blocks: string[][], indent: string) => {
		for (const [k, block] of blocks.entries()) {
			if (k > 0) lines.push('');
			for (const line of block) lines.push(line === '' ? `${indent}#` : `${indent}# ${line}`);
		}
	};

	/** A value that sits on the same line as its key, or null when it is a block. */
	const scalar = (value: ConvValue, indent: string): string | null => {
		switch (value.kind) {
			case 'string':
				// The block-scalar writer measures its content indent from here.
				return yamlString(value.value, yamlStyle(value.value, value.style), {
					indent,
					original: null
				});
			case 'number':
				return yamlNumber(value, loss);
			case 'boolean':
				return value.value ? 'true' : 'false';
			case 'null':
				return 'null';
			case 'datetime':
				if (loss.first(value)) loss.datetimes++;
				return value.raw;
			case 'opaque':
				if (loss.first(value)) loss.opaqueCount++;
				return value.raw;
			case 'list':
				return value.items.length === 0 ? '[]' : null;
			case 'map':
				return value.map.fields.length === 0 ? '{}' : null;
		}
	};

	const writeMap = (map: ConvMap, indent: string) => {
		for (const field of map.fields) {
			comment(field.blocks, indent);
			const note = field.trailing ? ` # ${field.trailing}` : '';
			const text = scalar(field.value, indent);
			if (text !== null) {
				lines.push(`${indent}${yamlKey(field.key)}: ${text}${note}`);
				continue;
			}
			lines.push(`${indent}${yamlKey(field.key)}:${note}`);
			writeBody(field.value, indent + INDENT);
		}
	};

	const writeBody = (value: ConvValue, indent: string) => {
		if (value.kind === 'list') writeList(value.items, indent);
		else writeMap((value as Extract<ConvValue, { kind: 'map' }>).map, indent);
	};

	const writeList = (items: ConvValue[], indent: string) => {
		for (const item of items) {
			if (item.kind === 'map' && item.blocks.length > 0) comment(item.blocks, indent);
			const text = scalar(item, indent);
			if (text !== null) {
				lines.push(`${indent}- ${text}`);
				continue;
			}
			// The item's own lines are written one level in, then the first of
			// them takes the dash in place of its indent.
			const at = lines.length;
			writeBody(item, indent + INDENT);
			if (lines.length > at) {
				lines[at] = `${indent}- ${lines[at].slice(indent.length + INDENT.length)}`;
			}
		}
	};

	comment(banner, '');
	if (banner.length > 0) lines.push('');
	if (bare) {
		const text = scalar(bare, '');
		if (text !== null) lines.push(text);
		else writeBody(bare, '');
	} else {
		writeMap(root, '');
	}
	return lines.length === 0 ? '{}\n' : `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Renders `doc` in `target`'s syntax, alongside the list of what that costs.
 *
 * The warnings are worked out while emitting rather than guessed beforehand,
 * so they describe what the returned text actually did.
 */
export function convert(doc: Document, target: Format): Conversion {
	const { root, banner, bare } = buildTree(doc);
	const loss = new Loss();
	loss.countComments(root);
	for (const block of banner) loss.comments += block.length;

	if (bare && target.id === 'toml') {
		return {
			text: '',
			warnings: [],
			error:
				'This file holds a list or a single value at the top level. TOML files must be a ' +
				'table of keys, so there is nothing to convert it into.'
		};
	}

	let text: string;
	switch (target.id) {
		case 'toml':
			text = emitToml(root, banner, loss);
			break;
		case 'json':
			text = emitJson(root, bare, banner, false, loss);
			break;
		case 'jsonc':
			text = emitJson(root, bare, banner, true, loss);
			break;
		case 'yaml':
			text = emitYaml(root, bare, banner, loss);
			break;
	}

	return { text, warnings: warningsFor(loss, target), error: null };
}

/** The same path with the target format's canonical extension. */
export function retarget(path: string, target: Format): string {
	// Only the last segment may carry the extension, the same rule the registry
	// reads one by -- a dot in a directory name is not one.
	const name = path.replace(/^.*[\\/]/, '');
	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? path.slice(0, path.length - name.length + dot) : path;
	return base + target.extensions[0];
}
