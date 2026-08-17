// Stage the static files into dist/client for Workers Assets.
//
// This is an allowlist on purpose. Everything in the repo root that is not
// named here stays unpublished: .dev.vars, node_modules, .superpowers, the
// test files, this script. A denylist would publish anything a future commit
// adds and nobody remembers to exclude.
//
// Adding a file the pages fetch means adding it here. If a page requests
// something absent, it 404s in production with no build-time signal, so keep
// this list in step with the fetch() calls and <script src> in the HTML.

import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'client');

const ASSETS = [
	'index.html',
	'camper-vehicle-comparison.html',
	'vehicles.json',
	'shortlist/index.html',
	'shortlist/scoring.js',
	'shortlist/prefs.js',
];

await rm(OUT, { recursive: true, force: true });

for (const rel of ASSETS) {
	const dest = join(OUT, rel);
	await mkdir(dirname(dest), { recursive: true });
	// copyFile throws ENOENT on a missing source, which fails the build. A
	// silently skipped asset would deploy a site with a dead fetch instead.
	await copyFile(join(ROOT, rel), dest);
}

console.log(`staged ${ASSETS.length} assets into dist/client`);
