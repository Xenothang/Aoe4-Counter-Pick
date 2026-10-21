#!/usr/bin/env node
// Zero-dependency build: merges manifest.base.json with a per-browser manifest,
// copies the sources into dist/<browser>/ and writes a store-ready zip.
//
//   node scripts/build.mjs            # firefox + chrome
//   node scripts/build.mjs firefox    # one target
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const TARGETS = ['firefox', 'chrome'];
const FILES = ['content.js', 'background.js', 'styles.css'];

const requested = process.argv.slice(2);
for (const t of requested) if (!TARGETS.includes(t)) { console.error(`Unknown target "${t}". Use: ${TARGETS.join(', ')}`); process.exit(1); }
const targets = requested.length ? requested : TARGETS;

const readJson = f => JSON.parse(readFileSync(join(src, f), 'utf8'));

// ---- minimal zip writer (deflate, files at the zip root, reproducible timestamps) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function listFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  }).sort();
}
function zipDirectory(dir, outFile) {
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1, DOS_TIME = 0;
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split('\\').join('/'));
    const data = readFileSync(file), comp = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, central, end]));
}

mkdirSync(dist, { recursive: true });
for (const target of targets) {
  const out = join(dist, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of FILES) cpSync(join(src, f), join(out, f));
  cpSync(join(src, 'icons'), join(out, 'icons'), { recursive: true });
  const manifest = { ...readJson('manifest.base.json'), ...readJson(`manifest.${target}.json`), version };
  // Stable key order: identity fields first.
  const { manifest_version, name, version: v, description, ...rest } = manifest;
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ manifest_version, name, version: v, description, ...rest }, null, 2) + '\n');
  const zip = join(dist, `aoe4-counter-pick-${version}-${target}.zip`);
  zipDirectory(out, zip);
  console.log(`built ${relative(root, out)}  →  ${relative(root, zip)}`);
}
