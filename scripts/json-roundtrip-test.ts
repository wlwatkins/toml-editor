/**
 * Smoke tests for the JSON and JSONC layer.
 *
 * Run with:  npm run test:json
 * (plain node type-stripping -- there is no test runner in this project)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { ArrayNode, Document, InlineTableNode, ScalarNode } from '../src/lib/format/ast.ts';
import { applyDrafts, makeItem } from '../src/lib/format/edit.ts';
import { emptyDrafts, type Drafts } from '../src/lib/format/drafts.ts';
import { parseJson, parseJsonc } from '../src/lib/json/parse.ts';
import { json, jsonc } from '../src/lib/json/serialize.ts';

const here = dirname(fileURLToPath(import.meta.url));
// Normalise to LF: core.autocrlf checks the fixtures out with CRLF on Windows,
// and the CRLF test below builds its own input from this baseline.
const read = (name: string) =>
	readFileSync(join(here, '..', 'examples', name), 'utf8').replace(/\r\n/g, '\n');
const plain = read('sample.json');
const commented = read('sample.jsonc');

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
	checks++;
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      expected: ${JSON.stringify(expected)}`);
		console.error(`      actual:   ${JSON.stringify(actual)}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

function throws(label: string, run: () => unknown) {
	checks++;
	try {
		run();
		failures++;
		console.error(`FAIL  ${label} (no error was raised)`);
	} catch {
		console.log(`ok    ${label}`);
	}
}

function findEntry(doc: Document, path: string) {
	for (const table of doc.tables) {
		for (const entry of table.entries) {
			if (entry.path.join('.') === path) return entry;
		}
	}
	throw new Error(`no entry at ${path}`);
}

const doc = parseJson(plain);
const cdoc = parseJsonc(commented);

// ---- structure ------------------------------------------------------------

check(
	'nested objects become sections',
	doc.tables.map((t) => t.path.join('.')),
	['', 'server', 'server.limits', 'logging', 'database']
);
check(
	'a one-line object stays a single field',
	findEntry(doc, 'database.pool').value.kind,
	'inline-table'
);
check('an array of records stays a field', findEntry(doc, 'products').value.kind, 'array');

// ---- values ---------------------------------------------------------------

const kinds = (path: string) => findEntry(doc, path).value.kind;
check('string', kinds('title'), 'string');
check('boolean', kinds('enabled'), 'boolean');
check('integer', kinds('timeout_ms'), 'integer');
check('a number with a fraction is a float', kinds('ratio'), 'float');
check('null is an editable literal', findEntry(doc, 'retries').value, {
	id: (findEntry(doc, 'retries').value as ScalarNode).id,
	kind: 'literal',
	raw: 'null',
	label: 'null',
	editable: true,
	span: (findEntry(doc, 'retries').value as ScalarNode).span
});

// ---- comments (JSONC) -----------------------------------------------------

check('a file banner is kept, not dropped', cdoc.tables[0].detachedComments, [
	['Example configuration file.', 'The second line of the file-level comment block.']
]);
check('leading comment is attached to its key', findEntry(cdoc, 'title').leadingComments, [
	'The name reported in logs and metrics.'
]);
check(
	'a trailing comment after the comma still belongs to its key',
	findEntry(cdoc, 'server.host').trailingComment,
	'bind address'
);
check(
	'a section keeps the comment above it',
	cdoc.tables.find((t) => t.path.join('.') === 'server')?.leadingComments,
	['Connection details for the HTTP listener.']
);
check(
	'a comment block on its own line is not treated as detached',
	findEntry(cdoc, 'server.extra_ports').leadingComments,
	['Ports the health checker also probes.']
);

// A slash-star block comment becomes one line per line of its body.
const starred = parseJsonc(['/*', ' * Two lines.', ' * And a second.', ' */', '{ "a": 1 }'].join('\n'));
check('a block comment becomes a banner', starred.tables[0].detachedComments, [
	['Two lines.', 'And a second.']
]);

// ---- strictness -----------------------------------------------------------

throws('strict JSON rejects a comment', () => parseJson('{ // hi\n"a": 1 }'));
throws('strict JSON rejects a trailing comma in an object', () => parseJson('{ "a": 1, }'));
throws('strict JSON rejects a trailing comma in an array', () => parseJson('{ "a": [1, ] }'));
check('JSONC accepts a trailing comma', parseJsonc('{ "a": 1, }').tables[0].entries.length, 1);

// ---- round trip -----------------------------------------------------------

