import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReport, generateLegacyReport, validateReport, validateLegacyReport, validatePublishedReport, SECTION_IDS } from './report.mjs';
const bi = en => ({ en, fa: 'متن فارسی: ' + en });
export function fixture() {
  const snapshot = { baseSha: '1'.repeat(40), headSha: '2'.repeat(40), diffSha256: 'a'.repeat(64) };
  return { schemaVersion: 1, evidenceVersion: 2, jobId: 'feature-report', revision: 1, runId: 'run-one', codeVersion: 'abc123 + inspected changes', dirtyWorktree: true, snapshot, verificationEnvironment: 'Node 24.1.0 on Windows 11', technicalStatus: 'implemented', releaseStatus: 'not-released', reviewStatus: 'pending', title: bi('Job report'), summary: bi('Implementation awaits independent review.'), requirements: [{ id: 'REQ-1', text: bi('Reports in both languages'), status: 'met', evidenceIds: ['CHECK-1'] }], evidence: [{ id: 'CHECK-1', label: bi('Output check'), method: bi('node --test report.test.mjs'), status: 'passed', reference: 'local validation record', environment: 'Node 24.1.0 on Windows 11', basis: { ...snapshot } }], sections: Object.fromEntries(SECTION_IDS.map(id => [id, bi('Section ' + id)])), diagram: { kind: 'current', caption: bi('Report pipeline'), nodes: [{ id: 'input', label: bi('Input') }, { id: 'report', label: bi('Report') }], edges: [{ from: 'input', to: 'report' }] } };
}
function legacyFixture(input = fixture()) {
  const data = { ...input, reviewStatus: 'not-reviewed', requirements: input.requirements.map(r => ({ ...r })), evidence: input.evidence.map(e => ({ ...e })) };
  delete data.evidenceVersion; delete data.snapshot; delete data.verificationEnvironment;
  for (const evidence of data.evidence) { delete evidence.environment; delete evidence.basis; }
  return data;
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
  assert.throws(() => validateReport({ ...data, evidence: [{ ...data.evidence[0], status: 'failed' }] }), /all linked required checks to pass/);
  assert.throws(() => validateReport({ ...data, jobId: '../escape' }), /Invalid jobId/);
});
function v2(input = fixture()) {
  const data = { ...input, evidenceVersion: 2, reviewStatus: 'pending', snapshot: { baseSha: '1'.repeat(40), headSha: '2'.repeat(40), diffSha256: 'a'.repeat(64) }, verificationEnvironment: 'Node 24.1.0 on Windows 11' };
  data.evidence = data.evidence.map(e => ({ ...e, environment: 'Node 24.1.0 on Windows 11', basis: { ...data.snapshot } }));
  return data;
}
test('passing checks remain distinct from independent review pending', () => {
  const data = v2();
  assert.equal(validateReport(data).technicalStatus, 'implemented');
  assert.equal(data.evidence[0].status, 'passed');
  assert.equal(data.reviewStatus, 'pending');
  const result = generateReport(data, { project: mkdtempSync(join(tmpdir(), 'team-review-pending-')) });
  const record = JSON.parse(readFileSync(join(result.directory, 'report.json')));
  const html = readFileSync(join(result.directory, 'report.html'), 'utf8');
  const english = readFileSync(join(result.directory, 'report.en.md'), 'utf8');
  const persian = readFileSync(join(result.directory, 'report.fa.md'), 'utf8');
  assert.equal(record.evidence[0].status, 'passed');
  assert.equal(record.reviewStatus, 'pending');
  assert.match(html, /pending/);
  assert.ok(html.includes('Checks passed; independent review pending.'));
  assert.ok(english.includes('Checks passed; independent review pending.'));
  assert.ok(persian.includes('بررسی‌ها موفق؛ بازبینی مستقل در انتظار است.'));
  assert.ok(html.includes(data.snapshot.diffSha256));
  assert.throws(() => validateReport({ ...data, technicalStatus: 'verified' }), /independent review/);
  assert.throws(() => validateReport({ ...data, evidence: [{ ...data.evidence[0], basis: { ...data.snapshot, diffSha256: 'b'.repeat(64) } }] }), /stale/);
});
test('verified v2 report requires matching independent review evidence', () => {
  const data = v2();
  const secondCheck = { ...data.evidence[0], id: 'CHECK-2', label: bi('Second check') };
  data.evidence.push(secondCheck);
  data.requirements[0].evidenceIds.push('CHECK-2');
  data.technicalStatus = 'verified';
  data.reviewStatus = 'independent';
  data.reviewEvidence = { reviewer: 'Reviewer A', baseSha: data.snapshot.baseSha, headSha: data.snapshot.headSha, diffSha256: data.snapshot.diffSha256, scope: 'Changed report schema and renderer', findings: [{ id: 'REV-1', severity: 'high', disposition: 'resolved', summary: bi('Required check outcome rendering was fixed.') }] };
  assert.equal(validateReport(data).technicalStatus, 'verified');
  const result = generateReport(data, { project: mkdtempSync(join(tmpdir(), 'team-review-bound-')) });
  const record = JSON.parse(readFileSync(join(result.directory, 'report.json')));
  const html = readFileSync(join(result.directory, 'report.html'), 'utf8');
  const english = readFileSync(join(result.directory, 'report.en.md'), 'utf8');
  const persian = readFileSync(join(result.directory, 'report.fa.md'), 'utf8');
  assert.equal(record.reviewEvidence.reviewer, 'Reviewer A');
  assert.equal(record.reviewEvidence.diffSha256, record.snapshot.diffSha256);
  for (const output of [html, english, persian]) {
    assert.ok(output.includes('REV-1'));
    assert.ok(output.includes('high') || output.includes('زیاد'));
    assert.ok(output.includes('resolved') || output.includes('رفع‌شده'));
  }
  assert.ok(english.includes(data.reviewEvidence.findings[0].summary.en));
  assert.ok(persian.includes(data.reviewEvidence.findings[0].summary.fa));
  assert.throws(() => validateReport({ ...data, reviewEvidence: undefined }), /reviewer identity/);
  assert.throws(() => validateReport({ ...data, reviewEvidence: { ...data.reviewEvidence, diffSha256: 'b'.repeat(64) } }), /stale/);
});
test('every check linked to a met criterion must pass; partial work remains reportable', () => {
  for (const status of ['failed', 'inconclusive', 'not-run']) {
    const data = v2();
    const evidence = { ...data.evidence[0], id: 'CHECK-2', status };
    if (status !== 'not-run') { evidence.environment = data.verificationEnvironment; evidence.basis = { ...data.snapshot }; }
    data.evidence.push(evidence);
    data.requirements[0].evidenceIds.push('CHECK-2');
    data.technicalStatus = 'verified';
    data.reviewStatus = 'independent';
    data.reviewEvidence = { reviewer: 'Reviewer A', ...data.snapshot, scope: 'Requirement checks', findings: [] };
    assert.throws(() => validateReport(data), /all linked required checks to pass/, `met criterion accepted ${status} evidence`);
    data.technicalStatus = 'partial';
    data.reviewStatus = 'pending';
    delete data.reviewEvidence;
    data.requirements[0].status = 'partial';
    assert.equal(validateReport(data).technicalStatus, 'partial');
  }
});
test('new v2 generation requires explicit version and rejects v1/v2 mixed inputs', () => {
  const data = v2();
  const { evidenceVersion, ...missingVersion } = data;
  assert.throws(() => generateReport(missingVersion, { project: mkdtempSync(join(tmpdir(), 'team-no-version-')) }), /explicit evidenceVersion: 2/);
  assert.throws(() => validateReport(missingVersion), /explicit evidenceVersion: 2/);
  const staleVerified = v2();
  staleVerified.technicalStatus = 'verified';
  staleVerified.reviewStatus = 'independent';
  staleVerified.reviewEvidence = { reviewer: 'Reviewer A', ...staleVerified.snapshot, scope: 'Changed behavior', findings: [] };
  staleVerified.evidence[0].basis.diffSha256 = 'b'.repeat(64);
  delete staleVerified.evidenceVersion;
  assert.throws(() => generateReport(staleVerified, { project: mkdtempSync(join(tmpdir(), 'team-stale-no-version-')) }), /explicit evidenceVersion: 2/);
  assert.throws(() => generateReport({ ...legacyFixture(), evidenceVersion: 1 }, { project: mkdtempSync(join(tmpdir(), 'team-v1-default-')) }), /explicit evidenceVersion: 2/);
  assert.throws(() => validateLegacyReport({ ...legacyFixture(), evidenceVersion: 1, snapshot: data.snapshot }), /cannot include v2 snapshot/);
  assert.throws(() => generateLegacyReport(data, { project: mkdtempSync(join(tmpdir(), 'team-legacy-v2-')) }), /accepts only evidenceVersion: 1/);
});
test('legacy v1 generation is explicit, labeled unbound, and supports v1-parent to v2 continuation', () => {
  const project = mkdtempSync(join(tmpdir(), 'team-legacy-continuation-'));
  const first = legacyFixture();
  const legacy = generateLegacyReport(first, { project });
  const parent = JSON.parse(readFileSync(join(legacy.directory, 'report.json'), 'utf8'));
  assert.equal(parent.evidenceVersion, 1);
  assert.doesNotThrow(() => validatePublishedReport(parent));
  assert.match(readFileSync(join(legacy.directory, 'report.en.md'), 'utf8'), /legacy; unbound snapshot/);
  assert.throws(() => generateReport(first, { project: mkdtempSync(join(tmpdir(), 'team-implicit-legacy-')) }), /explicit evidenceVersion: 2/);
  const next = { ...fixture(), revision: 2, runId: 'run-two', parent: { revision: 1, runId: first.runId } };
  const revision = generateReport(next, { project });
  assert.equal(JSON.parse(readFileSync(join(revision.directory, 'report.json'), 'utf8')).parent.runId, first.runId);
});
test('published v1 report revisions remain readable through the compatibility validator', () => {
  for (const revision of ['r001', 'r002']) {
    const record = JSON.parse(readFileSync(new URL(`../../../../../docs/team-reports/software-team-reports/${revision}/report.json`, import.meta.url), 'utf8'));
    assert.equal(record.evidenceVersion, undefined);
    assert.doesNotThrow(() => validatePublishedReport(record));
    assert.throws(() => validateReport(record), /explicit evidenceVersion: 2/);
  }
});
test('CLI requires evidence v2 by default and offers an explicit legacy v1 option', () => {
  const script = fileURLToPath(new URL('./report.mjs', import.meta.url));
  const inputRoot = mkdtempSync(join(tmpdir(), 'team-report-cli-'));
  const input = join(inputRoot, 'input.json');
  const old = legacyFixture();
  writeFileSync(input, JSON.stringify(old));
  const rejected = spawnSync(process.execPath, [script, '--input', input, '--project', join(inputRoot, 'default-output')], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /explicit evidenceVersion: 2/);
  writeFileSync(input, JSON.stringify(fixture()));
  const v2Project = join(inputRoot, 'v2-output'); mkdirSync(v2Project);
  const current = spawnSync(process.execPath, [script, '--input', input, '--project', v2Project], { encoding: 'utf8' });
  assert.equal(current.status, 0, current.stderr);
  assert.equal(JSON.parse(readFileSync(join(JSON.parse(current.stdout).directory, 'report.json'), 'utf8')).evidenceVersion, 2);
  writeFileSync(input, JSON.stringify(old));
  const legacyProject = join(inputRoot, 'legacy-output'); mkdirSync(legacyProject);
  const legacy = spawnSync(process.execPath, [script, '--legacy-v1', '--input', input, '--project', legacyProject], { encoding: 'utf8' });
  assert.equal(legacy.status, 0, legacy.stderr);
  const generated = JSON.parse(legacy.stdout);
  assert.equal(JSON.parse(readFileSync(join(generated.directory, 'report.json'), 'utf8')).evidenceVersion, 1);
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
