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

const isHanOrLatin = value => /[\p{Script=Han}A-Za-z]/u.test(value || '');
const emptyNumericResult = () => ({raw:'',normalized:'',value:null,status:'empty',reason:'NO_TEXT'});

export function extractAmountAfterLabel(input, names, {allowDecimal = false} = {}) {
  const aliases = [...new Set((Array.isArray(names) ? names : [names]).map(String).filter(Boolean))]
    .sort((a,b)=>b.length-a.length);
  const lines = Array.isArray(input) ? input : String(input||'').split(/\r?\n/);
  for (const originalLine of lines) {
    const sourceText=typeof originalLine==='string'?originalLine:originalLine?.text||'';
    const line=String(sourceText).normalize('NFKC').replace(HIDDEN_MARKS,'').replace(/[＊*]/g,'');
    for (const alias of aliases) {
      const label=alias.normalize('NFKC');let start=0;
      while ((start=line.indexOf(label,start))!==-1) {
        const before=line[start-1]||'';
        if (isHanOrLatin(before)) { start+=label.length; continue; }
        let tail=line.slice(start+label.length).replace(/^\s*[（(][^）)]{0,48}[）)]\s*/,'').replace(/^\s*[:：=]?\s*/,'');
        if (isHanOrLatin(tail[0])) { start+=label.length; continue; }
        const match=tail.match(/^[$＄]?\s*\+?\s*\d[\d,，.]*\s*(?:元)?/);
        if (!match) { start+=label.length; continue; }
        const parsed=normalizeNumericCell(match[0],{allowDecimal});
        return {...parsed,raw:match[0].trim(),sourceRect:originalLine?.bbox||null};
      }
    }
  }
  return emptyNumericResult();
}

function sameFieldValue(a,b) {
  if (a===null||a===undefined||a==='') return b===null||b===undefined||b==='';
  if (b===null||b===undefined||b==='') return false;
  const left=Number(a),right=Number(b);
  if (Number.isFinite(left)&&Number.isFinite(right)) return left===right;
  return String(a)===String(b);
}

export function checkFieldBinding({candidate=null,modelValue=null,formValue='',userEdited=false}={}) {
  const modelMatchesForm=sameFieldValue(modelValue,formValue);
  const candidateMatchesModel=candidate===null||candidate===undefined||userEdited||sameFieldValue(candidate,modelValue);
  return {mismatch:!modelMatchesForm||!candidateMatchesModel,modelMatchesForm,candidateMatchesModel};
}

export function selectOcrCandidate(attempts, {trustThreshold = 85, requiredAgreement = 2} = {}) {
  const valid = attempts.filter(item => item?.status === 'parsed' && Number.isFinite(item.value) && item.value >= 0);
  const distinct = [...new Set(valid.map(item => item.value))];
  if (distinct.length) {
    const support = new Map();for(const item of valid){const row=support.get(item.value)||{count:0,confidence:-1,item};row.count++;if((item.confidence??-1)>row.confidence){row.confidence=item.confidence??-1;row.item=item;}support.set(item.value,row);}
    const chosen = [...support.values()].reduce((best,row)=>row.count>best.count||row.count===best.count&&row.confidence>best.confidence?row:best).item;
    const conflict = distinct.length > 1;
    const autoTrusted = !conflict && valid.length >= requiredAgreement &&
      valid.every(item => Number.isFinite(item.confidence) && item.confidence >= trustThreshold);
    return {...chosen, status: conflict ? 'ambiguous' : autoTrusted ? 'parsed' : 'needsReview',
      reason: conflict ? 'CONFLICTING_READS' : autoTrusted ? null : 'INSUFFICIENT_INDEPENDENT_CONFIDENCE',
      candidates: distinct, autoTrusted};
  }
  const best = attempts.reduce((a, b) => (b?.confidence ?? -1) > (a?.confidence ?? -1) ? b : a,
    {value:null,status:'empty',confidence:0,reason:'NO_TEXT'});
  return {...best, value:null, autoTrusted:false, candidates:[], reason:best.reason || 'NO_VALID_NUMERIC_CANDIDATE'};
}

