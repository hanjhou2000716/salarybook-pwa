const PALETTE = ['#155c50', '#5d8f7c', '#d0aa4c', '#7898ae', '#c87a5e', '#8c9b65'];
const COLORS = { '本薪': '#155c50', '實領': '#155c50', '扣款': '#c8755a', '另已發暫支薪': '#d2a844' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const colorFor = (name, index) => COLORS[name] || PALETTE[index % PALETTE.length];
const pct = (amount, total) => total ? `${(amount / total * 100).toFixed(1)}%` : '0.0%';

export function renderComposition(result, { title = '應發總額', activeIndex = 0 } = {}) {
  if (!result.ok) return `<div class="chart-empty"><span class="chart-empty-icon" aria-hidden="true">!</span><p>${escape(result.reason)}</p><a href="#history">前往薪資紀錄核對 →</a></div>`;
  if (!result.slices.length) return `<div class="chart-empty"><p>${escape(result.reason || '目前沒有可呈現的薪資項目。')}</p></div>`;
  const radius = 76, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const sectors = result.slices.map((slice, index) => {
    const length = circumference * slice.amount / result.total;
    const circle = `<circle class="donut-sector ${index === activeIndex ? 'is-active' : ''}" cx="100" cy="100" r="${radius}" fill="none" stroke="${colorFor(slice.name, index)}" stroke-width="34" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" data-slice="${index}" tabindex="0" role="button" aria-label="${escape(slice.name)} ${slice.amount.toLocaleString('zh-TW')} 元，${pct(slice.amount, result.total)}"><title>${escape(slice.name)}：${slice.amount.toLocaleString('zh-TW')} 元（${pct(slice.amount, result.total)}）</title></circle>`;
    offset += length;
    return circle;
  }).join('');
  const legend = result.slices.map((slice, index) => `<div class="donut-legend-item"><button class="donut-legend ${index === activeIndex ? 'is-active' : ''}" type="button" data-slice="${index}" aria-pressed="${index === activeIndex}"><span class="legend-swatch" style="background:${colorFor(slice.name, index)}" aria-hidden="true"></span><span class="legend-name">${escape(slice.name)}</span><b>${slice.amount.toLocaleString('zh-TW')}</b><span class="legend-percent">${pct(slice.amount, result.total)}</span></button>${slice.details ? `<details class="legend-details"><summary>查看「其他」細項</summary>${slice.details.map(item => `<div class="legend-detail"><span>${escape(item.name)}</span><b>${item.amount.toLocaleString('zh-TW')} 元</b></div>`).join('')}</details>` : ''}</div>`).join('');
  return `<div class="donut-layout"><div class="donut-visual"><svg class="donut-svg" viewBox="0 0 200 200" role="img" aria-label="${escape(title)} ${result.total.toLocaleString('zh-TW')} 元組成">${sectors}<text class="donut-center-label" x="100" y="93">${escape(title)}</text><text class="donut-center-value" x="100" y="116">${result.total.toLocaleString('zh-TW')}</text></svg><span class="chart-unit">新臺幣元</span></div><div class="donut-legend-list">${legend}</div></div>`;
}

export function renderSeriesLegend(includeDeduction = true, active = new Set(['gross', 'net'])) {
  const entries = [['gross', '應發'], ['net', '實領'], ...(includeDeduction ? [['deduction', '扣款']] : [])];
  return entries.map(([key, label]) => `<button type="button" class="series-toggle ${active.has(key) ? 'is-active' : ''}" data-series-toggle="${key}" aria-pressed="${active.has(key)}"><span class="series-dot series-${key}" aria-hidden="true"></span>${label}</button>`).join('');
}

export function renderLineChart(rows, active = new Set(['gross', 'net']), selectedMonth = '') {
  const width = Math.max(760, rows.length * 70 + 104), height = 320;
  const pad = { left: 70, right: 24, top: 26, bottom: 55 };
  const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
  const keys = ['gross', 'net', 'deduction'].filter(key => active.has(key));
  const values = rows.flatMap(row => keys.map(key => row[key]).filter(Number.isSafeInteger));
  const max = Math.max(1, ...values), step = plotWidth / Math.max(1, rows.length - 1);
  const x = index => pad.left + index * step;
  const y = value => pad.top + plotHeight - value / max * plotHeight;
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = Math.round(max * i / 4), yy = y(value);
    return `<g class="chart-grid"><line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}"/><text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end">${value.toLocaleString('zh-TW')}</text></g>`;
  }).join('');
  const labels = rows.map((row, index) => `<text class="chart-month-label" x="${x(index)}" y="${height - 18}" text-anchor="middle">${escape(row.month.slice(2))}</text>`).join('');
  const strokes = keys.map(key => {
    let path = '', drawing = false;
    rows.forEach((row, index) => {
      const value = row[key];
      if (!Number.isSafeInteger(value)) { drawing = false; return; }
      path += `${drawing ? 'L' : 'M'} ${x(index)} ${y(value)} `;
      drawing = true;
    });
    const points = rows.map((row, index) => Number.isSafeInteger(row[key]) ? `<circle class="series-point series-${key} ${row.month === selectedMonth ? 'is-selected' : ''}" cx="${x(index)}" cy="${y(row[key])}" r="5" data-chart-month="${escape(row.month)}" data-chart-series="${key}" tabindex="0" role="button" aria-label="${escape(row.month)} ${key === 'gross' ? '應發' : key === 'net' ? '實領' : '扣款'} ${row[key].toLocaleString('zh-TW')} 元"><title>${escape(row.month)} · ${key === 'gross' ? '應發' : key === 'net' ? '實領' : '扣款'} ${row[key].toLocaleString('zh-TW')} 元</title></circle>` : '').join('');
    return `<path class="series-line series-${key}" d="${path}"/>${points}`;
  }).join('');
  const accessibility = keys.map(key => `${key === 'gross' ? '應發' : key === 'net' ? '實領' : '扣款'}折線`).join('、') || '尚未選擇圖表項目';
  return `<div class="line-scroll"><svg class="line-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="薪資趨勢，${accessibility}">${grid}${strokes}${labels}</svg></div>`;
}
