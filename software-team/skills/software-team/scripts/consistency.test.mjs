import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SKILL = join(SCRIPTS, '..');
const PLUGIN = join(SKILL, '..', '..');
const ROOT = join(PLUGIN, '..');
const read = path => readFileSync(path, 'utf8');

export function findDrift(sources) {
  const entries = Object.entries(sources);
  return entries.filter(([, value]) => value !== entries[0][1]).map(([name]) => name);
}
export const changelogVersion = text => text.match(/^## (\d+\.\d+\.\d+)\s*$/m)?.[1];
export const readmeVersion = text => text.match(/Current plugin version:\s*(\d+\.\d+\.\d+)/)?.[1];

test('drift detector names the sources that differ', () => {
  assert.deepEqual(findDrift({ a: '1', b: '1', c: '1' }), []);
  assert.deepEqual(findDrift({ a: '1', b: '2', c: '1' }), ['b']);
  assert.deepEqual(findDrift({ a: 'x', b: 'y', c: 'z' }), ['b', 'c']);
});

test('version extractors ignore unreleased headings and require a release number', () => {
  assert.equal(changelogVersion('# Changelog\n\n## Unreleased\n\n## 1.2.3\n\n## 1.2.2\n'), '1.2.3');
  assert.equal(changelogVersion('# Changelog\n\n## Unreleased\n'), undefined);
  assert.equal(readmeVersion('**Current plugin version: 4.5.6 · Status: local pilot**'), '4.5.6');
  assert.equal(readmeVersion('no version here'), undefined);
});

test('manifests and monitor package declare one version', () => {
  const versions = {
    'software-team/plugin.json': JSON.parse(read(join(PLUGIN, 'plugin.json'))).version,
    'software-team/.codex-plugin/plugin.json': JSON.parse(read(join(PLUGIN, '.codex-plugin', 'plugin.json'))).version,
    'scripts/monitor/package.json': JSON.parse(read(join(SCRIPTS, 'monitor', 'package.json'))).version,
  };
  assert.match(versions['software-team/plugin.json'], /^\d+\.\d+\.\d+$/);
  assert.deepEqual(findDrift(versions), [], `Version drift: ${JSON.stringify(versions)}`);
});

// Root files are not part of the packaged plugin, so these checks only run in a repository checkout.
test('README and CHANGELOG match the manifest version', { skip: !existsSync(join(ROOT, 'README.md')) }, () => {
  const manifest = JSON.parse(read(join(PLUGIN, 'plugin.json'))).version;
  const versions = { manifest, 'README.md': readmeVersion(read(join(ROOT, 'README.md'))), 'CHANGELOG.md': changelogVersion(read(join(ROOT, 'CHANGELOG.md'))) };
  assert.deepEqual(findDrift(versions), [], `Version drift: ${JSON.stringify(versions)}`);
});

test('bundled operating contract is identical to the canonical root contract', { skip: !existsSync(join(ROOT, 'OPERATING-CONTRACT.md')) }, () => {
  const copies = { 'OPERATING-CONTRACT.md': read(join(ROOT, 'OPERATING-CONTRACT.md')), 'references/OPERATING-CONTRACT.md': read(join(SKILL, 'references', 'OPERATING-CONTRACT.md')) };
  assert.deepEqual(findDrift(copies), [], 'Bundled contract differs from the canonical root contract; update the copy and review the diff.');
});
