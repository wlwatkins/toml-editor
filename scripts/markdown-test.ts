/**
 * Tests for the comment Markdown renderer.
 *
 * Run with:  npm run test:md
 */
import { renderInline, renderMarkdown, summarise } from '../src/lib/markdown.ts';

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      expected: ${JSON.stringify(expected)}`);
		console.error(`      actual:   ${JSON.stringify(actual)}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

function includes(label: string, haystack: string, needle: string) {
	checks++;
	if (!haystack.includes(needle)) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      ${JSON.stringify(needle)} not in ${JSON.stringify(haystack)}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

function excludes(label: string, haystack: string, needle: string) {
	checks++;
	if (haystack.includes(needle)) {
		failures++;
		console.error(`FAIL  ${label}`);
		console.error(`      ${JSON.stringify(needle)} unexpectedly in ${JSON.stringify(haystack)}`);
	} else {
		console.log(`ok    ${label}`);
	}
}

// ---- escaping comes first -------------------------------------------------

const hostile = [
	'<script>alert(1)</script>',
	'<img src=x onerror=alert(1)>',
	'[click](javascript:alert(1))',
	'<b onclick="x">bold?</b>'
];
const escaped = renderMarkdown(hostile);
// The guarantee is not "these words never appear" -- an escaped `&lt;img
// onerror=...&gt;` is correct output, it is the comment's own text. The
// guarantee is that the only live tags are ones this renderer emitted.
const ALLOWED = new Set([
	'p', 'br', 'hr', 'em', 'strong', 'del', 'code', 'pre', 'a', 'blockquote',
	'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);

function tagsIn(html: string): string[] {
	return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
}

check(
	'only allowlisted tags are ever emitted',
	tagsIn(escaped).filter((tag) => !ALLOWED.has(tag)),
	[]
);
excludes('no javascript: href survives', escaped, 'javascript:');

// Attributes are the other half: only real tags can carry them, and the only
// ones this renderer ever writes are the three on an anchor.
function attrsIn(html: string): string[] {
	return [...html.matchAll(/<[a-zA-Z][^>]*>/g)].flatMap((tag) =>
		[...tag[0].matchAll(/\s([a-zA-Z-]+)=/g)].map((attr) => attr[1].toLowerCase())
	);
}

check(
	'only href/target/rel attributes are emitted',
	[...new Set(attrsIn(escaped))].filter((attr) => !['href', 'target', 'rel'].includes(attr)),
	[]
);
includes('hostile markup is shown as escaped text', escaped, '&lt;script&gt;');
includes('the img tag is shown as text too', escaped, '&lt;img src=x onerror=alert(1)&gt;');

check(
	'a long hostile document emits no stray tags',
	tagsIn(
		renderMarkdown([
			'# <svg onload=alert(1)>',
			'- <iframe src=evil>',
			'> <object data=x>',
			'`<style>body{}</style>`',
			'[a](vbscript:x) [b](data:text/html,x)'
		])
	).filter((tag) => !ALLOWED.has(tag)),
	[]
);
check(
	'ampersands and quotes escape',
	renderInline('a & b "c" <d>'),
	'a &amp; b &quot;c&quot; &lt;d&gt;'
);
check(
	'markup inside a code span is inert',
	renderInline('use `<script>` here'),
	'use <code>&lt;script&gt;</code> here'
);

// ---- inline ---------------------------------------------------------------

check('code span', renderInline('the `tmcm-rs` crate'), 'the <code>tmcm-rs</code> crate');
check('bold', renderInline('**REQUIRED**'), '<strong>REQUIRED</strong>');
check('italic', renderInline('is *not* set'), 'is <em>not</em> set');
check('strikethrough', renderInline('~~gone~~'), '<del>gone</del>');
check(
	'link',
	renderInline('[docs](https://example.com)'),
	'<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>'
);
check(
	'bare url is linkified',
	renderInline('see https://example.com now'),
	'see <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a> now'
);
check('a bare underscore is left alone', renderInline('max_body_bytes'), 'max_body_bytes');
check('a path is not italicised', renderInline('config/main_a.toml'), 'config/main_a.toml');

// ---- blocks ---------------------------------------------------------------

check('paragraph', renderMarkdown(['Hello there.']), '<p>Hello there.</p>');
check(
	'soft-wrapped lines join into one paragraph',
	renderMarkdown(['Every path is relative to', 'THIS file, so the tree moves.']),
	'<p>Every path is relative to THIS file, so the tree moves.</p>'
);
check('rule', renderMarkdown(['-----------']), '<hr>');
check('atx heading gains a level (## in the file)', renderMarkdown(['# Parts']), '<h2>Parts</h2>');
check('deeper atx heading', renderMarkdown(['## Wiring']), '<h3>Wiring</h3>');
check(
	'bullet list',
	renderMarkdown(['- one', '- two']),
	'<ul><li>one</li><li>two</li></ul>'
);
check(
	'numbered list',
	renderMarkdown(['1. first', '2. second']),
	'<ol><li>first</li><li>second</li></ol>'
);
check(
	'a wrapped list item keeps its text',
	renderMarkdown(['- a long item', '  continued here']),
	'<ul><li>a long item continued here</li></ul>'
);
check('block quote', renderMarkdown(['> note this']), '<blockquote><p>note this</p></blockquote>');
check(
	'fenced code',
	renderMarkdown(['```', 'a = 1', '```']),
	'<pre><code>a = 1</code></pre>'
);
check(
	'indented code',
	renderMarkdown(['    a = 1']),
	'<pre><code>a = 1</code></pre>'
);

// The banner style real TOML files use: rule, title, rule, prose.
const banner = renderMarkdown([
	'---------------------------------------------------------------------------',
	'The parts',
	'---------------------------------------------------------------------------',
	'What this instrument is made of, each named once. Every path is relative to',
	'THIS file, so the whole `config` tree can be moved or checked out anywhere',
	'without editing a line of it. `save config` does not rewrite any of them.'
]);
check(
	'a banner becomes a rule, a heading and a paragraph',
	banner,
	'<hr><h2>The parts</h2><p>What this instrument is made of, each named once. Every path is ' +
		'relative to THIS file, so the whole <code>config</code> tree can be moved or checked out ' +
		'anywhere without editing a line of it. <code>save config</code> does not rewrite any of them.</p>'
);

check('a heading is not left in the paragraph', banner.includes('<p>The parts'), false);

// ---- summaries ------------------------------------------------------------

check('summary prefers the heading', summarise(['-----', 'The parts', '-----', 'Body text.']), 'The parts');
check('summary prefers an atx heading', summarise(['# Parts', 'Body.']), 'Parts');
check('summary falls back to the first line', summarise(['Just a note.', 'More.']), 'Just a note.');
check('summary strips markup', summarise(['The `tmcm-rs` **motor** assembly.']), 'The tmcm-rs motor assembly.');
check('summary of nothing is empty', summarise(['   ', '-----']), '');

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
