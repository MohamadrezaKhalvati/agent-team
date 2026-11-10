#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SECTION_IDS = ['changes', 'architecture', 'decisions', 'review', 'risks', 'operations', 'nextSteps', 'revisionContext'];
const headings = {
  en: ['Implementation & changed files', 'Architecture & data flow', 'Decisions & tradeoffs', 'Independent review & corrections', 'Risks, gaps & unverified behavior', 'Run, deploy & recover', 'Recommendations & next actions', 'Revision history & continuation context'],
  fa: ['پیاده‌سازی و فایل‌های تغییرکرده', 'معماری و جریان داده', 'تصمیم‌ها و مصالحه‌ها', 'بازبینی مستقل و اصلاحات', 'ریسک‌ها، کاستی‌ها و رفتارهای بررسی‌نشده', 'اجرا، انتشار و بازیابی', 'پیشنهادها و اقدامات بعدی', 'تاریخچه اصلاح و زمینه ادامه کار'],
};
const labels = {
  en: { requirements: 'Requirements & acceptance', evidence: 'Verification evidence', diagram: 'Architecture / workflow', coverage: 'Acceptance coverage', status: 'Technical status', release: 'Release', review: 'Review', code: 'Code snapshot', dirty: 'Uncommitted changes', pending: 'User acceptance is pending. Technical completion is not approval to release.', none: 'No entries recorded; this does not prove the absence of problems.', resume: 'Request the next revision', caution: 'Evidence is supplied by the team. Rendering this report does not independently verify its claims.', parent: 'Previous revision' },
  fa: { requirements: 'نیازمندی‌ها و پذیرش', evidence: 'شواهد راستی‌آزمایی', diagram: 'معماری / جریان کار', coverage: 'پوشش معیارهای پذیرش', status: 'وضعیت فنی', release: 'انتشار', review: 'بازبینی', code: 'نسخه کد', dirty: 'تغییرات ثبت‌نشده در گیت', pending: 'پذیرش شما در انتظار بررسی است. اتمام فنی به معنی مجوز انتشار نیست.', none: 'موردی ثبت نشده است؛ این به معنی نبود مشکل نیست.', resume: 'درخواست دور اصلاح بعدی', caution: 'شواهد توسط تیم ارائه شده‌اند. ساخت این گزارش، ادعاهای آن را مستقلاً تأیید نمی‌کند.', parent: 'گزارش دور قبل' },
};
const translations = { met: 'برآورده‌شده', partial: 'بخشی انجام‌شده', 'not-met': 'برآورده‌نشده', deferred: 'به‌تعویق‌افتاده', passed: 'موفق', failed: 'ناموفق', 'not-run': 'اجرانشده', inconclusive: 'نامشخص', verified: 'تأیید فنی', implemented: 'پیاده‌سازی‌شده', blocked: 'مسدود', released: 'منتشرشده', 'not-released': 'منتشرنشده', independent: 'مستقل', 'self-review-only': 'فقط خودبازبینی', 'not-reviewed': 'بازبینی‌نشده', current: 'وضعیت موجود', proposed: 'پیشنهادی' };
const reviewTranslations = { critical: 'بحرانی', high: 'زیاد', medium: 'متوسط', low: 'کم', info: 'اطلاعاتی', open: 'باز', resolved: 'رفع‌شده', accepted: 'پذیرفته‌شده', 'not-applicable': 'نامرتبط' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (value, lang) => value[lang];
const status = (value, lang) => lang === 'fa' ? (value === 'pending' ? 'در انتظار' : translations[value] || reviewTranslations[value] || value) : value;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const digestPattern = /^[a-f0-9]{64}$/i;
function bilingual(value, name) {
  for (const lang of ['en', 'fa']) assert(value && typeof value[lang] === 'string' && value[lang].trim() && value[lang].length <= 30000, `${name}.${lang} must be non-empty text`);
}
function validateReportData(data, { allowLegacy = false, publishedLegacy = false } = {}) {
  assert(data?.schemaVersion === 1, 'schemaVersion must be 1');
  assert(typeof data.jobId === 'string' && idPattern.test(data.jobId), 'Invalid jobId');
  assert(Number.isInteger(data.revision) && data.revision > 0 && data.revision < 10000, 'Invalid revision');
  for (const key of ['runId', 'codeVersion']) assert(typeof data[key] === 'string' && data[key].trim() && data[key].length < 2000, `${key} required`);
  assert(typeof data.dirtyWorktree === 'boolean', 'dirtyWorktree must be explicit');
  assert(['implemented', 'verified', 'partial', 'blocked'].includes(data.technicalStatus), 'Invalid technical status');
  assert(['released', 'not-released'].includes(data.releaseStatus), 'Invalid release status');
  assert(['independent', 'self-review-only', 'not-reviewed', 'pending'].includes(data.reviewStatus), 'Invalid review status');
  const legacyInput = allowLegacy && (data.evidenceVersion === undefined || data.evidenceVersion === 1);
  assert(data.evidenceVersion === 2 || legacyInput, 'New reports require explicit evidenceVersion: 2');
  const evidenceVersion = legacyInput ? 1 : data.evidenceVersion;
  if (legacyInput) {
    const hasV2Bindings = data.snapshot !== undefined || data.verificationEnvironment !== undefined || data.reviewEvidence !== undefined || (Array.isArray(data.evidence) && data.evidence.some(e => e.basis !== undefined || e.environment !== undefined));
    assert(!hasV2Bindings, 'Legacy evidenceVersion: 1 cannot include v2 snapshot or review bindings');
  }
  if (evidenceVersion === 2) {
    const snapshot = data.snapshot;
    assert(snapshot && shaPattern.test(snapshot.baseSha) && shaPattern.test(snapshot.headSha) && digestPattern.test(snapshot.diffSha256), 'Evidence v2 requires immutable base, head, and diff identities');
    assert(typeof data.verificationEnvironment === 'string' && data.verificationEnvironment.trim() && data.verificationEnvironment.length <= 1000, 'Evidence v2 requires verificationEnvironment');
  }
  bilingual(data.title, 'title'); bilingual(data.summary, 'summary');
  if (data.revision > 1) assert(data.parent && Number.isInteger(data.parent.revision) && data.parent.revision > 0 && data.parent.revision < data.revision && typeof data.parent.runId === 'string' && data.parent.runId.trim() && data.parent.runId !== data.runId, 'Later revisions require parent revision and runId');
  else assert(!data.parent, 'First revision must not have a parent');
  for (const key of ['requirements', 'evidence']) assert(Array.isArray(data[key]) && data[key].length <= 500, `${key} must be a bounded array`);
  assert(data.requirements.length > 0, 'At least one acceptance requirement is required');
  const ids = new Set();
  function unique(id) { assert(typeof id === 'string' && idPattern.test(id) && !ids.has(id), 'Invalid or duplicate ID'); ids.add(id); }
  const evidenceIds = new Set();
  for (const e of data.evidence) {
    unique(e.id); evidenceIds.add(e.id); bilingual(e.label, 'evidence.label'); bilingual(e.method, 'evidence.method');
    assert(['passed', 'failed', 'not-run', 'inconclusive'].includes(e.status), 'Invalid evidence status');
    assert(typeof e.reference === 'string' && e.reference.trim() && e.reference.length < 4000, 'Evidence reference required');
    if (evidenceVersion === 2 && e.status !== 'not-run') {
      assert(typeof e.environment === 'string' && e.environment.trim() && e.environment.length <= 1000, 'Executed evidence needs its environment');
      const snapshot = data.snapshot, basis = e.basis;
      assert(basis && basis.baseSha === snapshot.baseSha && basis.headSha === snapshot.headSha && basis.diffSha256 === snapshot.diffSha256, 'Executed evidence is missing or stale for the delivered snapshot');
    }
  }
  for (const r of data.requirements) {
    unique(r.id); bilingual(r.text, 'requirement.text'); assert(['met', 'partial', 'not-met', 'deferred'].includes(r.status), 'Invalid requirement status');
    assert(Array.isArray(r.evidenceIds) && r.evidenceIds.every(id => evidenceIds.has(id)), 'Unknown evidence reference');
    if (r.status === 'met') {
      const linked = r.evidenceIds.map(id => data.evidence.find(e => e.id === id));
      assert(linked.length > 0 && (publishedLegacy ? linked.some(e => e.status === 'passed') : linked.every(e => e.status === 'passed')), 'Met requirement needs all linked required checks to pass');
    }
  }
  if (evidenceVersion === 2 && data.reviewStatus === 'independent') {
    const review = data.reviewEvidence, snapshot = data.snapshot;
    assert(review && typeof review.reviewer === 'string' && review.reviewer.trim() && review.reviewer.length <= 300, 'Independent review requires reviewer identity');
    assert(review.baseSha === snapshot.baseSha && review.headSha === snapshot.headSha && review.diffSha256 === snapshot.diffSha256, 'Independent review evidence is missing or stale for the delivered snapshot');
    assert(typeof review.scope === 'string' && review.scope.trim() && review.scope.length <= 4000, 'Independent review requires scope');
    assert(Array.isArray(review.findings) && review.findings.length <= 200, 'Independent review findings must be a bounded array');
    for (const finding of review.findings) {
      assert(typeof finding.id === 'string' && idPattern.test(finding.id), 'Invalid review finding ID');
      assert(['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity), 'Invalid review finding severity');
      assert(['open', 'resolved', 'accepted', 'not-applicable'].includes(finding.disposition), 'Invalid review finding disposition');
      bilingual(finding.summary, 'review finding summary');
      for (const lang of ['en', 'fa']) assert(finding.summary[lang].length <= 2000, 'Review finding summary is too long');
    }
  }
  if (data.technicalStatus === 'verified') {
    assert(data.reviewStatus === 'independent', 'Verified completion requires independent review');
    assert(data.requirements.every(r => r.status === 'met'), 'Verified completion requires all listed acceptance criteria met');
    if (evidenceVersion === 2) {
      assert(data.reviewEvidence, 'Verified completion requires independent review evidence');
      assert(!data.reviewEvidence.findings.some(f => f.disposition === 'open' && ['critical', 'high'].includes(f.severity)), 'Verified completion cannot have open critical or high review findings');
    }
  }
  for (const key of SECTION_IDS) bilingual(data.sections?.[key], `sections.${key}`);
  const d = data.diagram; assert(d && ['current', 'proposed'].includes(d.kind), 'Diagram must identify current or proposed state');
  bilingual(d.caption, 'diagram.caption');
  assert(Array.isArray(d.nodes) && d.nodes.length >= 2 && d.nodes.length <= 12, 'Diagram needs 2–12 nodes');
  const nodes = new Set();
  for (const n of d.nodes) { assert(typeof n.id === 'string' && idPattern.test(n.id) && !nodes.has(n.id), 'Invalid diagram node'); nodes.add(n.id); bilingual(n.label, 'node.label'); for (const lang of ['en', 'fa']) assert(n.label[lang].length <= 64, 'Keep diagram labels short'); }
  assert(Array.isArray(d.edges) && d.edges.length <= 24, 'Invalid diagram edges');
  for (const edge of d.edges) assert(nodes.has(edge.from) && nodes.has(edge.to) && edge.from !== edge.to, 'Invalid diagram edge');
  return data;
}
export function validateReport(data) { return validateReportData(data); }
export function validatePublishedReport(data) { return validateReportData(data, { allowLegacy: true, publishedLegacy: true }); }
export function validateLegacyReport(data) {
  assert(data?.evidenceVersion === undefined || data.evidenceVersion === 1, 'Legacy compatibility accepts only evidenceVersion: 1 inputs');
  return validateReportData(data, { allowLegacy: true });
}
export function diagramSvg(data, lang) {
  const nodes = data.diagram.nodes, width = 760, height = nodes.length * 100 + 20;
  const positions = new Map(nodes.map((n, i) => [n.id, { x: 160, y: 20 + i * 100 }]));
  const edges = data.diagram.edges.map(e => { const a = positions.get(e.from), b = positions.get(e.to); return `<path d="M 600 ${a.y + 25} C 710 ${a.y + 25},710 ${b.y + 25},600 ${b.y + 25}" fill="none" stroke="#739986" stroke-width="2" marker-end="url(#arrow-${lang})"/>`; }).join('');
  const boxes = nodes.map(n => { const p = positions.get(n.id); return `<rect x="${p.x}" y="${p.y}" width="440" height="52" rx="8" fill="#eef5ef" stroke="#9ab9a5"/><text x="380" y="${p.y + 31}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" fill="#173b30" direction="${lang === 'fa' ? 'rtl' : 'ltr'}">${escape(text(n.label, lang))}</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(text(data.diagram.caption, lang))}"><title>${escape(text(data.diagram.caption, lang))}</title><defs><marker id="arrow-${lang}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#739986"/></marker></defs>${edges}${boxes}</svg>`;
}
function coverage(data, lang) {
  const counts = ['met', 'partial', 'not-met', 'deferred'].map(key => [key, data.requirements.filter(r => r.status === key).length]);
  return `<div class="coverage" aria-label="${labels[lang].coverage}">${counts.map(([key, count]) => `<div><strong>${count}</strong><span>${escape(status(key, lang))}</span><meter min="0" max="${data.requirements.length}" value="${count}">${count}</meter></div>`).join('')}</div>`;
}
const reviewLabels = {
  en: { findings: 'Structured independent review findings', reviewer: 'Reviewer', scope: 'Scope', severity: 'Severity', disposition: 'Disposition', none: 'No findings recorded.' },
  fa: { findings: 'یافته‌های ساختاریافته بازبینی مستقل', reviewer: 'بازبین', scope: 'دامنه', severity: 'شدت', disposition: 'وضعیت', none: 'یافته‌ای ثبت نشده است.' },
};
function reviewFindings(data, lang) {
  if (!data.reviewEvidence) return '';
  const l = reviewLabels[lang];
  const entries = data.reviewEvidence.findings.length
    ? data.reviewEvidence.findings.map(f => `<li><strong><bdi>${escape(f.id)}</bdi></strong> · ${escape(l.severity)}: ${escape(status(f.severity, lang))} · ${escape(l.disposition)}: ${escape(status(f.disposition, lang))}<p>${escape(text(f.summary, lang))}</p></li>`).join('')
    : `<li>${escape(l.none)}</li>`;
  return `<section><h2>${escape(l.findings)}</h2><p>${escape(l.reviewer)}: ${escape(data.reviewEvidence.reviewer)}</p><p>${escape(l.scope)}: ${escape(data.reviewEvidence.scope)}</p><ul>${entries}</ul></section>`;
}
function resume(data, lang) {
  return lang === 'fa' ? `کار ${data.jobId} را از گزارش r${String(data.revision).padStart(3, '0')} ادامه بده. درخواست‌های اصلاح من: [شناسه مورد و تغییر موردنظر]. ابتدا کد فعلی و این گزارش را بررسی کن، اثر تغییرها و معیار پذیرش را مشخص کن و سپس در محدوده اختیار اجرا و بازبینی کن. گزارش قبلی را حفظ کن و گزارش دور بعد را فارسی و انگلیسی بساز.` : `Continue job ${data.jobId} from report r${String(data.revision).padStart(3, '0')}. My requested changes: [item IDs and desired changes]. Inspect the current code and this report, identify impacts and acceptance criteria, then implement and review within agreed authority. Preserve the previous report and create the next revision in Persian and English.`;
}
function article(data, lang, at) {
  const l = labels[lang];
  const labels2 = lang === 'fa' ? { format: 'نسخه شواهد', snapshot: 'نسخه تحویلی', reviewer: 'بازبین', reviewed: 'نسخه بازبینی‌شده', checksReview: 'بررسی‌ها / بازبینی مستقل' } : { format: 'Evidence format', snapshot: 'Delivered snapshot', reviewer: 'Reviewer', reviewed: 'Reviewed snapshot', checksReview: 'Checks / independent review' };
  const allChecksPassed = data.evidence.length > 0 && data.evidence.every(e => e.status === 'passed');
  const reviewPending = ['pending', 'not-reviewed', 'self-review-only'].includes(data.reviewStatus);
  const checksReview = allChecksPassed && reviewPending ? (lang === 'fa' ? 'بررسی‌ها موفق؛ بازبینی مستقل در انتظار است.' : 'Checks passed; independent review pending.') : null;
  const metadata = [[l.status, status(data.technicalStatus, lang)], [l.release, status(data.releaseStatus, lang)], [l.review, status(data.reviewStatus, lang)], [l.code, data.codeVersion], [l.dirty, data.dirtyWorktree ? (lang === 'fa' ? 'بله؛ گزارش شامل تغییرات ثبت‌نشده است' : 'Yes; report includes uncommitted changes') : (lang === 'fa' ? 'خیر' : 'No')], [labels2.format, `v${data.evidenceVersion ?? 1}${(data.evidenceVersion ?? 1) === 1 ? (lang === 'fa' ? ' (قدیمی؛ بدون پیوند به نسخه)' : ' (legacy; unbound snapshot)') : ''}`]];
  if (checksReview) metadata.push([labels2.checksReview, checksReview]);
  if (data.evidenceVersion === 2) metadata.push([labels2.snapshot, `${data.snapshot.baseSha}..${data.snapshot.headSha} / sha256:${data.snapshot.diffSha256}`]);
  if (data.reviewEvidence) metadata.push([labels2.reviewer, data.reviewEvidence.reviewer], [labels2.reviewed, `${data.reviewEvidence.baseSha}..${data.reviewEvidence.headSha} / sha256:${data.reviewEvidence.diffSha256}`]);
  const requirements = data.requirements.map(r => `<tr><td><bdi>${escape(r.id)}</bdi></td><td>${escape(text(r.text, lang))}</td><td>${escape(status(r.status, lang))}</td><td>${escape(r.evidenceIds.join(', '))}</td></tr>`).join('');
  const evidence = data.evidence.map(e => `<li id="${lang}-${escape(e.id)}"><strong><bdi>${escape(e.id)}</bdi> · ${escape(text(e.label, lang))}</strong><span class="tag">${escape(status(e.status, lang))}</span><p>${escape(text(e.method, lang))}</p><pre>${escape(e.reference)}</pre></li>`).join('');
  const sections = SECTION_IDS.map((key, i) => `<section><h2>${headings[lang][i]}</h2><p class="prose">${escape(text(data.sections[key], lang))}</p></section>`).join('') + reviewFindings(data, lang);
  return `<article id="report-${lang}" lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}"><p class="eyebrow">${lang === 'fa' ? 'گزارش فنی · فارسی' : 'TECHNICAL REPORT · ENGLISH'}</p><h1>${escape(text(data.title, lang))}</h1><p class="subtitle">${escape(text(data.summary, lang))}</p><p class="meta"><bdi>${escape(data.jobId)} / r${String(data.revision).padStart(3, '0')} / ${escape(data.runId)} / ${at}</bdi></p><aside>${l.pending}</aside><dl>${metadata.map(([k, v]) => `<div><dt>${k}</dt><dd><bdi>${escape(v)}</bdi></dd></div>`).join('')}</dl><h2>${l.coverage}</h2>${coverage(data, lang)}<h2>${l.requirements}</h2><div class="table-wrap"><table><thead><tr>${(lang === 'fa' ? ['شناسه', 'نیازمندی', 'وضعیت', 'شواهد'] : ['ID', 'Requirement', 'Status', 'Evidence']).map(s => `<th>${s}</th>`).join('')}</tr></thead><tbody>${requirements}</tbody></table></div><h2>${l.diagram} · ${escape(status(data.diagram.kind, lang))}</h2><figure>${diagramSvg(data, lang)}<figcaption>${escape(text(data.diagram.caption, lang))}</figcaption></figure>${sections}<section><h2>${l.evidence}</h2><p class="note">${l.caution}</p><ul class="evidence">${evidence || `<li>${l.none}</li>`}</ul></section>${data.parent ? `<p><a href="../r${String(data.parent.revision).padStart(3, '0')}/report.html">${l.parent}: r${data.parent.revision}</a></p>` : ''}<section><h2>${l.resume}</h2><p class="prose">${escape(resume(data, lang))}</p></section></article>`;
}
export function renderHtml(data, at) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.title.en)} · Software Team</title><style>body{margin:0;background:#f4f6f2;color:#19372e;font:15px/1.8 system-ui,sans-serif}header{position:sticky;top:0;background:#183a30;color:white;padding:14px 5%;display:flex;justify-content:space-between;z-index:2}header a{color:white;margin-inline:12px}main{max-width:1040px;margin:auto;padding:32px 20px}article{background:white;border:1px solid #dce4dc;border-radius:12px;padding:36px;margin-bottom:36px;scroll-margin-top:80px}h1{font-size:30px;line-height:1.4;margin:8px 0}h2{font-size:19px;border-bottom:1px solid #e2e8df;padding-bottom:8px;margin-top:32px}.eyebrow,.meta,.note{font-size:12px;color:#536c60}.subtitle{font-size:17px}.prose{white-space:pre-wrap;overflow-wrap:anywhere}aside{background:#fff6df;border-inline-start:4px solid #96702a;padding:14px;margin:22px 0}dl,.coverage{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}dl>div,.coverage>div{border:1px solid #dde6dd;border-radius:7px;padding:12px}dt{font-size:12px;color:#536c60}dd{margin:0;overflow-wrap:anywhere}.coverage{grid-template-columns:repeat(4,minmax(0,1fr))}.coverage strong{display:block;font-size:28px}.coverage span{display:block;font-size:12px}meter{width:100%}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:start;vertical-align:top;border-bottom:1px solid #e0e7dc;padding:12px;overflow-wrap:anywhere}figure{margin:0}svg{display:block;width:100%;max-height:640px}figcaption{font-size:12px;color:#536c60}.evidence{padding-inline-start:22px}.evidence li{margin-bottom:20px}.tag{display:inline-block;font-size:11px;background:#edf3e9;padding:1px 8px;margin-inline:10px}pre{direction:ltr;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4ed;padding:12px;font-size:12px}a{color:#21654d}:focus-visible{outline:3px solid #bc8b2b;outline-offset:4px}@media(max-width:600px){article{padding:20px}main{padding:16px 10px}.coverage,dl{grid-template-columns:repeat(2,minmax(0,1fr))}header{font-size:12px}h1{font-size:24px}th,td{padding:8px}}@media print{header{position:static}article{break-before:page;border:0}body{background:white}}</style></head><body><header><strong>Software Team · r${String(data.revision).padStart(3, '0')}</strong><nav aria-label="Report language"><a href="#report-en" lang="en">English</a><a href="#report-fa" lang="fa">فارسی</a></nav></header><main>${article(data, 'en', at)}${article(data, 'fa', at)}</main></body></html>`;
}
function markdown(data, lang, at) {
  const l = labels[lang];
  const checksReview = data.evidence.length > 0 && data.evidence.every(e => e.status === 'passed') && ['pending', 'not-reviewed', 'self-review-only'].includes(data.reviewStatus);
  const pendingText = lang === 'fa' ? 'بررسی‌ها موفق؛ بازبینی مستقل در انتظار است.' : 'Checks passed; independent review pending.';
  const fields = lang === 'fa' ? { format: 'نسخه شواهد', snapshot: 'نسخه تحویلی', environment: 'محیط راستی‌آزمایی', reviewer: 'بازبین', reviewed: 'نسخه بازبینی‌شده', scope: 'دامنه بازبینی' } : { format: 'Evidence format', snapshot: 'Delivered snapshot', environment: 'Verification environment', reviewer: 'Reviewer', reviewed: 'Reviewed snapshot', scope: 'Review scope' };
  const format = `v${data.evidenceVersion ?? 1}${(data.evidenceVersion ?? 1) === 1 ? (lang === 'fa' ? ' (قدیمی؛ بدون پیوند به نسخه)' : ' (legacy; unbound snapshot)') : ''}`;
  const lines = [`# ${text(data.title, lang)}`, '', text(data.summary, lang), '', `${data.jobId} / r${String(data.revision).padStart(3, '0')} / ${data.runId} / ${at}`, '', `> ${l.pending}`, '', `- ${l.status}: ${status(data.technicalStatus, lang)}`, `- ${l.release}: ${status(data.releaseStatus, lang)}`, `- ${l.review}: ${status(data.reviewStatus, lang)}`, `- ${l.code}: ${data.codeVersion}`, `- ${l.dirty}: ${data.dirtyWorktree}`, `- ${fields.format}: ${format}`];
  if (checksReview) lines.push(`- ${pendingText}`);
  if (data.evidenceVersion === 2) lines.push(`- ${fields.snapshot}: ${data.snapshot.baseSha}..${data.snapshot.headSha} / sha256:${data.snapshot.diffSha256}`, `- ${fields.environment}: ${data.verificationEnvironment}`);
  if (data.reviewEvidence) lines.push(`- ${fields.reviewer}: ${data.reviewEvidence.reviewer}`, `- ${fields.reviewed}: ${data.reviewEvidence.baseSha}..${data.reviewEvidence.headSha} / sha256:${data.reviewEvidence.diffSha256}`, `- ${fields.scope}: ${data.reviewEvidence.scope}`);
  lines.push('', `## ${l.requirements}`, '');
  for (const r of data.requirements) lines.push(`- **${r.id}** — ${text(r.text, lang)} — ${status(r.status, lang)} — ${r.evidenceIds.join(', ') || '—'}`);
  lines.push('', `## ${l.diagram} · ${status(data.diagram.kind, lang)}`, '', `![${l.diagram}](diagram.${lang}.svg)`, '', text(data.diagram.caption, lang));
  SECTION_IDS.forEach((key, i) => lines.push('', `## ${headings[lang][i]}`, '', text(data.sections[key], lang)));
  if (data.reviewEvidence) {
    const review = reviewLabels[lang];
    lines.push('', `## ${review.findings}`, '', `- ${review.reviewer}: ${data.reviewEvidence.reviewer}`, `- ${review.scope}: ${data.reviewEvidence.scope}`, '');
    if (data.reviewEvidence.findings.length === 0) lines.push(review.none);
    else for (const f of data.reviewEvidence.findings) lines.push(`- **${f.id}** — ${review.severity}: ${status(f.severity, lang)} — ${review.disposition}: ${status(f.disposition, lang)} — ${text(f.summary, lang)}`);
  }
  lines.push('', `## ${l.evidence}`, '', l.caution, '');
  for (const e of data.evidence) lines.push(`- **${e.id}** — ${text(e.label, lang)} — ${status(e.status, lang)}`, `  - ${text(e.method, lang)}`, `  - ${e.reference}`);
  lines.push('', `## ${l.resume}`, '', resume(data, lang), '');
  return lines.join('\n');
}
function buildReport(input, { project, legacy = false }) {
  const data = legacy ? validateLegacyReport(input) : validateReport(input), at = new Date().toISOString();
  const projectRoot = realpathSync(resolve(project));
  function ensureDirectory(parent, name) {
    const path = join(parent, name);
    if (existsSync(path)) {
      const real = realpathSync(path);
      assert(real.startsWith(projectRoot + sep), 'Report directory must remain inside project');
      return real;
    }
    // Parent was resolved and checked before creating anything beneath it.
    mkdirSync(path);
    return realpathSync(path);
  }
  const docs = ensureDirectory(projectRoot, 'docs');
  const root = ensureDirectory(docs, 'team-reports');
  const job = ensureDirectory(root, data.jobId);
  assert(job.startsWith(root + sep), 'Report job must remain inside report root');
  const revision = `r${String(data.revision).padStart(3, '0')}`, target = join(job, revision);
  assert(!existsSync(target), 'Report revision already exists; create the next revision');
  if (data.parent) {
    const parentPath = join(job, `r${String(data.parent.revision).padStart(3, '0')}`, 'report.json');
    assert(realpathSync(parentPath).startsWith(root + sep), 'Parent report must remain inside report root');
    const parent = JSON.parse(readFileSync(parentPath, 'utf8'));
    validatePublishedReport(parent);
    assert(parent.jobId === data.jobId && parent.runId === data.parent.runId && parent.revision === data.parent.revision, 'Parent report identity mismatch');
  }
  const staging = mkdtempSync(join(job, '.report-'));
  try {
    const record = { ...data, evidenceVersion: data.evidenceVersion ?? 1, generatedAt: at, inputSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'), userAcceptance: 'pending' };
    const files = { 'report.json': JSON.stringify(record, null, 2) + '\n', 'report.html': renderHtml(data, at), 'report.en.md': markdown(data, 'en', at), 'report.fa.md': markdown(data, 'fa', at), 'diagram.en.svg': diagramSvg(data, 'en'), 'diagram.fa.svg': diagramSvg(data, 'fa') };
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(staging, name), contents);
    assert(!existsSync(target), 'Report revision already exists');
    renameSync(staging, target);
    return { directory: target, path: `/reports/${data.jobId}/${revision}/report.html`, generatedAt: at };
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}
export function generateReport(input, options) { return buildReport(input, options); }
export function generateLegacyReport(input, options) { return buildReport(input, { ...options, legacy: true }); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const legacy = process.argv.includes('--legacy-v1');
    const args = process.argv.slice(2).filter(arg => arg !== '--legacy-v1'), opts = {};
    for (let i = 0; i < args.length; i += 2) { assert(args[i]?.startsWith('--') && args[i + 1], 'Expected --input file --project directory'); opts[args[i].slice(2)] = args[i + 1]; }
    assert(opts.input && opts.project, 'Both --input and --project are required');
    const generate = legacy ? generateLegacyReport : generateReport;
    console.log(JSON.stringify(generate(JSON.parse(readFileSync(resolve(opts.input), 'utf8')), { project: opts.project })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
