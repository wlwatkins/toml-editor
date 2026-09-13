/**
 * Tests for converting a document from one format to another.
 *
 * Run with:  npm run test:convert
 * (plain node type-stripping -- there is no test runner in this project)
 *
 * The property that matters is that a conversion is *value-preserving*: read
 * the output back with the target's own parser and the data must be the same
 * tree, minus exactly the things the warnings said would go. So most checks
 * here go through `dataOf`, which flattens a document to a plain JS value, and
 * compare the two ends rather than pinning down the exact bytes. The handful
 * of literal-text checks are for the parts users see: comments, section
 * headers, block scalars.
 */
import { convert, retarget } from '../src/lib/format/convert.ts';
import type { Document, ValueNode } from '../src/lib/format/ast.ts';
import type { Format } from '../src/lib/format/drafts.ts';
import { toml } from '../src/lib/toml/serialize.ts';
import { json, jsonc } from '../src/lib/json/serialize.ts';
import { yaml } from '../src/lib/yaml/serialize.ts';

let failures = 0;
let checks = 0;

/**
 * Deep-compares without caring about key order. Converting reshapes the file,
 * and a table that was a `[section]` at the end of a TOML file lands in the
 * middle of a YAML mapping; that is a layout change, not a data change.
 */
function canon(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canon);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => [k, canon(v)])
		);
	}
	return value;
}

