<script lang="ts">
	let { children } = $props();
</script>

<!--
	The gallery is always dark, whatever the OS says, so a preview is never
	framed in a white page that fights the theme being judged.
-->
<div class="gallery-root">
	{@render children()}
</div>

<style>
	.gallery-root {
		/* A neutral dark shell, deliberately plain so it does not compete with
		   the themes on display. */
		--bg: #0f1114;
		--surface: #171a1f;
		--surface-sunken: #121519;
		--surface-hover: #1f242b;
		--input-bg: #121519;
		--fg: #e3e7ec;
		--fg-muted: #98a2ad;
		--fg-faint: #6b7681;
		--border: #272d35;
		--border-faint: #1e232a;
		--border-strong: #3b444e;
		--accent: #79b8ff;
		--accent-soft: rgb(121 184 255 / 0.18);
		--accent-fg: #0b1016;
		--radius-panel: 10px;
		--radius-control: 6px;
		--panel-shadow: none;

		min-height: 100vh;
		background: var(--bg);
		color: var(--fg);
	}

	:global(body:has(.gallery-root)) {
		background: #0f1114;
	}
</style>
