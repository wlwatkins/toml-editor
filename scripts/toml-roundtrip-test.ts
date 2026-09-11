/**
 * Smoke tests for the comment-preserving TOML layer.
 *
 * Run with:  npm run test:toml
 * (plain node type-stripping -- there is no test runner in this project)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { ArrayNode, ScalarNode, TomlDocument, ValueNode } from '../src/lib/toml/ast.ts';
import { parseToml } from '../src/lib/toml/parse.ts';
import { applyDrafts, makeItem } from '../src/lib/toml/edit.ts';
import { emptyDrafts, type Drafts } from '../src/lib/toml/serialize.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(here, '..', 'examples', 'sample.toml'), 'utf8');

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

function findEntry(doc: TomlDocument, path: string) {
	for (const table of doc.tables) {
		for (const entry of table.entries) {
			if (entry.path.join('.') === path) return entry;
		}
	}
	throw new Error(`no entry at ${path}`);
}

const doc = parseToml(sample);

// ---- structure ------------------------------------------------------------

check(
	'tables are discovered in order',
	doc.tables.map((t) => t.path.join('.')),
	['', 'server', 'server.limits', 'logging', 'database', 'products', 'products']
);
check('array-of-tables entries are indexed', doc.tables.filter((t) => t.kind === 'array-table').map((t) => t.index), [0, 1]);

// ---- comments -------------------------------------------------------------

check('leading comment is attached to its key', findEntry(doc, 'timeout_ms').leadingComments, [
	'Millisecond budget for a single request.'
]);
check('trailing comment is captured', findEntry(doc, 'server.host').trailingComment, 'bind address');
check(
	'a blank line detaches a comment block',
	findEntry(doc, 'title').leadingComments,
	['The name reported in logs and metrics.']
);
check(
	'table headers carry their own comments',
	doc.tables.find((t) => t.path.join('.') === 'server')?.leadingComments,
	['Connection details for the HTTP listener.']
);

// ---- detached comment blocks ----------------------------------------------

// A banner at the top of a file, separated from the first key by a blank line,
// used to be discarded entirely. It belongs to the file.
const banner = parseToml(
	[
		'# -----------------',
		'# The parts',
		'# -----------------',
		'# What this is made of.',
		'',
		'# The motor assembly.',
		'motors = "parts/motors.toml"',
		'',
		'# A note that floats.',
		'',
		'# Attached to stage.',
		'stage = "parts/stage.toml"',
		''
	].join('\n')
);
const root = banner.tables[0];
check('a file banner is kept, not dropped', root.detachedComments, [
	['-----------------', 'The parts', '-----------------', 'What this is made of.']
]);
check('the key keeps its own comment', root.entries[0].leadingComments, ['The motor assembly.']);
check('the key does not absorb the banner', root.entries[0].detachedComments, []);
check('a floating note sticks to what follows', root.entries[1].detachedComments, [
	['A note that floats.']
]);
check('...without stealing the attached block', root.entries[1].leadingComments, [
	'Attached to stage.'
]);

// Comment indentation survives, because Markdown lists and code depend on it.
const indented = parseToml(['# Items:', '#   - one', '#     wrapped', 'a = 1'].join('\n'));
check('comment indentation is preserved', indented.tables[0].entries[0].leadingComments, [
	'Items:',
	'  - one',
	'    wrapped'
]);

// ---- values ---------------------------------------------------------------

const kinds = (path: string) => findEntry(doc, path).value.kind;
check('string', kinds('title'), 'string');
check('boolean', kinds('enabled'), 'boolean');
check('integer with underscores', (findEntry(doc, 'timeout_ms').value as ScalarNode & { value: number }).value, 2500);
check('float', kinds('ratio'), 'float');
check('offset date-time', kinds('launched'), 'datetime');
check('date only', (findEntry(doc, 'release_date').value as { sub: string }).sub, 'date');
check('time only', (findEntry(doc, 'daily_reset').value as { sub: string }).sub, 'time');
check('array', kinds('server.extra_ports'), 'array');
check('inline table', kinds('database.pool'), 'inline-table');
check(
	'multi-line string keeps its line break',
	(findEntry(doc, 'logging.banner').value as { value: string }).value,
	'Multi-line values are supported.\nThey keep their line breaks.'
);
check(
	'literal string style is remembered',
	(findEntry(doc, 'logging.format').value as { style: string }).style,
	'literal'
);

// ---- round trip -----------------------------------------------------------

check('no drafts rewrites nothing', applyDrafts(doc, emptyDrafts()), sample);

function withDraft(mutate: (d: Drafts) => void): string {
	const drafts = emptyDrafts();
	mutate(drafts);
	return applyDrafts(doc, drafts);
}

// Editing one value must leave the rest of the file byte-identical.
const edited = withDraft((d) => {
	d.scalars[(findEntry(doc, 'server.port').value as ScalarNode).id] = '9090';
});
check('scalar edit lands', edited.includes('port = 9090'), true);
check('comment above an edited neighbour survives', edited.includes('# bind address'), true);
check(
	'only the edited line changes',
	edited.split('\n').filter((line, i) => line !== sample.split('\n')[i]).length,
	1
);

// A value that is set back to its original text produces no rewrite at all.
check(
	'unchanged draft is a no-op',
	withDraft((d) => {
		d.scalars[(findEntry(doc, 'timeout_ms').value as ScalarNode).id] = '2_500';
	}),
	sample
);

// String escaping and quoting style.
const quoted = withDraft((d) => {
	d.scalars[(findEntry(doc, 'title').value as ScalarNode).id] = 'He said "hi"\tand left';
});
check('basic string is escaped', quoted.includes('title = "He said \\"hi\\"\\tand left"'), true);

const literal = withDraft((d) => {
	d.scalars[(findEntry(doc, 'logging.format').value as ScalarNode).id] = 'logfmt';
});
check('literal quoting style is preserved', literal.includes("format = 'logfmt'"), true);

// Array editing.
const arrayNode = findEntry(doc, 'server.extra_ports').value as ArrayNode;
const grown = withDraft((d) => {
	d.arrays[arrayNode.id] = [...arrayNode.items, makeItem(arrayNode.items[0])];
});
check('array gains an item', grown.includes('extra_ports = [8081, 8082, 8083, 0]'), true);

const shrunk = withDraft((d) => {
	d.arrays[arrayNode.id] = arrayNode.items.slice(0, 1);
});
check('array loses an item', shrunk.includes('extra_ports = [8081]'), true);

// A multi-line array stays multi-line when it changes.
const sinks = findEntry(doc, 'logging.sinks').value as ArrayNode;
const sinksGrown = withDraft((d) => {
	const extra = makeItem(sinks.items[0]) as ValueNode;
	d.arrays[sinks.id] = [...sinks.items, extra];
	d.scalars[extra.id] = 'syslog';
});
check('multi-line array stays multi-line', sinksGrown.includes('  "syslog",\n]'), true);

// Nested edits inside an inline table patch in place.
const pool = findEntry(doc, 'database.pool').value as { entries: { key: string[]; value: ValueNode }[] };
const poolMax = pool.entries.find((e) => e.key.join('.') === 'max')!.value as ScalarNode;
const pooled = withDraft((d) => {
	d.scalars[poolMax.id] = '32';
});
check('inline table value patches in place', pooled.includes('pool = { min = 2, max = 32 }'), true);

// Re-parsing the edited output must succeed and reflect the change.
const reparsed = parseToml(edited);
check(
	're-parsing an edited file works',
	(findEntry(reparsed, 'server.port').value as { value: number }).value,
	9090
);

// ---- CRLF handling --------------------------------------------------------

const crlf = sample.replace(/\n/g, '\r\n');
const crlfDoc = parseToml(crlf);
check('CRLF files round-trip unchanged', applyDrafts(crlfDoc, emptyDrafts()), crlf);
check(
	'CRLF trailing comments are trimmed',
	findEntry(crlfDoc, 'server.host').trailingComment,
	'bind address'
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
