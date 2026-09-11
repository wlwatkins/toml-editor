<script lang="ts">
	import { onMount } from 'svelte';
	import { onWindowState, windowCommand, windowState, type WindowState } from '$lib/platform';

	interface Item {
		label: string;
		hint?: string;
		action: () => void;
		enabled?: boolean;
	}
	type Entry = Item | 'separator';

	let {
		menus,
		title = '',
		subtitle = ''
	}: { menus: { label: string; items: Entry[] }[]; title?: string; subtitle?: string } = $props();

	let win = $state<WindowState>({ maximized: false, fullscreen: false, focused: true });
	let openMenu = $state<string | null>(null);
	let bar = $state<HTMLElement | null>(null);

	onMount(() => {
		void windowState().then((s) => {
			win = s;
		});
		onWindowState((s) => {
			win = s;
		});
	});

	function toggle(label: string) {
		openMenu = openMenu === label ? null : label;
	}

	// Once a menu is open, sliding across the bar switches between them, the way
	// a native menu bar behaves.
	function hover(label: string) {
		if (openMenu !== null) openMenu = label;
	}

	function run(item: Item) {
		openMenu = null;
		item.action();
	}

	function onWindowKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && openMenu !== null) {
			openMenu = null;
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (openMenu !== null && bar && !bar.contains(event.target as Node)) {
			openMenu = null;
		}
	}
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onPointerDown} />

<header class="titlebar" class:blurred={!win.focused} bind:this={bar}>
	<!-- The drag region. Interactive children opt back out with .no-drag. -->
	<div class="drag">
		<span class="brand">
			<span class="logo" aria-hidden="true">T</span>
			<span class="name">TOML Editor</span>
		</span>

		<nav class="menubar no-drag" aria-label="Main menu">
			{#each menus as menu (menu.label)}
				<div class="menu">
					<button
						type="button"
						class="menu-button"
						class:open={openMenu === menu.label}
						aria-haspopup="menu"
						aria-expanded={openMenu === menu.label}
						onclick={() => toggle(menu.label)}
						onmouseenter={() => hover(menu.label)}
					>
						{menu.label}
					</button>

					{#if openMenu === menu.label}
						<div class="dropdown" role="menu">
							{#each menu.items as item, i (i)}
								{#if item === 'separator'}
									<div class="separator" role="separator"></div>
								{:else}
									<button
										type="button"
										class="item"
										role="menuitem"
										disabled={item.enabled === false}
										onclick={() => run(item)}
									>
										<span class="item-label">{item.label}</span>
										{#if item.hint}<span class="item-hint">{item.hint}</span>{/if}
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</nav>

		<span class="title" title={subtitle}>
			{#if title}
				<span class="title-text">{title}</span>
			{/if}
		</span>

		<div class="controls no-drag">
			<button
				type="button"
				class="control"
				aria-label="Minimise"
				onclick={() => windowCommand('minimize')}
			>
				<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="1" /></svg>
			</button>
			<button
				type="button"
				class="control"
				aria-label={win.maximized ? 'Restore' : 'Maximise'}
				onclick={() => windowCommand('toggle-maximize')}
			>
				{#if win.maximized}
					<svg viewBox="0 0 12 12" aria-hidden="true">
						<rect x="2" y="3.5" width="6" height="6" fill="none" stroke-width="1" />
						<path d="M4 3.5V2h6v6H8.5" fill="none" stroke-width="1" />
					</svg>
				{:else}
					<svg viewBox="0 0 12 12" aria-hidden="true">
						<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke-width="1" />
					</svg>
				{/if}
			</button>
			<button
				type="button"
				class="control close"
				aria-label="Close"
				onclick={() => windowCommand('close')}
			>
				<svg viewBox="0 0 12 12" aria-hidden="true">
					<path d="M3 3l6 6M9 3l-6 6" stroke-width="1.2" fill="none" />
				</svg>
			</button>
		</div>
	</div>
</header>

<style>
	.titlebar {
		flex: none;
		position: relative;
		z-index: 30;
		background: var(--surface);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
		user-select: none;
	}

	.titlebar.blurred {
		color: var(--fg-faint);
	}

	.drag {
		display: flex;
		align-items: stretch;
		height: 34px;
		-webkit-app-region: drag;
	}

	.no-drag {
		-webkit-app-region: no-drag;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0 0.7rem;
		flex: none;
	}

	.logo {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-control);
		background: var(--accent);
		color: var(--accent-fg);
		font-family: var(--mono);
		font-size: 0.66rem;
		font-weight: 700;
	}

	.name {
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--fg-muted);
		white-space: nowrap;
	}

	.menubar {
		display: flex;
		align-items: stretch;
		flex: none;
	}

	.menu {
		position: relative;
		display: flex;
	}

	.menu-button {
		padding: 0 0.6rem;
		border: none;
		background: transparent;
		color: var(--fg-muted);
		font-size: 0.78rem;
		cursor: default;
	}

	/* Inset, so the ring cannot spill out of a 34px bar. */
	.menu-button:focus-visible,
	.control:focus-visible,
	.item:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	.menu-button:hover,
	.menu-button.open {
		background: var(--surface-hover);
		color: var(--accent);
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		min-width: 216px;
		padding: 0.25rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-panel);
		/* Fully opaque: a menu stacked over translucent chrome and a moving grid
		   is unreadable, however much it is blurred. */
		background: #07161f;
		box-shadow:
			0 0 0 1px rgb(34 224 255 / 0.12),
			0 16px 40px rgb(0 0 0 / 0.75);
		z-index: 40;
	}

	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		width: 100%;
		padding: 0.3rem 0.5rem;
		border: none;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg);
		font-size: 0.8rem;
		text-align: left;
		cursor: default;
		white-space: nowrap;
	}

	.item:hover:not(:disabled) {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.item:disabled {
		opacity: 0.4;
	}

	.item-hint {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 0.7rem;
	}

	.separator {
		height: 1px;
		margin: 0.25rem 0.35rem;
		background: var(--border-faint);
	}

	.title {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		min-width: 0;
		padding: 0 0.75rem;
	}

	.title-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 0.72rem;
		direction: rtl;
	}

	.controls {
		display: flex;
		flex: none;
	}

	.control {
		display: grid;
		place-items: center;
		width: 44px;
		border: none;
		background: transparent;
		color: var(--fg-muted);
		cursor: default;
	}

	.control svg {
		width: 12px;
		height: 12px;
		fill: currentColor;
		stroke: currentColor;
	}

	.control:hover {
		background: var(--surface-hover);
		color: var(--accent);
	}

	.control.close:hover {
		background: #c8322b;
		color: #fff;
	}

	@media (max-width: 720px) {
		.name,
		.title {
			display: none;
		}
	}
</style>
