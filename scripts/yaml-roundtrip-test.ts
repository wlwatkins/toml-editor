/**
 * Smoke tests for the YAML layer.
 *
 * Run with:  npm run test:yaml
 * (plain node type-stripping -- there is no test runner in this project)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { ArrayNode, Document, InlineTableNode, ScalarNode } from '../src/lib/format/ast.ts';
import { applyDrafts, makeItem } from '../src/lib/format/edit.ts';
import { emptyDrafts, type Drafts } from '../src/lib/format/drafts.ts';
import { parseYaml } from '../src/lib/yaml/parse.ts';
import { yaml } from '../src/lib/yaml/serialize.ts';

const here = dirname(fileURLToPath(import.meta.url));
// Normalise to LF: core.autocrlf checks the fixture out with CRLF on Windows,
// and the CRLF test below builds its own input from this baseline.
const sample = readFileSync(join(here, '..', 'examples', 'sample.yaml'), 'utf8').replace(
	/\r\n/g,
	'\n'
);

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

const doc = parseYaml(sample);

// ---- structure ------------------------------------------------------------

check(
	'block mappings become sections',
	doc.tables.map((t) => t.path.join('.')),
	['', 'server', 'server.limits', 'logging', 'database']
);
check(
	'a flow mapping stays a single field',
	findEntry(doc, 'database.pool').value.kind,
	'inline-table'
);
check('a block sequence is an array', findEntry(doc, 'logging.sinks').value.kind, 'array');
check(
	'a flow sequence is an array too',
	(findEntry(doc, 'server.extra_ports').value as ArrayNode).flow,
	true
);

// ---- values ---------------------------------------------------------------

const value = (path: string) => findEntry(doc, path).value as ScalarNode;
check('plain string', value('title').kind, 'string');
check('quoting style is remembered', (value('server.host') as { style: string }).style, 'double');
check('single quotes too', (value('logging.format') as { style: string }).style, 'single');
check('boolean', value('enabled').kind, 'boolean');
check('integer', value('timeout_ms').kind, 'integer');
check('float', value('ratio').kind, 'float');
check('null is an editable literal', value('retries').kind, 'literal');
check('null keeps the text the file used', (value('retries') as { raw: string }).raw, 'null');
// YAML 1.2 has no timestamp type in the core schema, so a date reads as text.
check('a date is a plain string', value('release_date').kind, 'string');
check(
	'a block scalar keeps its line breaks',
	(value('logging.banner') as { value: string }).value,
	'Multi-line values are supported.\nThey keep their line breaks.\n'
);
check(
	'a block scalar knows it was one',
	(value('logging.banner') as { style: string }).style,
	'block-literal'
);

// ---- comments -------------------------------------------------------------

check('a file banner is kept, not dropped', doc.tables[0].detachedComments, [
	['Example configuration file.', 'The second line of the file-level comment block.']
]);
check('leading comment is attached to its key', findEntry(doc, 'title').leadingComments, [
	'The name reported in logs and metrics.'
]);
check('the key does not absorb the banner', findEntry(doc, 'title').detachedComments, []);
check('trailing comment is captured', findEntry(doc, 'server.host').trailingComment, 'bind address');
check(
	'a section keeps the comment above it',
	doc.tables.find((t) => t.path.join('.') === 'server')?.leadingComments,
	['Connection details for the HTTP listener.']
);

// ---- aliases and anchors --------------------------------------------------

const aliased = parseYaml(
	['base: &defaults', '  retries: 3', 'job:', '  <<: *defaults', '  name: build', ''].join('\n')
);
const merge = findEntry(aliased, 'job.<<').value as ScalarNode & { editable: boolean };
check('an alias is shown', merge.kind, 'literal');
check('...and is labelled as one', (merge as { label: string }).label, 'alias');
check('...and cannot be edited', merge.editable, false);
check(
	'editing an alias is refused',
	yaml.validateDraft(merge, '*other') !== null,
	true
);

// A multi-document file cannot be edited safely, and says so.
throws('multi-document files are refused', () => parseYaml('a: 1\n---\nb: 2\n'));
throws('a syntax error is reported', () => parseYaml('a: [1, 2\n'));

// ---- round trip -----------------------------------------------------------

check('no drafts rewrites nothing', applyDrafts(doc, emptyDrafts(), yaml), sample);

function withDraft(mutate: (d: Drafts) => void): string {
	const drafts = emptyDrafts();
	mutate(drafts);
	return applyDrafts(doc, drafts, yaml);
}

const edited = withDraft((d) => {
	d.scalars[value('server.port').id] = '9090';
});
check('scalar edit lands', edited.includes('port: 9090'), true);
check('comment above an edited neighbour survives', edited.includes('# bind address'), true);
check(
	'only the edited line changes',
	edited.split('\n').filter((line, i) => line !== sample.split('\n')[i]).length,
	1
);
check(
	'unchanged draft is a no-op',
	withDraft((d) => {
		d.scalars[value('timeout_ms').id] = '2500';
	}),
	sample
);

// ---- quoting --------------------------------------------------------------

check(
	'a plain string stays plain when it can',
	withDraft((d) => {
		d.scalars[value('title').id] = 'Still plain';
	}).includes('title: Still plain'),
	true
);
// The danger with plain style: text that would read back as another type.
check(
	'a plain string that looks like a number gets quoted',
	withDraft((d) => {
		d.scalars[value('title').id] = '2';
	}).includes('title: "2"'),
	true
);
check(
	'...and so does one that looks like a boolean',
	withDraft((d) => {
		d.scalars[value('title').id] = 'true';
	}).includes('title: "true"'),
	true
);
check(
	'...and one carrying a comment marker',
	withDraft((d) => {
		d.scalars[value('title').id] = 'a # b';
	}).includes('title: "a # b"'),
	true
);
check(
	'single quotes are kept, and doubled inside',
	withDraft((d) => {
		d.scalars[value('logging.format').id] = "it's json";
	}).includes("format: 'it''s json'"),
	true
);
check(
	'double quotes escape the way JSON does',
	withDraft((d) => {
		d.scalars[value('server.host').id] = 'say "hi"';
	}).includes('host: "say \\"hi\\"" # bind address'),
	true
);

// An edited block scalar stays a block scalar, at the same indentation.
const rewritten = withDraft((d) => {
	d.scalars[value('logging.banner').id] = 'One line.\nAnd another.\n';
});
check(
	'an edited block scalar stays a block',
	rewritten.includes('banner: |\n    One line.\n    And another.\n'),
	true
);
// Without the final line break the chomping indicator has to change.
const chomped = withDraft((d) => {
	d.scalars[value('logging.banner').id] = 'No trailing break.';
});
check('chomping follows the value', chomped.includes('banner: |-\n    No trailing break.\n'), true);

// ---- validation -----------------------------------------------------------

const port = value('server.port');
check('a decimal integer is valid', yaml.validateDraft(port, '-12'), null);
check('a hex integer is too', yaml.validateDraft(port, '0x1f'), null);
check('a word is not', yaml.validateDraft(port, 'eight') !== null, true);
check('a fraction is not an integer', yaml.validateDraft(port, '1.5') !== null, true);
const retries = value('retries');
check('a null may become a number', yaml.validateDraft(retries, '7'), null);
check('...but not a list', yaml.validateDraft(retries, '[1, 2]') !== null, true);

// ---- arrays ---------------------------------------------------------------

const ports = findEntry(doc, 'server.extra_ports').value as ArrayNode;
check(
	'a flow sequence gains an item and stays flow',
	withDraft((d) => {
		d.arrays[ports.id] = [...ports.items, makeItem(ports.items[0])];
	}).includes('extra_ports: [8081, 8082, 8083, 0]'),
	true
);

const sinks = findEntry(doc, 'logging.sinks').value as ArrayNode;
const sinksGrown = withDraft((d) => {
	const extra = makeItem(sinks.items[0]);
	d.arrays[sinks.id] = [...sinks.items, extra];
	d.scalars[extra.id] = 'syslog';
});
check(
	'a block sequence gains an item and stays block',
	sinksGrown.includes('sinks:\n    - stdout\n    - file\n    - syslog\n'),
	true
);
check(
	'a block sequence loses an item',
	withDraft((d) => {
		d.arrays[sinks.id] = sinks.items.slice(0, 1);
	}).includes('sinks:\n    - stdout\n'),
	true
);

// Reordering records rewrites the list, and each record has to land at the
// indentation its new position calls for.
const products = findEntry(doc, 'products').value as ArrayNode;
const reordered = withDraft((d) => {
	d.arrays[products.id] = [products.items[1], products.items[0]];
});
check(
	'records can be reordered without losing their shape',
	reordered.includes(
		'products:\n' +
			'  - name: Nail\n    sku: 284758393\n    in_stock: false\n' +
			'  - name: Hammer\n    sku: 738594937\n    in_stock: true\n'
	),
	true
);
check('the reordered file still parses', parseYaml(reordered).tables.length, doc.tables.length);

// Nested edits inside a flow mapping patch in place.
const pool = findEntry(doc, 'database.pool').value as InlineTableNode;
check(
	'a value inside a flow mapping patches in place',
	withDraft((d) => {
		d.scalars[(pool.entries[0].value as ScalarNode).id] = '4';
	}).includes('pool: { min: 4, max: 16 }'),
	true
);

// ---- re-parsing and line endings ------------------------------------------

check(
	're-parsing an edited file works',
	(findEntry(parseYaml(edited), 'server.port').value as { value: number }).value,
	9090
);

const crlf = sample.replace(/\n/g, '\r\n');
const crlfDoc = parseYaml(crlf);
check('CRLF files round-trip unchanged', applyDrafts(crlfDoc, emptyDrafts(), yaml), crlf);
check(
	'CRLF trailing comments are trimmed',
	findEntry(crlfDoc, 'server.host').trailingComment,
	'bind address'
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
