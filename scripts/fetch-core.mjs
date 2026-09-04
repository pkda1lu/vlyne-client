#!/usr/bin/env node
/**
 * Fetches the binaries and geo rule sets that ship inside the installer.
 *
 * These are deliberately not committed: they are large, they are third-party,
 * and pinning them here means a version bump is a one-line change that CI and
 * every developer pick up identically.
 *
 *   node scripts/fetch-core.mjs            # download what is missing
 *   node scripts/fetch-core.mjs --force    # re-download everything
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);

// Pin every version. "latest" would make builds irreproducible.
//
// The core is the `lx` fork rather than upstream sing-box: XHTTP is an Xray
// transport that upstream does not implement, and a subscription carrying one
// xhttp node makes upstream reject the whole configuration, not just that
// node. Both the archive and the binary inside it are pinned by hash as well
// as by name, since a fork's release can be re-cut under the same tag.
const SING_BOX_REPO = 'Leadaxe/sing-box-lx';
const SING_BOX_VERSION = '1.14.0-lx.30';
const SING_BOX_ARCHIVE_SHA256 =
  '8b173637d0006526ad654ff67c7a811d2001c39f4efd4a09a06fb398668317a3';
const SING_BOX_EXE_SHA256 =
  '8d8ddb2d0eac7a7234f1dcc3a838297a993bac6840a290eae44311f51b2ec8ac';
const WINTUN_VERSION = '0.14.1';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN_DIR = path.join(ROOT, 'src-tauri', 'binaries');
const RULES_DIR = path.join(ROOT, 'src-tauri', 'resources', 'rules');
const TMP_DIR = path.join(ROOT, 'src-tauri', '.fetch-tmp');

const RULE_SETS = [
  ['geoip-ru', `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs`],
  [
    'geosite-category-ru',
    `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs`,
  ],
  [
    'geosite-category-ads-all',
    `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs`,
  ],
];

const force = process.argv.includes('--force');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  process.stdout.write(`  ${path.basename(dest)} … `);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  const { size } = await stat(dest);
  console.log(`${(size / 1024 / 1024).toFixed(2)} MB`);
  return dest;
}

/**
 * Unpack a .zip.
 *
 * `tar` is deliberately avoided: on Windows the `tar` first on PATH is often
 * GNU tar shipped with Git, which cannot read zip archives at all, and bsdtar
 * additionally mistakes a leading `D:` for a remote host. PowerShell's
 * Expand-Archive is always present on a supported Windows and has neither flaw.
 */
async function extract(archive, into) {
  await mkdir(into, { recursive: true });

  if (process.platform === 'win32') {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' ` +
        `-DestinationPath '${into.replaceAll("'", "''")}' -Force`,
    ]);
    return;
  }

  await execFileAsync('unzip', ['-oq', path.relative(into, archive)], { cwd: into });
}

/** Find one file by name anywhere under a directory. */
async function locate(dir, filename) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await locate(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return null;
}

async function sha256(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

async function fetchSingBox() {
  const target = path.join(BIN_DIR, 'sing-box.exe');

  // A binary that is present but is not the pinned build gets replaced rather
  // than kept. Skipping on presence alone is how a hand-dropped core survived
  // here for months while CI shipped a different one — a divergence nothing
  // catches until a config the shipped core rejects reaches a user.
  if (!force && (await exists(target)) && (await sha256(target)) === SING_BOX_EXE_SHA256) {
    console.log('  sing-box.exe already present');
    return;
  }

  const name = `sing-box-${SING_BOX_VERSION}-windows-amd64`;
  const url = `https://github.com/${SING_BOX_REPO}/releases/download/v${SING_BOX_VERSION}/${name}.zip`;
  const archive = await download(url, path.join(TMP_DIR, `${name}.zip`));

  const digest = await sha256(archive);
  if (digest !== SING_BOX_ARCHIVE_SHA256) {
    throw new Error(
      `${name}.zip does not match the pinned hash
  expected ${SING_BOX_ARCHIVE_SHA256}
  got      ${digest}`,
    );
  }

  await extract(archive, TMP_DIR);
  const found = await locate(TMP_DIR, 'sing-box.exe');
  if (!found) throw new Error('sing-box.exe was not in the archive');

  await mkdir(BIN_DIR, { recursive: true });
  await rename(found, target);
}

async function fetchWintun() {
  const target = path.join(BIN_DIR, 'wintun.dll');
  if (!force && (await exists(target))) {
    console.log('  wintun.dll already present');
    return;
  }

  const url = `https://www.wintun.net/builds/wintun-${WINTUN_VERSION}.zip`;
  const archive = await download(url, path.join(TMP_DIR, 'wintun.zip'));
  await extract(archive, path.join(TMP_DIR, 'wintun'));

  // The archive carries one DLL per architecture; we ship the 64-bit one.
  const found = path.join(TMP_DIR, 'wintun', 'wintun', 'bin', 'amd64', 'wintun.dll');
  if (!(await exists(found))) {
    throw new Error(`wintun.dll was not at the expected path ${found}`);
  }

  await mkdir(BIN_DIR, { recursive: true });
  await rename(found, target);
}

async function fetchRuleSets() {
  await mkdir(RULES_DIR, { recursive: true });
  for (const [name, url] of RULE_SETS) {
    const target = path.join(RULES_DIR, `${name}.srs`);
    if (!force && (await exists(target))) {
      console.log(`  ${name}.srs already present`);
      continue;
    }
    await download(url, target);
  }
}

async function writeManifest() {
  const files = {};
  for (const dir of [BIN_DIR, RULES_DIR]) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === '.gitkeep' || entry.name === 'manifest.json') continue;
      const full = path.join(dir, entry.name);
      const hash = createHash('sha256');
      hash.update(await readFile(full));
      files[path.relative(ROOT, full).replaceAll('\\', '/')] = hash.digest('hex').slice(0, 16);
    }
  }

  await writeFile(
    path.join(ROOT, 'src-tauri', 'resources', 'manifest.json'),
    `${JSON.stringify({ singBox: SING_BOX_VERSION, wintun: WINTUN_VERSION, files }, null, 2)}\n`,
  );
}

async function main() {
  console.log(`sing-box ${SING_BOX_VERSION}, wintun ${WINTUN_VERSION}`);
  try {
    await fetchSingBox();
    await fetchWintun();
    await fetchRuleSets();
    await writeManifest();
    console.log('\nAll core assets are in place.');
  } finally {
    await rm(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\nfetch-core failed: ${error.message}`);
  process.exit(1);
});
