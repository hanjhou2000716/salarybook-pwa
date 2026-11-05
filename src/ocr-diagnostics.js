const HIDDEN_MARKS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const groupedInteger = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;

export function fieldKey(group, name) {
  return `${encodeURIComponent(group)}:${encodeURIComponent(name)}`;
}

export function normalizeNumericCell(raw, {allowDecimal = false} = {}) {
  const original = String(raw ?? '');
  let normalized = original.normalize('NFKC').replace(HIDDEN_MARKS, '').trim();
  normalized = normalized.replace(/^(?:NT\$|US\$|\$|NTD|TWD)\s*/i, '').replace(/\s*(?:元|NTD|TWD)$/i, '');
  normalized = normalized.replace(/\s+/g, '');
  if (!normalized) return {raw: original, normalized, value: null, status: 'empty', reason: 'NO_TEXT'};

  const integer = normalized.replace(/^\$/, '');
  if (groupedInteger.test(integer)) {
    const value = Number(integer.replaceAll(',', ''));
    if (Number.isSafeInteger(value) && value >= 0) return {raw: original, normalized: integer, value, status: 'parsed', reason: null};
    return {raw: original, normalized: integer, value: null, status: 'invalid', reason: 'OUT_OF_RANGE'};
  }
  if (allowDecimal) {
    const decimal = integer.match(/^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{1,2})$/);
    if (decimal) {
      const value = Number(`${decimal[1].replaceAll(',', '')}.${decimal[2]}`);
      if (Number.isFinite(value) && value >= 0) return {raw: original, normalized: integer, value, status: 'parsed', reason: null};
    }
  } else {
    const zeroDecimal = integer.match(/^(\d{1,3}(?:,\d{3})*|\d+)\.0+$/);
    if (zeroDecimal) {
      const value = Number(zeroDecimal[1].replaceAll(',', ''));
      if (Number.isSafeInteger(value)) return {raw: original, normalized: integer, value, status: 'parsed', reason: null};
    }
  }
  const ambiguous = /^\d{1,3}(?:\.\d{3})+$/.test(integer);
  return {raw: original, normalized: integer, value: null, status: ambiguous ? 'ambiguous' : 'invalid', reason: ambiguous ? 'AMBIGUOUS_SEPARATOR' : 'INVALID_NUMERIC_CELL'};
}

export function makeOcrJob({buildId, mode, pages = []}) {
  return {
    id: crypto.randomUUID(), buildId, mode, startedAt: performance.now(), stage: 'read',
    stages: {}, pages: pages.map((p, index) => ({page: index + 1, pageId: p.pageId || crypto.randomUUID(), width: p.width || 0, height: p.height || 0})),
    fields: [], errorCode: null,
  };
}

export function traceField(job, {group, name, page, pageId, rect, raw, normalized, value, confidence, status, reason}) {
  job.fields.push({key: fieldKey(group, name), group, name, page, pageId:pageId||job.pages[page-1]?.pageId||null, rect: rect ? rect.map(Math.round) : null,
    raw: String(raw ?? ''), normalized: String(normalized ?? ''), value: Number.isFinite(value) ? value : null,
    confidence: Number.isFinite(confidence) ? Math.round(confidence) : null, status, reason: reason || null});
}

export function summarizeOcrJob(job) {
  const counts = {total: job.fields.length, parsed: 0, needsReview: 0, empty: 0, invalid: 0, ambiguous: 0};
  for (const field of job.fields) {
    if (field.status === 'parsed') counts.parsed++;
    else if (field.status === 'needsReview') counts.needsReview++;
    else if (field.status === 'empty') counts.empty++;
    else if (field.status === 'ambiguous') counts.ambiguous++;
    else if (field.status === 'invalid') counts.invalid++;
    else counts.empty++;
  }
  return {id: job.id, buildId: job.buildId, mode: job.mode, stage: job.stage, errorCode: job.errorCode,
    durationMs: Math.round(performance.now() - job.startedAt), stageDurationsMs: {...job.stages}, pageCount: job.pages.length,
    pageSizes: job.pages.map(({width, height}) => ({width, height})), counts,
    // Deliberately omit all OCR strings, numbers, item labels, file names, and images.
  };
}

export function classifyOcrRecord(record) {
  const money = record.items.filter(i => ['income', 'deductions'].includes(i.group) && i.state !== 'unprovided');
  const providedTotals = ['gross', 'deduction', 'net', 'employerPension'].map(k => record.totals[k]);
  const numericItems = money.filter(i => Number.isSafeInteger(i.value) && i.value >= 0);
  const numericTotals = providedTotals.filter(v => Number.isSafeInteger(v) && v >= 0);
  const validValues = numericItems.length + numericTotals.length;
  const missing = money.filter(i => !Number.isSafeInteger(i.value)).length + providedTotals.filter(v => !Number.isSafeInteger(v)).length;
  return {status: validValues === 0 ? 'failed' : missing ? 'partial' : 'review', recognized: numericItems.length + numericTotals.length,
    missing, candidates: numericItems.filter(i => i.state === 'unknown').length};
}
