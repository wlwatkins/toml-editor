<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '$lib/editor.svelte';
	import SectionCard from '$lib/components/SectionCard.svelte';
	import { prefs, type CommentMode } from '$lib/prefs.svelte';
	import { filterDocument } from '$lib/filter';
	import {
		ask,
		initialFile,
		isDesktop,
		onMenu,
		pickFile,
		windowCommand
	} from '$lib/platform';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import AboutDialog from '$lib/components/AboutDialog.svelte';
	import ConvertDialog from '$lib/components/ConvertDialog.svelte';
	import UpdateDialog from '$lib/components/UpdateDialog.svelte';

	let updatesOpen = $state(false);

	// Installing an update quits the app, so it gets the same guard as Close.
	async function confirmInstall(): Promise<boolean> {
		if (!editor.dirty) return true;
		const count = editor.changeCount;
		const choice = await ask({
			message: 'Restart to install the update?',
			detail: `${count} unsaved change${count === 1 ? '' : 's'} will be lost. Save first if you want to keep them.`,
			buttons: ['Restart anyway', 'Cancel'],
			defaultId: 1,
			cancelId: 1
		});
		return choice === 0;
	}

	const editor = new Editor();

	let picking = $state(false);
	let aboutOpen = $state(false);
	let convertOpen = $state(false);
	let view = $state<'form' | 'raw'>('form');

	// Field filter. Comments are only part of the haystack while they are on
	// screen -- matching on a hidden comment would show a field for a reason the
	// user cannot see.
	let query = $state('');
	let searchEl = $state<HTMLInputElement | null>(null);

	const searchesComments = $derived(!!editor.format.commentMarker && prefs.comments !== 'off');

	const filter = $derived(
		editor.doc
			? filterDocument(editor.doc, query, { comments: searchesComments, source: editor })
			: null
	);

	const fieldCount = $derived(
		editor.doc ? editor.doc.tables.reduce((n, table) => n + table.entries.length, 0) : 0
	);

	// A query left over from the previous file would hide most of the new one.
	$effect(() => {
		editor.openPath;
		query = '';
	});

	// Asks the server to show this machine's own file dialog. The request stays
	// open while the dialog is up, so the button reflects that it is waiting.
	async function browse() {
		if (picking) return;
		picking = true;
		try {
			const chosen = await pickFile(editor.openPath || editor.pathInput);
			if (!chosen.cancelled && chosen.path) await editor.open(chosen.path);
		} catch (cause) {
			editor.status = { kind: 'error', text: (cause as Error).message };
		} finally {
			picking = false;
		}
	}

	const anchorFor = (index: number) => `section-${index}`;

	const tableLabel = (path: string[], kind: string, index?: number) => {
		if (kind === 'root') return 'Top level';
		const name = path.join('.');
		return kind === 'array-table' ? `${name} #${(index ?? 0) + 1}` : name;
	};

	// Restore the last session once on mount. This must not be an $effect: it
	// both reads and writes `editor.recents`, which would re-trigger itself.
	onMount(() => {
		prefs.load();
		editor.loadRecents();

		// The desktop app can be launched with a file; the browser uses ?file=.
		void (async () => {
			const launched = await initialFile();
			const fromUrl = launched ?? new URLSearchParams(window.location.search).get('file');
			const target = fromUrl ?? editor.recents[0];
			if (!target) return;
			editor.pathInput = target;
			// Only auto-open when the path was actually asked for; a recent file is
			// offered in the location bar but not opened behind the user's back.
			if (fromUrl) editor.open(fromUrl);
		})();

		onMenu((action) => {
			// A second launch with a file hands it over rather than starting a
			// second window; see the single-instance lock in electron/main.cjs.
			if (action.startsWith('open-file:')) {
				editor.open(action.slice('open-file:'.length));
				return;
			}
			if (action === 'open') browse();
			else if (action === 'save') editor.save();
			else if (action === 'reload') editor.reload();
			else if (action === 'revert') editor.revert();
			else if (action === 'convert') convertOpen = true;
			else if (action === 'close') closeFile();
		});
	});

	// Warn before losing unsaved edits on a reload or tab close.
	$effect(() => {
		if (!editor.dirty) return;
		const handler = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

	async function closeFile() {
		if (!editor.doc) return;

		if (editor.dirty) {
			const changes = `${editor.changeCount} change${editor.changeCount === 1 ? '' : 's'}`;
			const choice = await ask({
				message: 'Save changes before closing?',
				detail: `${changes} to ${editor.openPath}`,
				buttons: ['Save', "Don't save", 'Cancel'],
				defaultId: 0,
				cancelId: 2
			});

			if (choice === 2 || choice < 0) return;
			if (choice === 0) {
				await editor.save();
				// A failed save leaves the changes pending; staying open is the only
				// safe answer, and the error is already on screen.
				if (editor.dirty) return;
			}
		}

		editor.close();
	}

	const desktop = isDesktop();

	// The menus the custom title bar draws. Same actions the native menu had.
	const menus = $derived([
		{
			label: 'File',
			items: [
				{ label: 'Open...', hint: 'Ctrl+O', action: browse },
				{ label: 'Save', hint: 'Ctrl+S', action: () => editor.save(), enabled: editor.canSave },
				'separator' as const,
				{
					label: 'Reload from disk',
					hint: 'Ctrl+R',
					action: () => editor.reload(),
					enabled: !!editor.openPath
				},
				{ label: 'Discard changes', action: () => editor.revert(), enabled: editor.dirty },
				{ label: 'Close file', hint: 'Ctrl+W', action: closeFile, enabled: !!editor.doc },
				'separator' as const,
				{
					label: 'Convert to…',
					action: () => (convertOpen = true),
					enabled: !!editor.doc
				},
				'separator' as const,
				{ label: 'Exit', hint: 'Alt+F4', action: () => windowCommand('quit') }
			]
		},
		{
			label: 'Edit',
			items: [
				{ label: 'Undo', hint: 'Ctrl+Z', action: () => windowCommand('undo') },
				{ label: 'Redo', hint: 'Ctrl+Y', action: () => windowCommand('redo') },
				'separator' as const,
				{ label: 'Cut', hint: 'Ctrl+X', action: () => windowCommand('cut') },
				{ label: 'Copy', hint: 'Ctrl+C', action: () => windowCommand('copy') },
				{ label: 'Paste', hint: 'Ctrl+V', action: () => windowCommand('paste') },
				{ label: 'Select all', hint: 'Ctrl+A', action: () => windowCommand('selectAll') }
			]
		},
		{
			label: 'View',
			items: [
				{ label: 'Comments: full', action: () => prefs.setComments('full') },
				{ label: 'Comments: brief', action: () => prefs.setComments('brief') },
				{ label: 'Comments: off', action: () => prefs.setComments('off') },
				'separator' as const,
				{ label: 'Zoom in', hint: 'Ctrl++', action: () => windowCommand('zoom-in') },
				{ label: 'Zoom out', hint: 'Ctrl+-', action: () => windowCommand('zoom-out') },
				{ label: 'Reset zoom', hint: 'Ctrl+0', action: () => windowCommand('zoom-reset') },
				'separator' as const,
				{ label: 'Full screen', hint: 'F11', action: () => windowCommand('toggle-fullscreen') },
				{ label: 'Developer tools', hint: 'F12', action: () => windowCommand('devtools') }
			]
		},
		{
			label: 'Help',
			items: [
				{ label: 'Check for updates…', action: () => (updatesOpen = true) },
				'separator' as const,
				{ label: 'About TOML Editor', action: () => (aboutOpen = true) }
			]
		}
	]);

	// Without a native menu there are no built-in accelerators, so the shortcuts
	// it used to provide are bound here.
	function onKeydown(event: KeyboardEvent) {
		const mod = event.ctrlKey || event.metaKey;
		if (mod && event.key.toLowerCase() === 's') {
			event.preventDefault();
			editor.save();
			return;
		}
		if (mod && event.key.toLowerCase() === 'f' && editor.doc) {
			event.preventDefault();
			searchEl?.focus();
			searchEl?.select();
			return;
		}
		if (!desktop) return;

		if (mod && event.key.toLowerCase() === 'o') {
			event.preventDefault();
			browse();
		} else if (mod && event.key.toLowerCase() === 'w') {
			event.preventDefault();
			closeFile();
		} else if (mod && event.key.toLowerCase() === 'r') {
			event.preventDefault();
			editor.reload();
		} else if (mod && (event.key === '+' || event.key === '=')) {
			event.preventDefault();
			windowCommand('zoom-in');
		} else if (mod && event.key === '-') {
			event.preventDefault();
			windowCommand('zoom-out');
		} else if (mod && event.key === '0') {
			event.preventDefault();
			windowCommand('zoom-reset');
		} else if (event.key === 'F11') {
			event.preventDefault();
			windowCommand('toggle-fullscreen');
		} else if (event.key === 'F12') {
			event.preventDefault();
			windowCommand('devtools');
		}
	}
</script>

<svelte:head>
	<title>{editor.openPath ? `${editor.dirty ? '• ' : ''}TOML Editor` : 'TOML Editor'}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="app">
	{#if desktop}
		<TitleBar {menus} title={editor.openPath} subtitle={editor.openPath} />
	{/if}

	<header class="topbar">
	<div class="bar-inner">
		{#if !desktop}
			<div class="brand">
				<span class="logo">T</span>
				<span class="brand-name">TOML Editor</span>
			</div>
		{/if}

		<form
			class="locator"
			onsubmit={(event) => {
				event.preventDefault();
				editor.open(editor.pathInput);
			}}
		>
			<input
				type="text"
				spellcheck="false"
				autocomplete="off"
				placeholder="Path to a config file on this machine"
				bind:value={editor.pathInput}
				list="recent-files"
			/>
			<datalist id="recent-files">
				{#each editor.recents as path (path)}
					<option value={path}></option>
				{/each}
			</datalist>
			<button type="submit" class="ghost" disabled={editor.busy}>Open</button>
			<button type="button" class="ghost" onclick={browse} disabled={picking}>
				{picking ? 'Choose a file…' : 'Browse…'}
			</button>
		</form>

		<div class="actions">
			{#if editor.doc}
				<span class="status-chip" class:dirty={editor.dirty}>
					{#if editor.errorCount > 0}
						{editor.errorCount} invalid
					{:else if editor.changeCount > 0}
						{editor.changeCount} change{editor.changeCount === 1 ? '' : 's'}
					{:else}
						Saved
					{/if}
				</span>
				<button
					type="button"
					class="ghost"
					onclick={() => (convertOpen = true)}
					disabled={editor.busy}>Convert…</button
				>
				<button
					type="button"
					class="ghost"
					onclick={() => editor.revert()}
					disabled={!editor.dirty || editor.busy}>Revert</button
				>
				<button type="button" class="ghost" onclick={() => editor.reload()} disabled={editor.busy}
					>Reload</button
				>
				<button type="button" class="ghost" onclick={closeFile} disabled={editor.busy}>Close</button>
			{/if}
			<button type="button" class="primary" onclick={() => editor.save()} disabled={!editor.canSave}>
				Save
			</button>
		</div>
	</div>

	{#if editor.doc}
		<div class="filter-row">
			<div class="filter-inner">
				<span class="filter-label">Filter</span>
				<input
					class="filter"
					type="search"
					spellcheck="false"
					autocomplete="off"
					aria-label="Filter fields"
					placeholder={searchesComments
						? 'Text in a key, a value or a comment'
						: 'Text in a key or a value'}
					bind:this={searchEl}
					bind:value={query}
					onkeydown={(event) => {
						if (event.key === 'Escape') {
							event.stopPropagation();
							query = '';
						}
					}}
				/>
				{#if query.trim()}
					<span class="filter-count" aria-live="polite">
						{filter?.count ?? 0} of {fieldCount}
					</span>
					{#if view === 'raw'}
						<span class="filter-count">form view only</span>
					{/if}
					<button type="button" class="ghost" onclick={() => (query = '')}>Clear</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if editor.status}
		<p class="status {editor.status.kind}">{editor.status.text}</p>
	{/if}
	{#if editor.parseError}
		<p class="status error">Parse error: {editor.parseError}</p>
	{/if}
</header>

	<AboutDialog bind:open={aboutOpen} />
	<ConvertDialog bind:open={convertOpen} {editor} />
	{#if desktop}
		<UpdateDialog bind:open={updatesOpen} beforeInstall={confirmInstall} />
	{/if}

	<main>
		<div class="main-inner">
	{#if editor.doc}
		{@const doc = editor.doc}
		<div class="layout">
			<nav class="outline" aria-label="Sections">
				<p class="outline-head">Sections</p>
				<ul>
					{#each doc.tables as table, index (table.id)}
						{#if (table.kind !== 'root' || table.entries.length > 0) && (!filter || filter.tables.has(table.id))}
							<li style="--indent: {table.kind === 'root' ? 0 : table.path.length - 1}">
								<a href="#{anchorFor(index)}">
									{tableLabel(table.path, table.kind, table.index)}
								</a>
							</li>
						{/if}
					{/each}
				</ul>
			</nav>

			<div class="content">
				<div class="tabs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={view === 'form'}
						class:active={view === 'form'}
						onclick={() => (view = 'form')}>Form</button
					>
					<button
						type="button"
						role="tab"
						aria-selected={view === 'raw'}
						class:active={view === 'raw'}
						onclick={() => (view = 'raw')}
					>
						Raw {editor.changeCount > 0 ? '(preview)' : ''}
					</button>
					<!-- Plain JSON cannot carry comments, so the control has nothing to do. -->
					{#if editor.format.commentMarker}
						<div class="comment-modes" role="group" aria-label="Comment display">
							<span class="modes-label">Comments</span>
							{#each [['full', 'Full'], ['brief', 'Brief'], ['off', 'Off']] as [mode, text] (mode)}
								<button
									type="button"
									class:on={prefs.comments === mode}
									aria-pressed={prefs.comments === mode}
									onclick={() => prefs.setComments(mode as CommentMode)}>{text}</button
								>
							{/each}
						</div>
					{/if}

					<span class="format-badge">{editor.format.label}</span>
					<span class="file-name" title={editor.openPath}>{editor.openPath}</span>
				</div>

				{#if view === 'form'}
					{#if filter && filter.tables.size === 0}
						<p class="no-matches">
							Nothing here contains <strong>{query.trim()}</strong>.
							{#if !searchesComments}
								Comments are hidden, so they are not being searched.
							{/if}
						</p>
					{/if}
					<div class="sections">
						{#each doc.tables as table, index (table.id)}
							{#if (table.kind !== 'root' || table.entries.length > 0) && (!filter || filter.tables.has(table.id))}
								<SectionCard
									{table}
									{editor}
									anchor={anchorFor(index)}
									visible={filter?.entries ?? null}
								/>
							{/if}
						{/each}
					</div>
				{:else}
					<pre class="raw">{editor.preview}</pre>
				{/if}
			</div>
		</div>
	{:else if !editor.parseError}
		<div class="empty-state">
			<h1>Edit a config file as a form</h1>
			<p>
				Point the editor at a <code>.toml</code>, <code>.json</code>, <code>.jsonc</code> or
				<code>.yaml</code> file on this machine. Every key becomes an input, grouped exactly as the
				file groups them, with the comments kept alongside.
			</p>
			<p class="fine">
				Saving rewrites only the values you changed, so comments, ordering and spacing stay as they
				are.
			</p>
			<button type="button" class="primary big" onclick={browse} disabled={picking}>
				{picking ? 'Waiting for the file dialog…' : 'Browse for a file…'}
			</button>
			{#if editor.recents.length > 0}
				<div class="recents">
					<p class="recents-head">Recent</p>
					<ul>
						{#each editor.recents as path (path)}
							<li>
								<button type="button" onclick={() => editor.open(path)}>{path}</button>
							</li>
						{/each}
					</ul>
					<button type="button" class="link" onclick={() => editor.forgetRecents()}>Clear</button>
				</div>
			{/if}
		</div>
	{/if}
		</div>
	</main>
</div>

<style>
	/*
	 * One column the height of the window: the chrome is fixed and only <main>
	 * scrolls, so the title bar, the path bar and the tabs never move.
	 */
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	.topbar {
		flex: none;
		z-index: 10;
		background: var(--surface);
		backdrop-filter: blur(12px);
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

	/* Inset like the buttons beside it: an outward glow would overhang the bar. */
	.locator input:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent-soft);
	}

	/* Its own row under the path bar: the bar is already full, and the filter
	   belongs with the content it filters rather than with the file actions. */
	.filter-row {
		border-top: 1px solid var(--border-faint);
	}

	.filter-inner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: 1180px;
		margin: 0 auto;
		padding: 0.4rem 1.25rem 0.5rem;
	}

	.filter-label {
		flex: none;
		color: var(--fg-faint);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.filter-inner input {
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		color: var(--fg);
		font-size: 0.8rem;
	}

	/* Inset, like every other control in the chrome. */
	.filter-inner input:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent-soft);
	}

	/* There is a Clear button beside it; the native one is unstyleable. */
	.filter-inner input::-webkit-search-cancel-button {
		-webkit-appearance: none;
		appearance: none;
	}

	.filter-count {
		flex: none;
		color: var(--fg-faint);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.no-matches {
		margin: 0 0 0.9rem;
		color: var(--fg-muted);
		font-size: 0.88rem;
	}

	.no-matches strong {
		color: var(--accent);
		font-family: var(--mono);
		font-weight: 600;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: none;
	}

	button.ghost:focus-visible,
	button.primary:focus-visible,
	.tabs button:focus-visible,
	.comment-modes button:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	button.ghost,
	button.primary {
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-control);
		font-size: 0.82rem;
		cursor: pointer;
		white-space: nowrap;
	}

	button.ghost {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg-muted);
	}

	button.ghost:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--fg);
	}

	button.primary {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-fg);
		font-weight: 600;
	}

	button.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
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

	.status {
		max-width: 1180px;
		margin: 0 auto;
		padding: 0 1.25rem 0.55rem;
		font-size: 0.82rem;
	}

	.status.error {
		color: var(--danger);
	}
	.status.success {
		color: var(--success);
	}
	.status.info {
		color: var(--fg-faint);
	}

	/* The scrollport. Full width, so the scrollbar sits at the window edge
	   rather than against the centred content. */
	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.main-inner {
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

	/* Sticky within the scrollport now, not the window. */
	.outline {
		position: sticky;
		top: 0;
		max-height: calc(100vh - 10rem);
		overflow-y: auto;
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

	.outline a {
		display: block;
		padding: 0.22rem 0.5rem;
		border-radius: var(--radius-control);
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 0.76rem;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.outline a:hover {
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
		cursor: pointer;
	}

	.tabs button.active {
		border-color: var(--border);
		background: var(--surface);
		color: var(--fg);
	}

	.comment-modes {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		margin-left: auto;
		padding-left: 0.5rem;
	}

	.modes-label {
		margin-right: 0.15rem;
		color: var(--fg-faint);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.comment-modes button {
		padding: 0.12rem 0.45rem;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-faint);
		font-size: 0.74rem;
		cursor: pointer;
	}

	.comment-modes button:hover {
		color: var(--fg-muted);
	}

	.comment-modes button.on {
		border-color: var(--border);
		background: var(--surface);
		color: var(--accent);
	}

	.format-badge {
		flex: none;
		margin-left: auto;
		padding: 0.05rem 0.35rem;
		border-radius: var(--radius-control);
		background: var(--badge-bg);
		color: var(--badge-fg);
		font-family: var(--mono);
		font-size: 0.68rem;
		letter-spacing: 0.02em;
	}

	.file-name {
		flex: 0 1 auto;
		min-width: 0;
		text-align: right;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.raw {
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		background: var(--surface);
		box-shadow: var(--panel-shadow, none);
		font-family: var(--mono);
		font-size: 0.8rem;
		line-height: 1.6;
		overflow-x: auto;
		white-space: pre;
		tab-size: 4;
	}

	.empty-state {
		max-width: 34rem;
		margin: 4rem auto;
		text-align: center;
	}

	.empty-state h1 {
		margin: 0 0 0.6rem;
		font-size: 1.4rem;
	}

	.empty-state p {
		margin: 0 0 0.6rem;
		color: var(--fg-muted);
		font-size: 0.92rem;
	}

	.empty-state code {
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		font-family: var(--mono);
		font-size: 0.85em;
	}

	.fine {
		font-size: 0.85rem !important;
		color: var(--fg-faint) !important;
	}

	.big {
		margin-top: 0.9rem;
		padding: 0.55rem 1.1rem !important;
		font-size: 0.9rem !important;
	}

	.recents {
		margin-top: 2.25rem;
		text-align: left;
	}

	.recents-head {
		margin: 0 0 0.3rem;
		color: var(--fg-faint);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.recents ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.recents li button {
		display: block;
		width: 100%;
		padding: 0.3rem 0.5rem;
		border: none;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 0.76rem;
		text-align: left;
		cursor: pointer;
		overflow-wrap: anywhere;
	}

	.recents li button:hover {
		background: var(--surface-hover);
		color: var(--accent);
	}

	.link {
		margin-top: 0.4rem;
		border: none;
		background: none;
		color: var(--fg-faint);
		font-size: 0.76rem;
		text-decoration: underline;
		cursor: pointer;
	}

	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.outline {
			position: static;
			max-height: none;
		}

		.bar-inner {
			flex-wrap: wrap;
		}

		.locator {
			order: 3;
			flex-basis: 100%;
		}
	}
</style>