export function otsuThreshold(histogram) {
  if (!Array.isArray(histogram) && !(histogram instanceof Uint32Array)) throw new TypeError('histogram must be a 256-bin array');
  if (histogram.length !== 256) throw new RangeError('histogram must contain 256 bins');
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (!total) return 127;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, bestThreshold = 127;
  for (let threshold = 0; threshold < 255; threshold++) {
    backgroundWeight += histogram[threshold];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += threshold * histogram[threshold];
    const meanBackground = backgroundSum / backgroundWeight;
    const meanForeground = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) { bestVariance = variance; bestThreshold = threshold; }
  }
  return bestThreshold;
}

export function detectSingleZeroGlyph(mask,width,height){
  if(!(mask instanceof Uint8Array)||mask.length!==width*height||width<8||height<12)return false;
  const seen=new Uint8Array(mask.length),components=[];
  for(let start=0;start<mask.length;start++)if(mask[start]&&!seen[start]){
    const queue=[start];seen[start]=1;let minX=width,minY=height,maxX=-1,maxY=-1,area=0;
    for(let q=0;q<queue.length;q++){const at=queue[q],x=at%width,y=Math.floor(at/width);area++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){const next=yy*width+xx;if(mask[next]&&!seen[next]){seen[next]=1;queue.push(next);}}}
    if(area>=6)components.push({minX,maxX,minY,maxY,area});
  }
  if(!components.length)return false;
  components.sort((a,b)=>b.area-a.area);const c=components[0];
  if(components.slice(1).some(other=>other.area>=Math.max(8,c.area*.06)))return false;
  const w=c.maxX-c.minX+1,h=c.maxY-c.minY+1,ratio=w/h,fill=c.area/(w*h);
  if(c.minX<2||c.minY<2||c.maxX>width-3||c.maxY>height-3||w<5||h<12||ratio<.3||ratio>.82||fill<.12||fill>.68)return false;
  const bw=w+2,bh=h+2,background=new Uint8Array(bw*bh),outside=new Uint8Array(bw*bh),queue=[];
  for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){const sx=c.minX+x-1,sy=c.minY+y-1,ink=sx>=0&&sy>=0&&sx<width&&sy<height&&mask[sy*width+sx];background[y*bw+x]=ink?0:1;if((x===0||y===0||x===bw-1||y===bh-1)&&!ink){const at=y*bw+x;outside[at]=1;queue.push(at);}}
  for(let q=0;q<queue.length;q++){const at=queue[q],x=at%bw,y=Math.floor(at/bw);for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(xx>=0&&yy>=0&&xx<bw&&yy<bh){const next=yy*bw+xx;if(background[next]&&!outside[next]){outside[next]=1;queue.push(next);}}}
  let holes=0,holeArea=0,holeX=0,holeY=0;
  for(let start=0;start<background.length;start++)if(background[start]&&!outside[start]){holes++;const local=[start];outside[start]=1;let area=0,sx=0,sy=0;for(let q=0;q<local.length;q++){const at=local[q],x=at%bw,y=Math.floor(at/bw);area++;sx+=x;sy+=y;for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(xx>=0&&yy>=0&&xx<bw&&yy<bh){const next=yy*bw+xx;if(background[next]&&!outside[next]){outside[next]=1;local.push(next);}}}if(area>holeArea){holeArea=area;holeX=sx/area;holeY=sy/area;}}
  let centerInk=0,centerPixels=0;for(let y=Math.round(c.minY+h*.35);y<Math.round(c.minY+h*.65);y++)for(let x=Math.round(c.minX+w*.35);x<Math.round(c.minX+w*.65);x++){centerPixels++;if(mask[y*width+x])centerInk++;}
  const centeredHole=holes===1&&holeArea/(w*h)>=.035&&holeArea/(w*h)<=.36&&holeX/bw>=.32&&holeX/bw<=.68&&holeY/bh>=.34&&holeY/bh<=.66;
  const faintlyOpenZero=(holes===0||holes===1)&&centerPixels>0&&centerInk/centerPixels<.24;
  return centeredHole||faintlyOpenZero;
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
