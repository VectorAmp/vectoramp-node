#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const privateMarkers = [
  /VectorAmpCore/i,
  /BlueAleph/i,
  /(?:\/builds\/|\/Users\/ec2-user\/|\/home\/hilbert\/)/i,
  /(?:research\/sable|crates\/vst-)/i,
  /gitlab\.com\/VectorAmp/i,
  /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/i,
  /glpat-[A-Za-z0-9_-]{12,}/,
  /npm_[A-Za-z0-9]{20,}/,
];
const nativeSuffix = /\.(?:a|dll|dylib|node|o|rlib|so)$/i;
const topLevelFiles = new Set(['LICENSE', 'NOTICE', 'README.md', 'package.json']);
const packOutput = execFileSync(
  'npm',
  ['pack', '--dry-run', '--ignore-scripts', '--json'],
  { encoding: 'utf8' },
);
const packs = JSON.parse(packOutput);

if (!Array.isArray(packs) || packs.length !== 1 || !Array.isArray(packs[0].files)) {
  throw new Error('npm pack returned an unexpected manifest');
}

for (const entry of packs[0].files) {
  const path = entry.path;
  if (
    typeof path !== 'string'
    || path.startsWith('/')
    || path.split('/').includes('..')
    || !(topLevelFiles.has(path) || /^dist\/[A-Za-z0-9._-]+\.(?:cjs|cts|js|ts)$/.test(path))
  ) {
    throw new Error(`unexpected npm release member: ${path}`);
  }
  if (nativeSuffix.test(path)) {
    throw new Error(`SDK archive must not vendor a native runtime: ${path}`);
  }
  const payload = readFileSync(path).toString('latin1');
  if (privateMarkers.some((marker) => marker.test(payload))) {
    throw new Error(`private marker found in npm release payload: ${path}`);
  }
}

console.log(`verified ${packs[0].files.length} public SDK release files`);