check('no drafts rewrites nothing', applyDrafts(doc, emptyDrafts(), json), plain);
check('no drafts rewrites nothing (JSONC)', applyDrafts(cdoc, emptyDrafts(), jsonc), commented);

function withDraft(mutate: (d: Drafts) => void): string {
	const drafts = emptyDrafts();
	mutate(drafts);
	return applyDrafts(doc, drafts, json);
}

const edited = withDraft((d) => {
	d.scalars[(findEntry(doc, 'server.port').value as ScalarNode).id] = '9090';
});
check('scalar edit lands', edited.includes('"port": 9090'), true);
check(
	'only the edited line changes',
	edited.split('\n').filter((line, i) => line !== plain.split('\n')[i]).length,
	1
);
check(
	'unchanged draft is a no-op',
	withDraft((d) => {
		d.scalars[(findEntry(doc, 'timeout_ms').value as ScalarNode).id] = '2500';
	}),
	plain
);

const quoted = withDraft((d) => {
	d.scalars[(findEntry(doc, 'title').value as ScalarNode).id] = 'He said "hi"\tand left';
});
check('string is escaped', quoted.includes('"title": "He said \\"hi\\"\\tand left"'), true);

const nulled = withDraft((d) => {
	d.scalars[(findEntry(doc, 'retries').value as ScalarNode).id] = '5';
});
check('a null can be given a value', nulled.includes('"retries": 5'), true);

// ---- validation -----------------------------------------------------------

const port = findEntry(doc, 'server.port').value as ScalarNode;
check('a hex literal is not a JSON number', json.validateDraft(port, '0x10') !== null, true);
check('a plain integer is', json.validateDraft(port, '-12'), null);
const retries = findEntry(doc, 'retries').value as ScalarNode;
check('an object is not a single value', json.validateDraft(retries, '{"a":1}') !== null, true);
check('a quoted string is', json.validateDraft(retries, '"gone"'), null);

// ---- arrays ---------------------------------------------------------------

const ports = findEntry(doc, 'server.extra_ports').value as ArrayNode;
check(
	'array gains an item',
	withDraft((d) => {
		d.arrays[ports.id] = [...ports.items, makeItem(ports.items[0])];
	}).includes('"extra_ports": [8081, 8082, 8083, 0]'),
	true
);
check(
	'array loses an item',
	withDraft((d) => {
		d.arrays[ports.id] = ports.items.slice(0, 1);
	}).includes('"extra_ports": [8081]'),
	true
);

const sinks = findEntry(doc, 'logging.sinks').value as ArrayNode;
const sinksGrown = withDraft((d) => {
	const extra = makeItem(sinks.items[0]);
	d.arrays[sinks.id] = [...sinks.items, extra];
	d.scalars[extra.id] = 'syslog';
});
check('multi-line array stays multi-line', sinksGrown.includes('      "syslog"\n    ]'), true);

// Reordering records keeps each one's own text, at the right indent.
const products = findEntry(doc, 'products').value as ArrayNode;
const reordered = withDraft((d) => {
	d.arrays[products.id] = [products.items[1], products.items[0]];
});
check(
	'records can be reordered',
	reordered.includes(
		'"products": [\n    { "name": "Nail", "sku": 284758393, "in_stock": false },\n' +
			'    { "name": "Hammer", "sku": 738594937, "in_stock": true }\n  ]'
	),
	true
);

// Nested edits inside a one-line object patch in place.
const pool = findEntry(doc, 'database.pool').value as InlineTableNode;
const min = pool.entries[0].value as ScalarNode;
check(
	'a value inside a one-line object patches in place',
	withDraft((d) => {
		d.scalars[min.id] = '4';
	}).includes('"pool": { "min": 4, "max": 16 }'),
	true
);

// ---- re-parsing and line endings ------------------------------------------

check(
	're-parsing an edited file works',
	(findEntry(parseJson(edited), 'server.port').value as { value: number }).value,
	9090
);

const crlf = plain.replace(/\n/g, '\r\n');
check('CRLF files round-trip unchanged', applyDrafts(parseJson(crlf), emptyDrafts(), json), crlf);

const crlfc = commented.replace(/\n/g, '\r\n');
const crlfcDoc = parseJsonc(crlfc);
check('CRLF JSONC files round-trip unchanged', applyDrafts(crlfcDoc, emptyDrafts(), jsonc), crlfc);
check(
	'CRLF trailing comments are trimmed',
	findEntry(crlfcDoc, 'server.host').trailingComment,
	'bind address'
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
