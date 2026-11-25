// Token Radar's entry (Node 22, standard library only), model radar-2.
//
// Reads the sealed DefiLlama snapshot (--input <snapshot.json|directory>, default /input),
// scores every pre-token protocol with lib/model.ts, and writes to the output directory
// (MAKEFUN_OUTPUT_DIR, or /output inside the grader's container):
//
//   board.json    the ranked board: every watchlist slug plus the early radar below the floor
//   data.js       the same board in the compact shape the dashboard renders
//   dashboard/    the static page (no framework, no network)
//   screenshots/  the three views of that page, as rendered for this snapshot
//   dossier.json  the judge's summary, written last with vendor/makefun-board.ts, whose bytes
//                 the scorer rebuilds from this same output and compares
//
// Run it locally the way the grader does:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

// The board this entry stands behind, in one line of figures the run log keeps: the top row,
// the median row, and the spread between them, so a degenerate board is visible at a glance.
const top = board[0]!;
const median = board[Math.floor(board.length / 2)]!;
if (top.implied_value_usd <= median.implied_value_usd) {
  fail(`the board does not rank: the top row and the median row both sit at $${top.implied_value_usd}`, 1);
}
const watchlistSlugs = new Set(snapshot.watchlist);
const topEarly = board.find((r) => !watchlistSlugs.has(r.slug));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length === 0) fail('dashboard/ is empty: the page is what the judge reads', 1);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  const bytes = statSync(join(out, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${bytes} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap`, 1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: top row ${top.name} at $${top.implied_value_usd}, median row $${median.implied_value_usd}, peer multiple median $${radar.global_multiple} of TVL\n` +
    (topEarly === undefined ? '' : `token radar: strongest early row below the floor: ${topEarly.name} at $${topEarly.implied_value_usd} on $${topEarly.tvl_usd} of TVL\n`) +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
