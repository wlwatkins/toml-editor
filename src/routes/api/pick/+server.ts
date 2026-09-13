import { error, json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import type { RequestHandler } from './$types';

/**
 * Opens the operating system's own file dialog and returns the chosen path.
 *
 * This has to happen server-side: a browser file input deliberately hides the
 * real path (you get `C:\fakepath\name.toml`), and the File System Access API
 * hands back an opaque handle rather than a path -- but the save pipeline works
 * by path, so the picker has to be the OS dialog on this machine.
 *
 * The starting directory is passed through the child process's environment
 * rather than interpolated into a command, so nothing a caller sends can be
 * read as script.
 */

const DIALOG_TIMEOUT_MS = 5 * 60 * 1000;

// -STA is required for the Windows common file dialog.
const WINDOWS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Open a config file'
$dialog.Filter = 'Config files|*.toml;*.tml;*.json;*.jsonc;*.yaml;*.yml|TOML (*.toml;*.tml)|*.toml;*.tml|JSON (*.json;*.jsonc)|*.json;*.jsonc|YAML (*.yaml;*.yml)|*.yaml;*.yml|All files (*.*)|*.*'
$dialog.Multiselect = $false
$start = $env:TOML_PICKER_DIR
if ($start -and (Test-Path -LiteralPath $start)) { $dialog.InitialDirectory = $start }
$anchor = New-Object System.Windows.Forms.Form
$anchor.TopMost = $true
if ($dialog.ShowDialog($anchor) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write($dialog.FileName)
}
$anchor.Dispose()
`;

const MAC_SCRIPT = `
set startDir to system attribute "TOML_PICKER_DIR"
try
    if startDir is not "" then
        set chosen to choose file with prompt "Open a config file" default location (POSIX file startDir)
    else
        set chosen to choose file with prompt "Open a config file"
    end if
on error number -128
    return ""
end try
return POSIX path of chosen
`;

interface Dialog {
	command: string;
	args: string[];
}

function dialogFor(platform: string): Dialog | null {
	switch (platform) {
		case 'win32':
			return {
				command: 'powershell.exe',
				args: [
					'-NoProfile',
					'-STA',
					'-EncodedCommand',
					Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')
				]
			};
		case 'darwin':
			return { command: 'osascript', args: ['-e', MAC_SCRIPT] };
		default:
			return {
				command: 'zenity',
				args: [
					'--file-selection',
					'--title=Open a config file',
					'--file-filter=Config files | *.toml *.tml *.json *.jsonc *.yaml *.yml',
					'--file-filter=TOML | *.toml *.tml',
					'--file-filter=JSON | *.json *.jsonc',
					'--file-filter=YAML | *.yaml *.yml',
					'--file-filter=All files | *'
				]
			};
	}
}

function showDialog(dialog: Dialog, startDir: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		execFile(
			dialog.command,
			dialog.args,
			{
				timeout: DIALOG_TIMEOUT_MS,
				windowsHide: false,
				env: { ...process.env, TOML_PICKER_DIR: startDir }
			},
			(cause, stdout) => {
				const chosen = stdout.trim();
				// Cancelling exits non-zero on zenity and osascript, so an error
				// with no path simply means the user closed the dialog.
				if (cause && !chosen) {
					const failed = cause as NodeJS.ErrnoException;
					if (failed.code === 'ENOENT') {
						reject(
							new Error(
								`Could not open a file dialog: "${dialog.command}" is not installed.` +
									(process.platform === 'linux' ? ' Install zenity, or type the path instead.' : '')
							)
						);
						return;
					}
					resolve(null);
					return;
				}
				resolve(chosen || null);
			}
		);
	});
}

export const GET: RequestHandler = async ({ url }) => {
	const dialog = dialogFor(process.platform);
	if (!dialog) error(500, `No file dialog is available on ${process.platform}`);

	let chosen: string | null;
	try {
		chosen = await showDialog(dialog, url.searchParams.get('dir')?.trim() ?? '');
	} catch (cause) {
		error(500, (cause as Error).message);
	}

	if (!chosen) return json({ cancelled: true });
	return json({ cancelled: false, path: chosen });
};
