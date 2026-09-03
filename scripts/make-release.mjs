#!/usr/bin/env node
/**
 * Assembles the release artefacts for a built version.
 *
 * Tauri produces the installer and its detached signature, but not the manifest
 * the updater polls. That manifest is written here from the same files, so the
 * version, the signature and the download URL cannot drift apart — a mismatch
 * there is invisible until an update silently fails to install.
 *
 *   node scripts/make-release.mjs
 */

import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUNDLE = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const OUT = path.join(ROOT, 'release');

const REPO = 'pkda1lu/vlyne-client';

async function main() {
  const conf = JSON.parse(
    await readFile(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const version = conf.version;

  // Every manifest must agree, or the installer, the binary and the update
  // feed each claim a different version.
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const cargo = await readFile(path.join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');
  const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
  if (pkg.version !== version || cargoVersion !== version) {
    throw new Error(
      `version mismatch: tauri.conf ${version}, package.json ${pkg.version}, Cargo ${cargoVersion}`,
    );
  }

  const setup = path.join(BUNDLE, `Vlyne_${version}_x64-setup.exe`);
  const sigPath = `${setup}.sig`;

  const { size } = await stat(setup).catch(() => {
    throw new Error(`installer not found: ${setup}\nrun: npm run app:build`);
  });
  const signature = (await readFile(sigPath, 'utf8')).trim();

  const tag = `v${version}`;
  const asset = path.basename(setup);

  const manifest = {
    version,
    notes: `Vlyne ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `https://github.com/${REPO}/releases/download/${tag}/${asset}`,
      },
    },
  };

  await mkdir(OUT, { recursive: true });
  await copyFile(setup, path.join(OUT, asset));
  await copyFile(sigPath, path.join(OUT, `${asset}.sig`));
  await writeFile(path.join(OUT, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`version   : ${version}`);
  console.log(`installer : ${asset}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`signature : ${signature.slice(0, 24)}…`);
  console.log(`\nready in ${path.relative(ROOT, OUT)}: ${asset}, ${asset}.sig, latest.json`);
  console.log(`\npublish with:\n  gh release create ${tag} release/* --repo ${REPO} --title "Vlyne ${version}"`);
}

main().catch((error) => {
  console.error(`make-release failed: ${error.message}`);
  process.exit(1);
});
