import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReport, validateReport, SECTION_IDS } from './report.mjs';
const bi = en => ({ en, fa: 'متن فارسی: ' + en });
export function fixture() {
  return { schemaVersion: 1, jobId: 'feature-report', revision: 1, runId: 'run-one', codeVersion: 'abc123 + inspected changes', dirtyWorktree: true, technicalStatus: 'implemented', releaseStatus: 'not-released', reviewStatus: 'self-review-only', title: bi('Job report'), summary: bi('Implementation awaits independent review.'), requirements: [{ id: 'REQ-1', text: bi('Reports in both languages'), status: 'met', evidenceIds: ['CHECK-1'] }], evidence: [{ id: 'CHECK-1', label: bi('Output check'), method: bi('Inspect generated files'), status: 'passed', reference: 'local validation record' }], sections: Object.fromEntries(SECTION_IDS.map(id => [id, bi('Section ' + id)])), diagram: { kind: 'current', caption: bi('Report pipeline'), nodes: [{ id: 'input', label: bi('Input') }, { id: 'report', label: bi('Report') }], edges: [{ from: 'input', to: 'report' }] } };
}
test('generates aligned bilingual HTML, Markdown, record and diagrams', () => {
  const project = mkdtempSync(join(tmpdir(), 'team-report-'));
  const result = generateReport(fixture(), { project });
  for (const file of ['report.html', 'report.en.md', 'report.fa.md', 'report.json', 'diagram.en.svg', 'diagram.fa.svg']) assert.ok(existsSync(join(result.directory, file)));
  const html = readFileSync(join(result.directory, 'report.html'), 'utf8');
  assert.match(html, /lang="fa" dir="rtl"/); assert.match(html, /lang="en" dir="ltr"/); assert.match(html, /<meter/);
  for (const lang of ['en', 'fa']) assert.ok(readFileSync(join(result.directory, `report.${lang}.md`), 'utf8').includes('REQ-1'));
  const record = JSON.parse(readFileSync(join(result.directory, 'report.json'))); assert.equal(record.userAcceptance, 'pending'); assert.equal(record.dirtyWorktree, true); assert.equal(record.inputSha256.length, 64);
});
test('preserves prior revision and validates continuation identity', () => {
  const project = mkdtempSync(join(tmpdir(), 'team-revision-')), first = fixture(); const a = generateReport(first, { project });
  const before = readFileSync(join(a.directory, 'report.json'), 'utf8');
  assert.throws(() => generateReport(first, { project }), /already exists/);
  const second = { ...first, revision: 2, runId: 'run-two', parent: { revision: 1, runId: 'run-one' } };
  const b = generateReport(second, { project }); assert.match(b.path, /r002/); assert.equal(readFileSync(join(a.directory, 'report.json'), 'utf8'), before);
  assert.throws(() => generateReport({ ...second, revision: 3, parent: { revision: 1, runId: 'wrong' } }, { project }), /mismatch/);
});
test('rejects missing translation, dangling evidence and unsupported verification claims', () => {
  const data = fixture();
  assert.throws(() => validateReport({ ...data, summary: { en: 'English only' } }), /summary.fa/);
  assert.throws(() => validateReport({ ...data, technicalStatus: 'verified' }), /independent review/);
  assert.throws(() => validateReport({ ...data, evidence: [] }), /Unknown evidence/);
  assert.throws(() => validateReport({ ...data, evidence: [{ ...data.evidence[0], status: 'failed' }] }), /passing evidence/);
  assert.throws(() => validateReport({ ...data, jobId: '../escape' }), /Invalid jobId/);
});
test('HTML and SVG escape untrusted text and avoid executable content', () => {
  const data = fixture(); data.title = bi('<script>alert(1)</script>'); data.diagram.nodes[0].label = bi('<img onerror=alert(1)>');
  const result = generateReport(data, { project: mkdtempSync(join(tmpdir(), 'team-escape-')) });
  const html = readFileSync(join(result.directory, 'report.html'), 'utf8'); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img onerror')); assert.ok(html.includes('&lt;script&gt;'));
});
test('does not write through report root symlinks outside the project', () => {
  const project = mkdtempSync(join(tmpdir(), 'team-symlink-')), outside = mkdtempSync(join(tmpdir(), 'team-outside-'));
  mkdirSync(join(project, 'docs')); symlinkSync(outside, join(project, 'docs', 'team-reports'));
  assert.throws(() => generateReport(fixture(), { project }), /inside project/);
});

test('rejects an escaping docs ancestor before creating external directories', () => {
  const project = mkdtempSync(join(tmpdir(), 'team-ancestor-')), outside = mkdtempSync(join(tmpdir(), 'team-outside-'));
  symlinkSync(outside, join(project, 'docs'));
  assert.throws(() => generateReport(fixture(), { project }), /inside project/);
  assert.equal(existsSync(join(outside, 'team-reports')), false);
});
test('a new revision must identify a fresh run', () => {
  const project = mkdtempSync(join(tmpdir(), 'team-new-run-')), first = fixture(); generateReport(first, { project });
  assert.throws(() => generateReport({ ...first, revision: 2, parent: { revision: 1, runId: first.runId } }, { project }), /Later revisions/);
});
