/*
 * A small Markdown renderer for TOML comments.
 *
 * Deliberately hand-written rather than pulled from npm: comment text is
 * arbitrary file content, so the one thing that really matters is that nothing
 * in it can become live HTML. Everything is escaped before any tag is emitted,
 * and the only tags that ever appear are the ones generated here.
 *
 * The subset covers what config comments actually use: headings (including the
 * `banner` style that TOML files tend to have), rules, paragraphs, bullet and
 * numbered lists, block quotes, fenced and indented code, and inline code,
 * emphasis, strikethrough and links.
 */

/** Marks extracted code spans while the rest of a line is transformed. */
const SENTINEL = String.fromCharCode(0);
const SENTINEL_RE = new RegExp(SENTINEL + '(\\d+)' + SENTINEL, 'g');

const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SETEXT = /^\s{0,3}(=+|-{2,})\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+/;
const ORDERED = /^\s{0,3}\d+[.)]\s+/;
const QUOTE = /^\s{0,3}>/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^ {4,}\S/;

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Builds an anchor, but only for schemes that cannot execute script. Anything
 * else (javascript:, data:, a bare word) is left as plain text.
 *
 * `href` and `label` arrive already escaped, so they are not escaped again.
 */
function link(href: string, label: string): string {
	if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) return label;
	return `<a href="${href.trim()}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/** Inline markup for a single run of text. */
export function renderInline(text: string): string {
	// Code spans come out first so their contents are never treated as markup.
	const codes: string[] = [];
	let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
		codes.push(code);
		return `${SENTINEL}${codes.length - 1}${SENTINEL}`;
	});

	out = escapeHtml(out);

	out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) =>
		link(href, label)
	);
	out = out.replace(
		/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
		(_, before: string, url: string) => before + link(url, url)
	);

	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
	out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
	out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

	return out.replace(
		SENTINEL_RE,
		(_, index: string) => `<code>${escapeHtml(codes[Number(index)])}</code>`
	);
}

const startsBlock = (line: string) =>
	BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line) || ATX.test(line) || RULE.test(line);

/**
 * Renders a comment block, given its lines with the leading `#` already
 * stripped.
 */
export function renderMarkdown(lines: string[]): string {
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1][0];
			const closing = new RegExp('^\\s{0,3}\\' + marker + '{3,}\\s*$');
			const body: string[] = [];
			i++;
			while (i < lines.length && !closing.test(lines[i])) {
				body.push(lines[i]);
				i++;
			}
			i++; // the closing fence
			out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
			continue;
		}

		if (INDENTED_CODE.test(line)) {
			const body: string[] = [];
			while (i < lines.length && (/^ {4,}/.test(lines[i]) || !lines[i].trim())) {
				body.push(lines[i].slice(4));
				i++;
			}
			while (body.length && !body[body.length - 1].trim()) body.pop();
			out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
			continue;
		}

		if (RULE.test(line)) {
			out.push('<hr>');
			i++;
			continue;
		}

		const atx = ATX.exec(line);
		if (atx) {
			// One `#` was the TOML comment marker, so `## Title` in the file is a
			// level-2 heading here.
			const level = Math.min(6, atx[1].length + 1);
			out.push(`<h${level}>${renderInline(atx[2])}</h${level}>`);
			i++;
			continue;
		}

		if (QUOTE.test(line)) {
			const body: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i])) {
				body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
				i++;
			}
			out.push(`<blockquote>${renderMarkdown(body)}</blockquote>`);
			continue;
		}

		if (BULLET.test(line) || ORDERED.test(line)) {
			const ordered = ORDERED.test(line);
			const marker = ordered ? ORDERED : BULLET;
			const items: string[] = [];
			while (i < lines.length) {
				const current = lines[i];
				if (marker.test(current)) {
					items.push(current.replace(marker, ''));
					i++;
				} else if (items.length && current.trim() && /^\s+/.test(current)) {
					items[items.length - 1] += ' ' + current.trim();
					i++;
				} else {
					break;
				}
			}
			const tag = ordered ? 'ol' : 'ul';
			out.push(
				`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`
			);
			continue;
		}

		// Paragraph, watching for an underline that turns it into a heading.
		const paragraph: string[] = [];
		let heading = '';
		while (i < lines.length) {
			const current = lines[i];
			if (!current.trim()) break;
			if (paragraph.length && SETEXT.test(current)) {
				const level = current.trim().startsWith('=') ? 1 : 2;
				heading = `<h${level}>${renderInline(paragraph.join(' '))}</h${level}>`;
				i++;
				break;
			}
			if (paragraph.length && startsBlock(current)) break;
			paragraph.push(current);
			i++;
		}
		if (heading) out.push(heading);
		else if (paragraph.length) out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
	}

	return out.join('');
}

/**
 * A one-line gist of a comment block, for the closed state of a disclosure.
 * Prefers a heading if the block has one.
 */
export function summarise(lines: string[]): string {
	const meaningful = lines.filter((line) => line.trim() && !RULE.test(line));

	for (let i = 0; i < meaningful.length; i++) {
		const atx = ATX.exec(meaningful[i]);
		if (atx) return plain(atx[2]);
		if (i + 1 < meaningful.length && SETEXT.test(meaningful[i + 1])) return plain(meaningful[i]);
	}
	return meaningful.length ? plain(meaningful[0]) : '';
}

/** Strips the markup characters so a summary reads as prose. */
function plain(text: string): string {
	return text
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|~~)/g, '')
		.replace(/(^|[^*\w])\*([^*]+)\*/g, '$1$2')
		.replace(/^\s{0,3}[-*+]\s+/, '')
		.replace(/^\s{0,3}>\s?/, '')
		.trim();
}
