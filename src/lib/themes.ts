export interface Theme {
	id: string;
	name: string;
	tagline: string;
	blurb: string;
	/** Three colours used for the swatch on the gallery index. */
	swatch: [string, string, string];
}

export const themes: Theme[] = [
	{
		id: 'nostromo',
		name: 'Nostromo',
		tagline: 'Amber CRT terminal',
		blurb:
			'A phosphor monitor in a ship corridor. Everything is monospaced, the amber glows against near-black, and faint scanlines roll over the panels. Sharp corners, no decoration that a 1979 tube could not draw.',
		swatch: ['#0d0a06', '#ffb000', '#7a4f00']
	},
	{
		id: 'grid',
		name: 'Grid',
		tagline: 'Neon cyan on black',
		blurb:
			'Light-cycle territory. Pure black, hairline cyan borders that glow, and a perspective grid in the background. Panels look cut from glass and lit from the edges.',
		swatch: ['#000000', '#22e0ff', '#0a6b7d']
	},
	{
		id: 'flightdeck',
		name: 'Flight Deck',
		tagline: 'Command console',
		blurb:
			'The bridge of a capital ship. Fat rounded panel shoulders, amber and violet command colours on deep navy, and section headers that read like console labels.',
		swatch: ['#0a0f1c', '#ff9f45', '#b88bff']
	},
	{
		id: 'holo',
		name: 'Holo',
		tagline: 'Projected glass',
		blurb:
			'A projection hanging in mid-air. Translucent frosted panels, pale blue light, hairline edges and a soft bloom. The lightest of the six while still being dark.',
		swatch: ['#040a14', '#7fd4ff', '#1e4c66']
	},
	{
		id: 'nightcity',
		name: 'Night City',
		tagline: 'Cyberpunk signage',
		blurb:
			'Rain, neon and bad decisions. Magenta and acid yellow at full strength, heavy contrast, clipped corners and a hard drop shadow. The loudest option here.',
		swatch: ['#0b0710', '#ff2e88', '#f5e663']
	},
	{
		id: 'observatory',
		name: 'Observatory',
		tagline: 'Mission control, restrained',
		blurb:
			'The grown-up one. Cold slate blues, a single teal accent, generous spacing and no glow at all. Sci-fi in the sense of a real spacecraft display: quiet, legible, built to be stared at for hours.',
		swatch: ['#0e1317', '#4fd1c5', '#2b3945']
	}
];

export const themeById = (id: string) => themes.find((theme) => theme.id === id);