function check(label: string, actual: unknown, expected: unknown) {
	checks++;
	if (JSON.stringify(canon(actual)) !== JSON.stringify(canon(expected))) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      expected: ${JSON.stringify(canon(expected))}`);
		console.error(`      actual:   ${JSON.stringify(canon(actual))}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

function includes(label: string, haystack: string, needle: string) {
	checks++;
	if (!haystack.includes(needle)) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      ${JSON.stringify(needle)} not in:\n${haystack}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

function excludes(label: string, haystack: string, needle: string) {
	checks++;
	if (haystack.includes(needle)) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      ${JSON.stringify(needle)} unexpectedly in:\n${haystack}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

// ---- reading a document back as plain data --------------------------------

/**
 * The parsed document as a plain JS value, so two formats can be compared
 * without caring how either of them wrote it down. Numbers come back as
 * numbers, dates and anything opaque as their source text.
 */
function valueData(node: ValueNode): unknown {
	switch (node.kind) {
		case 'string':
			return node.value;
		case 'integer':
		case 'float':
			return node.value;
		case 'boolean':
			return node.value;
		case 'datetime':
			return node.raw;
		case 'literal':
			return node.label === 'null' ? null : node.raw;
		case 'array':
			return node.items.map(valueData);
		case 'inline-table': {
			const out: Record<string, unknown> = {};
			for (const entry of node.entries) out[entry.key[entry.key.length - 1]] = valueData(entry.value);
			return out;
		}
	}
}

/** Walks the flat table list back into the nested object it describes. */
function dataOf(doc: Document): unknown {
	const root: Record<string, unknown> = {};

	const descend = (path: string[]): Record<string, unknown> => {
		let here = root;
		for (const part of path) {
			let next = here[part];
			if (Array.isArray(next)) next = next[next.length - 1];
			if (typeof next !== 'object' || next === null) {
				next = {};
				here[part] = next;
			}
			here = next as Record<string, unknown>;
		}
		return here;
	};

	for (const table of doc.tables) {
		let target: Record<string, unknown>;
		if (table.kind === 'array-table') {
			const parent = descend(table.path.slice(0, -1));
			const key = table.path[table.path.length - 1];
			if (!Array.isArray(parent[key])) parent[key] = [];
			const list = parent[key] as unknown[];
			target = {};
			list.push(target);
		} else {
			target = descend(table.path);
		}
		for (const entry of table.entries) {
			if (entry.key.length === 0) return valueData(entry.value);
			let owner = target;
			for (const part of entry.key.slice(0, -1)) {
				if (typeof owner[part] !== 'object' || owner[part] === null) owner[part] = {};
				owner = owner[part] as Record<string, unknown>;
			}
			owner[entry.key[entry.key.length - 1]] = valueData(entry.value);
		}
	}
	return root;
}

/** Converts, re-parses with the target's own parser, and hands back both. */
function roundTrip(source: string, from: Format, to: Format) {
	const result = convert(from.parse(source), to);
	if (result.error) throw new Error(`${from.id} -> ${to.id}: ${result.error}`);
	let doc: Document;
	try {
		doc = to.parse(result.text);
	} catch (cause) {
		throw new Error(`${from.id} -> ${to.id} produced unparseable output:\n${result.text}\n${cause}`);
	}
	return { ...result, doc, data: dataOf(doc) };
}

const warningText = (result: { warnings: { text: string }[] }) =>
	result.warnings.map((w) => w.text).join('\n');

// ---- a TOML file with one of everything -----------------------------------

const SAMPLE_TOML = `# The instrument
# Second banner line

title = "Config \\"quoted\\"" # what it is
count = 2_500
ratio = 1.5
enabled = true
started = 1979-05-27T07:32:00Z
tags = ["a", "b"]
matrix = [[1, 2], [3, 4]]
point = { x = 1, y = 2 }

# How the server is reached
[server]
host = "localhost"
port = 8080

[server.tls]
enabled = false

# Every drive, in order
[[drives]]
name = "one"

# The second one is the spare
[[drives]]
name = "two"
`;

const fromToml = toml.parse(SAMPLE_TOML);
const tomlData = dataOf(fromToml);

// ---- TOML -> YAML ---------------------------------------------------------

const tomlToYaml = roundTrip(SAMPLE_TOML, toml, yaml);
check('TOML -> YAML keeps every value', tomlToYaml.data, tomlData);
includes('TOML -> YAML keeps the banner', tomlToYaml.text, '# The instrument');
includes('TOML -> YAML keeps a section comment', tomlToYaml.text, '# How the server is reached');
includes('TOML -> YAML keeps a trailing comment', tomlToYaml.text, '# what it is');
includes('TOML -> YAML nests a section', tomlToYaml.text, 'server:\n  host: localhost');
includes('TOML -> YAML writes an array of tables as a sequence', tomlToYaml.text, '- name: one');
includes(
	'TOML -> YAML keeps the comment above the second array item',
	tomlToYaml.text,
	'# The second one is the spare'
);
includes('TOML -> YAML says numbers are rewritten', warningText(tomlToYaml), '1 number will be');
includes('TOML -> YAML says comments are kept', warningText(tomlToYaml), 'will be kept');

// ---- TOML -> JSON ---------------------------------------------------------

const tomlToJson = roundTrip(SAMPLE_TOML, toml, json);
check(
	'TOML -> JSON keeps every value, with the date as a string',
	tomlToJson.data,
	tomlData
);
excludes('TOML -> JSON drops comments', tomlToJson.text, 'The instrument');
includes('TOML -> JSON warns that comments go', warningText(tomlToJson), 'will be dropped');
includes('TOML -> JSON warns about the date', warningText(tomlToJson), 'becomes a quoted string');

// ---- TOML -> JSONC --------------------------------------------------------

const tomlToJsonc = roundTrip(SAMPLE_TOML, toml, jsonc);
check('TOML -> JSONC keeps every value', tomlToJsonc.data, tomlData);
includes('TOML -> JSONC rewrites comments with //', tomlToJsonc.text, '// The instrument');
includes('TOML -> JSONC keeps a trailing comment', tomlToJsonc.text, '// what it is');
excludes('TOML -> JSONC does not warn about dropped comments', warningText(tomlToJsonc), 'dropped');

// ---- YAML -> the rest -----------------------------------------------------

const SAMPLE_YAML = `# A machine
name: rig
retries: 3
note: |
  first line
  second line
empty:
missing: null
flags: [a, b]
server:
  host: localhost
  # the usual one
  port: 8080
drives:
  - name: one
    size: 10
  - name: two
    size: 20
`;

const fromYaml = yaml.parse(SAMPLE_YAML);
const yamlData = dataOf(fromYaml);

const yamlToToml = roundTrip(SAMPLE_YAML, yaml, toml);
includes('YAML -> TOML writes a section header', yamlToToml.text, '[server]');
includes('YAML -> TOML writes an array of tables', yamlToToml.text, '[[drives]]');
includes('YAML -> TOML keeps a multi-line string', yamlToToml.text, '"""\nfirst line\nsecond line\n"""');
includes('YAML -> TOML keeps an inner comment', yamlToToml.text, '# the usual one');
includes('YAML -> TOML names the dropped nulls', warningText(yamlToToml), 'empty, missing');
check(
	'YAML -> TOML keeps every value except the nulls',
	yamlToToml.data,
	Object.fromEntries(
		Object.entries(yamlData as Record<string, unknown>).filter(([, v]) => v !== null)
	)
);

const yamlToJson = roundTrip(SAMPLE_YAML, yaml, json);
check('YAML -> JSON keeps every value, nulls included', yamlToJson.data, yamlData);

// ---- JSON -> the rest -----------------------------------------------------

const SAMPLE_JSON = `{
  "name": "rig",
  "port": 8080,
  "nested": { "a": 1, "b": 2 },
  "deep": {
    "x": true,
    "inner": {
      "y": [1, 2, 3]
    }
  },
  "list": [
    {
      "id": 1
    },
    {
      "id": 2
    }
  ],
  "nothing": null
}
`;

const fromJson = json.parse(SAMPLE_JSON);
const jsonData = dataOf(fromJson);

const jsonToYaml = roundTrip(SAMPLE_JSON, json, yaml);
check('JSON -> YAML keeps every value', jsonToYaml.data, jsonData);
includes('JSON -> YAML writes a nested mapping', jsonToYaml.text, 'deep:\n  x: true');
includes('JSON -> YAML writes a list of records', jsonToYaml.text, '- id: 1');

const jsonToToml = roundTrip(SAMPLE_JSON, json, toml);
includes('JSON -> TOML makes a section of a multi-line object', jsonToToml.text, '[deep]');
includes('JSON -> TOML makes a section of a nested object', jsonToToml.text, '[deep.inner]');
includes('JSON -> TOML keeps a one-line object inline', jsonToToml.text, 'nested = { a = 1, b = 2 }');
includes('JSON -> TOML makes an array of tables', jsonToToml.text, '[[list]]');
includes('JSON -> TOML warns about the null', warningText(jsonToToml), 'nothing');

// ---- the awkward corners --------------------------------------------------

// A key that is bare in one format and not in another.
const ODD_KEYS = `"key with spaces" = 1
"ok" = 2
"true" = 3
`;
const oddToYaml = roundTrip(ODD_KEYS, toml, yaml);
check('odd keys survive TOML -> YAML', oddToYaml.data, dataOf(toml.parse(ODD_KEYS)));
const oddToJson = roundTrip(ODD_KEYS, toml, json);
check('odd keys survive TOML -> JSON', oddToJson.data, dataOf(toml.parse(ODD_KEYS)));

// A string that reads back as something else if written plainly.
const TRICKY = `a = "2"
b = "true"
c = "~"
d = "no"
e = "x: y"
f = ""
`;
const trickyToYaml = roundTrip(TRICKY, toml, yaml);
check('strings that look like other types stay strings', trickyToYaml.data, dataOf(toml.parse(TRICKY)));

// Infinity and NaN: YAML has them, JSON does not.
const EXTREMES = `a = inf
b = -inf
c = nan
`;
const extremesToYaml = roundTrip(EXTREMES, toml, yaml);
includes('inf becomes .inf in YAML', extremesToYaml.text, 'a: .inf');
includes('-inf becomes -.inf in YAML', extremesToYaml.text, 'b: -.inf');
includes('nan becomes .nan in YAML', extremesToYaml.text, 'c: .nan');
const extremesToJson = roundTrip(EXTREMES, toml, json);
includes('JSON writes them as null', extremesToJson.text, '"a": null');
includes('JSON warns about them', warningText(extremesToJson), 'infinite or NaN');

// Radix and underscored integers.
const RADIX = `hex = 0xff
oct = 0o17
bin = 0b1010
big = 1_000_000
`;
const radixToToml = roundTrip(RADIX, toml, toml);
includes('TOML -> TOML keeps 0xff as written', radixToToml.text, 'hex = 0xff');
const radixToJson = roundTrip(RADIX, toml, json);
includes('JSON rewrites 0xff in decimal', radixToJson.text, '"hex": 255');
includes('JSON rewrites 1_000_000 in decimal', radixToJson.text, '"big": 1000000');
check('JSON keeps the numeric values', radixToJson.data, dataOf(toml.parse(RADIX)));

// An empty document, and empty containers.
const EMPTIES = `list = []
table = {}
`;
check('empty containers survive to YAML', roundTrip(EMPTIES, toml, yaml).data, dataOf(toml.parse(EMPTIES)));
check('empty containers survive to JSON', roundTrip(EMPTIES, toml, json).data, dataOf(toml.parse(EMPTIES)));
check('an empty document becomes {}', convert(toml.parse(''), json).text, '{}\n');
check('an empty document becomes {} in YAML', convert(toml.parse(''), yaml).text, '{}\n');

// A YAML file that is a bare list has no keys to make a TOML table of.
const BARE = `- one
- two
`;
const bare = convert(yaml.parse(BARE), toml);
check('a top-level list cannot become TOML', bare.error !== null, true);
check('a top-level list can become JSON', roundTrip(BARE, yaml, json).data, ['one', 'two']);

// An alias has no meaning once it leaves YAML.
const ALIASED = `base: &anchor
  a: 1
copy: *anchor
`;
const aliased = convert(yaml.parse(ALIASED), toml);
includes('an alias is reported', warningText(aliased), 'alias');

// Sub-sections have to follow plain keys in TOML, and that gets said. A list
// of records becomes a run of `[[headers]]`, which cannot sit above `after`.
const MIXED = `{
  "list": [
    {
      "id": 1
    }
  ],
  "after": 3
}
`;
const mixed = roundTrip(MIXED, json, toml);
includes('the reordering is reported', warningText(mixed), 'move above');
check('reordering loses nothing', mixed.data, dataOf(json.parse(MIXED)));

// ---- file names -----------------------------------------------------------

check('retarget swaps the extension', retarget('C:\\x\\config.toml', yaml), 'C:\\x\\config.yaml');
check('retarget adds one when there is none', retarget('/etc/config', json), '/etc/config.json');
check('retarget leaves a dotted directory alone', retarget('/a.b/config.yml', toml), '/a.b/config.toml');

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
