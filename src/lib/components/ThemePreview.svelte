<script lang="ts">
	import { Editor } from '$lib/editor.svelte';
	import SectionCard from './SectionCard.svelte';

	let { themeId }: { themeId: string } = $props();

	// A sample that exercises every control the editor can render, so a theme is
	// judged on the real thing rather than on a mood board.
	const SAMPLE = `# Navigation computer settings.
# Edited in flight; changes apply at the next jump.

# Callsign broadcast on open channels.
callsign = "Nostromo 180924609"
online = true
# Millisecond budget for a single sensor sweep.
sweep_ms = 2_500
drift = 0.75
commissioned = 2031-05-27
watch_start = 04:30:00

# Primary reactor bus.
[reactor]
output_mw = 1420   # nominal, derated in atmosphere
coolant = 'deuterium'
# Loops the regulator will cycle through.
loops = [1, 2, 3]
scrammed = false

[reactor.limits]
# Hard cutout before the containment field folds.
max_temp_k = 2200
max_pressure_kpa = 480

# Where flight telemetry is written.
[telemetry]
level = "verbose"
sinks = [
  "console",
  "blackbox",
]
beacon = { channel = 7, power = 40 }
notice = """
Recording is continuous.
Erasure requires command authority."""

# Each crew slot becomes its own section.
[[crew]]
name = "Ripley"
rank = "Warrant Officer"
active = true

[[crew]]
name = "Dallas"
rank = "Captain"
active = false
`;

	const editor = new Editor();
	editor.loadText('C:\\ship\\navcom.toml', SAMPLE);

	const tables = $derived(
		(editor.doc?.tables ?? []).filter((t) => t.kind !== 'root' || t.entries.length > 0)
	);

	const label = (path: string[], kind: string, index?: number) => {
		if (kind === 'root') return 'Top level';
		const name = path.join('.');
		return kind === 'array-table' ? `${name} #${(index ?? 0) + 1}` : name;
	};
</script>

<div class="themed shell" data-theme={themeId}>
	<header class="topbar">
		<div class="bar-inner">
			<div class="brand">
				<span class="logo">T</span>
				<span class="brand-name">TOML Editor</span>
			</div>
			<div class="locator">
				<input type="text" value="C:\ship\navcom.toml" readonly aria-label="File path" />
				<button type="button" class="ghost">Open</button>
				<button type="button" class="ghost">Browse&hellip;</button>
			</div>
			<div class="actions">
				<span class="status-chip" class:dirty={editor.dirty}>
					{editor.changeCount > 0
						? `${editor.changeCount} change${editor.changeCount === 1 ? '' : 's'}`
						: 'Saved'}
				</span>
				<button type="button" class="ghost">Reload</button>
				<button type="button" class="primary" disabled={!editor.dirty}>Save</button>
			</div>
		</div>
	</header>

	<main>
		<div class="layout">
			<nav class="outline" aria-label="Sections">
				<p class="outline-head">Sections</p>
				<ul>
					{#each tables as table (table.id)}
						<li style="--indent: {table.kind === 'root' ? 0 : table.path.length - 1}">
							<span class="outline-link" class:current={table.path[0] === 'reactor'}>
								{label(table.path, table.kind, table.index)}
							</span>
						</li>
					{/each}
				</ul>
			</nav>

			<div class="content">
				<div class="tabs">
					<button type="button" class="active">Form</button>
					<button type="button">Raw</button>
					<span class="file-name">C:\ship\navcom.toml</span>
				</div>
				<div class="sections">
					{#each tables as table, index (table.id)}
						<SectionCard {table} {editor} anchor="preview-{index}" />
					{/each}
				</div>
			</div>
		</div>
	</main>
</div>

<style>
	.shell {
		min-height: 100%;
		padding-bottom: 2rem;
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}

	.bar-inner {
		display: flex;
		align-items: center;
		gap: 1rem;
		max-width: 1180px;
		margin: 0 auto;
		padding: 0.6rem 1.25rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: none;
	}

	.logo {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-control);
		background: var(--accent);
		color: var(--accent-fg);
		font-family: var(--mono);
		font-size: 0.85rem;
		font-weight: 700;
	}

	.brand-name {
		font-size: 0.9rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.locator {
		display: flex;
		gap: 0.35rem;
		flex: 1;
		min-width: 0;
	}

	.locator input {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		color: var(--fg);
		font-family: var(--mono);
		font-size: 0.8rem;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: none;
	}

	button.ghost,
	button.primary {
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-control);
		font-family: inherit;
		font-size: 0.82rem;
		white-space: nowrap;
		cursor: default;
	}

	button.ghost {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg-muted);
	}

	button.primary {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-fg);
		font-weight: 600;
	}

	button:disabled {
		opacity: 0.45;
	}

	.status-chip {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--badge-bg);
		color: var(--badge-fg);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.status-chip.dirty {
		background: var(--edited-bg);
		color: var(--edited);
	}

	main {
		max-width: 1180px;
		margin: 0 auto;
		padding: 1.25rem;
	}

	.layout {
		display: grid;
		grid-template-columns: 190px 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	.outline-head {
		margin: 0 0 0.4rem 0.5rem;
		color: var(--fg-faint);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.outline ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.outline li {
		padding-left: calc(var(--indent) * 0.6rem);
	}

	.outline-link {
		display: block;
		padding: 0.22rem 0.5rem;
		border-radius: var(--radius-control);
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 0.76rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.outline-link.current {
		background: var(--surface-hover);
		color: var(--accent);
	}

	.content {
		min-width: 0;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-bottom: 0.9rem;
	}

	.tabs button {
		padding: 0.25rem 0.65rem;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.8rem;
		cursor: default;
	}

	.tabs button.active {
		border-color: var(--border);
		background: var(--surface);
		color: var(--fg);
	}

	.file-name {
		margin-left: auto;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 0.72rem;
		white-space: nowrap;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
</style>
