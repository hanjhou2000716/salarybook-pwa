const validMoney = value => Number.isSafeInteger(value) && value >= 0;
const add = (map, key, value) => map.set(key, (map.get(key) || 0) + value);

/** Build verified ring-chart slices from all confirmed records in a month. */
export function getComposition(records, month, mode = 'income', limit = 5) {
  const entries = records.filter(r => r.confirmed && r.month === month);
  if (!entries.length) return { ok: false, reason: '沒有已確認的薪資紀錄。', total: null, slices: [] };

  if (mode === 'income') {
    const amounts = new Map();
    let listed = 0;
    for (const record of entries) {
      const rows = record.items.filter(item => item.group === 'income' && item.state !== 'unprovided');
      if (!validMoney(record.totals?.gross) || rows.some(item => item.state !== 'value' || !validMoney(item.value))) {
        return { ok: false, reason: '收入明細仍有待確認項目，請先核對薪資紀錄。', total: null, slices: [] };
      }
      const sum = rows.reduce((total, item) => total + item.value, 0);
      if (sum !== record.totals.gross) return { ok: false, reason: `收入明細與應發總額相差 ${sum - record.totals.gross} 元，請先核對。`, total: null, slices: [] };
      listed += record.totals.gross;
      for (const item of rows) if (item.value > 0) add(amounts, item.name, item.value);
    }
    const all = [...amounts].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh-Hant'));
    if (!listed) return { ok: true, reason: '本月應發總額為 0 元。', total: 0, slices: [] };
    const primary = all.slice(0, Math.max(1, limit));
    const rest = all.slice(Math.max(1, limit));
    if (rest.length) primary.push({ name: '其他', amount: rest.reduce((sum, item) => sum + item.amount, 0), details: rest });
    return { ok: true, reason: '', total: listed, slices: primary };
  }

  if (mode === 'cashflow') {
    const totals = { net: 0, deduction: 0, advance: 0 };
    for (const record of entries) {
      const { gross, net, deduction, advance } = record.totals || {};
      if (![gross, net, deduction, advance].every(validMoney)) return { ok: false, reason: '實領、扣款或暫支金額未填完整。', total: null, slices: [] };
      if (gross !== net + deduction + advance) return { ok: false, reason: `應發與實際分配相差 ${gross - net - deduction - advance} 元，請先核對。`, total: null, slices: [] };
      for (const key of Object.keys(totals)) totals[key] += record.totals[key];
    }
    const slices = [
      { name: '實領', amount: totals.net },
      { name: '扣款', amount: totals.deduction },
      { name: '另已發暫支薪', amount: totals.advance },
    ].filter(item => item.amount > 0);
    return { ok: true, reason: totals.net + totals.deduction + totals.advance === 0 ? '本月應發總額為 0 元。' : '', total: totals.net + totals.deduction + totals.advance, slices };
  }
  throw new Error(`Unknown composition mode: ${mode}`);
}

/** Fill calendar gaps with nulls so SVG lines break instead of implying zero pay. */
export function getMonthlySeries(records, { year = '', company = '', includeDeduction = false } = {}) {
  const selected = records.filter(r => r.confirmed && (!company || r.company === company) && (!year || r.month.startsWith(`${year}-`)));
  if (!selected.length) return [];
  const grouped = new Map();
  for (const record of selected) {
    let bucket = grouped.get(record.month);
    if (!bucket) grouped.set(record.month, bucket = { month: record.month, records: [] });
    bucket.records.push(record);
  }
  const keys = ['gross', 'net', ...(includeDeduction ? ['deduction'] : [])];
  for (const bucket of grouped.values()) {
    for (const key of keys) {
      const values = bucket.records.map(r => r.totals?.[key]);
      bucket[key] = values.every(validMoney) ? values.reduce((sum, value) => sum + value, 0) : null;
    }
  }

  let first, last;
  if (year) {
    first = `${year}-01`;
    last = `${year}-12`;
  } else {
    const months = [...grouped.keys()].sort();
    first = months[0];
    last = months.at(-1);
  }
  const result = [];
  for (let month = first; month <= last; month = nextMonth(month)) {
    const bucket = grouped.get(month);
    const row = { month };
    for (const key of keys) row[key] = bucket?.[key] ?? null;
    result.push(row);
  }
  return result;
}

function nextMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

export const CHART_LABELS = Object.freeze({ gross: '應發', net: '實領', deduction: '扣款' });
