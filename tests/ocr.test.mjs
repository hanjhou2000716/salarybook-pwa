import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRecord} from '../src/core.js';
import {flattenOcrLines,parseOCR} from '../src/ocr.js';
import {classifyOcrRecord,fieldKey,makeOcrJob,normalizeNumericCell,otsuThreshold,selectOcrCandidate,summarizeOcrJob,traceField,extractAmountAfterLabel,checkFieldBinding,detectSingleZeroGlyph} from '../src/ocr-diagnostics.js';

test('normalizes full width digits, grouping, currency and invisible marks',()=>{
  const result=normalizeNumericCell('ＮＴ＄３４，５６７\u200b');
  assert.equal(result.status,'parsed');assert.equal(result.value,34567);
  assert.equal(normalizeNumericCell('$2,480').value,2480);
});

test('preserves zero and does not invent a value for blank or invalid cells',()=>{
  assert.equal(normalizeNumericCell('0').value,0);
  assert.equal(normalizeNumericCell('').status,'empty');
  assert.equal(normalizeNumericCell('12,5').status,'invalid');
  assert.equal(normalizeNumericCell('1.234').status,'ambiguous');
  assert.equal(normalizeNumericCell('9007199254740992').reason,'OUT_OF_RANGE');
});

test('supports attendance decimals only when requested',()=>{
  assert.equal(normalizeNumericCell('1.5').status,'invalid');
  assert.equal(normalizeNumericCell('1.5',{allowDecimal:true}).value,1.5);
});

test('an empty high-confidence attempt cannot discard a valid lower-confidence amount',()=>{
  const selected=selectOcrCandidate([
    {value:null,status:'invalid',confidence:96,reason:'INVALID_NUMERIC_CELL'},
    {value:47382,status:'parsed',confidence:71,reason:null},
  ]);
  assert.equal(selected.value,47382);
  assert.equal(selected.status,'needsReview');
  assert.equal(selected.autoTrusted,false);
});

test('two agreeing high-confidence values can be trusted when other passes are empty',()=>{
  const selected=selectOcrCandidate([
    {value:null,status:'empty',confidence:98,reason:'NO_TEXT'},
    {value:47382,status:'parsed',confidence:91},
    {value:null,status:'empty',confidence:98,reason:'NO_TEXT'},
    {value:47382,status:'parsed',confidence:89},
  ]);
  assert.equal(selected.value,47382);
  assert.equal(selected.status,'parsed');
  assert.equal(selected.autoTrusted,true);
});

test('a single faint-recovery zero stays a reviewable candidate and is never auto-trusted',()=>{
  const selected=selectOcrCandidate([{value:0,status:'parsed',confidence:64,reason:null}]);
  assert.equal(selected.value,0);
  assert.equal(selected.status,'needsReview');
  assert.equal(selected.autoTrusted,false);
});

test('conflicting valid attempts remain visible and cannot be auto-trusted',()=>{
  const selected=selectOcrCandidate([
    {value:47382,status:'parsed',confidence:93},
    {value:47384,status:'parsed',confidence:94},
  ]);
  assert.equal(selected.value,47384);
  assert.equal(selected.status,'ambiguous');
  assert.deepEqual(selected.candidates,[47382,47384]);
  assert.equal(selected.autoTrusted,false);
});

test('a repeated valid amount outranks a single higher-confidence outlier without hiding the conflict',()=>{
  const selected=selectOcrCandidate([
    {value:1740,status:'parsed',confidence:73},
    {value:1740,status:'parsed',confidence:71},
    {value:1748,status:'parsed',confidence:68},
    {value:1840,status:'parsed',confidence:96},
  ]);
  assert.equal(selected.value,1740);
  assert.equal(selected.status,'ambiguous');
  assert.deepEqual(selected.candidates,[1740,1748,1840]);
  assert.equal(selected.autoTrusted,false);
});

test('Otsu threshold is independent of pixel scan order',()=>{
  const histogram=new Uint32Array(256);histogram[24]=40;histogram[32]=10;histogram[218]=12;histogram[244]=38;
  const expected=otsuThreshold(histogram);
  assert.ok(expected>=32&&expected<218);
  assert.equal(otsuThreshold(histogram),expected);
});

test('a contour fallback can surface an isolated printed zero but rejects blanks and two-hole glyphs',()=>{
  const width=80,height=100,ring=(holes=1,offset=0)=>{const mask=new Uint8Array(width*height),cx=40,cy=50;for(let y=12;y<88;y++)for(let x=20;x<60;x++){const outer=((x-cx)/19)**2+((y-cy)/37)**2<=1;let inner=false;for(let n=0;n<holes;n++){const hx=holes===1?cx:cx+(n===0?-7:7),hy=holes===1?cy:cy+(n===0?-17:17);if(((x-hx)/6)**2+((y-hy)/12)**2<=1)inner=true;}if(outer&&!inner)mask[y*width+x]=1;}return mask;};
  assert.equal(detectSingleZeroGlyph(ring(),width,height),true);
  assert.equal(detectSingleZeroGlyph(ring(2),width,height),false);
  const dust=ring();for(let x=3;x<13;x++)dust[5*width+x]=1;assert.equal(detectSingleZeroGlyph(dust,width,height),true);
  const secondGlyph=ring();for(let y=2;y<16;y++)for(let x=2;x<16;x++)secondGlyph[y*width+x]=1;assert.equal(detectSingleZeroGlyph(secondGlyph,width,height),false);
  assert.equal(detectSingleZeroGlyph(new Uint8Array(width*height),width,height),false);
});

test('field keys keep duplicate names in separate categories',()=>{
  assert.notEqual(fieldKey('income','本薪'),fieldKey('absence','本薪'));
});

test('label matching rejects Chinese substrings and only accepts a complete numeric token',()=>{
  assert.equal(extractAmountAfterLabel('扣薪項目 本薪減項 88','本薪').status,'empty');
  assert.equal(extractAmountAfterLabel('夜點費 100','點心代金').status,'empty');
  assert.equal(extractAmountAfterLabel('本薪（示例公司：月薪） 52,106','本薪').value,52106);
  assert.equal(extractAmountAfterLabel('交通津貼 1,2x0','交通津貼').status,'invalid');
});

test('candidate, draft and rendered field values must agree unless the user edited the field',()=>{
  assert.equal(checkFieldBinding({candidate:100,modelValue:100,formValue:'100'}).mismatch,false);
  assert.equal(checkFieldBinding({candidate:100,modelValue:100,formValue:''}).mismatch,true);
  assert.equal(checkFieldBinding({candidate:100,modelValue:90,formValue:'90'}).mismatch,true);
  assert.equal(checkFieldBinding({candidate:100,modelValue:90,formValue:'90',userEdited:true}).mismatch,false);
  assert.equal(checkFieldBinding({candidate:null,modelValue:null,formValue:''}).mismatch,false);
});

test('diagnostic summary excludes raw OCR and candidate amounts',()=>{
  const job=makeOcrJob({buildId:'test',mode:'template',pages:[{width:691,height:1536}]});
  traceField(job,{group:'income',name:'本薪',page:1,raw:'本薪: 48732',normalized:'48732',value:48732,confidence:90,status:'parsed'});
  traceField(job,{group:'income',name:'交通津貼',page:1,raw:'交通津貼: ',normalized:'',value:null,confidence:0,status:'empty'});
  assert.equal(job.fields[0].name,'本薪');assert.ok(job.fields[0].key);assert.equal(job.fields[0].pageId,job.pages[0].pageId);
  const summary=summarizeOcrJob(job),serialized=JSON.stringify(summary);
  assert.equal(summary.counts.parsed,1);assert.equal(summary.counts.empty,1);
  assert.doesNotMatch(serialized,/48732|交通津貼|本薪|raw|normalized/);
});

test('classifies an empty OCR record as failed and keeps low confidence candidates countable',()=>{
  const empty=blankRecord();assert.equal(classifyOcrRecord(empty).status,'failed');
  const partial=blankRecord(),salary=partial.items.find(i=>i.group==='income'&&i.name==='本薪');
  salary.value=45678;salary.ocrValue=45678;salary.state='unknown';partial.totals.gross=51890;
  const result=classifyOcrRecord(partial);assert.equal(result.status,'partial');assert.equal(result.recognized,2);assert.equal(result.candidates,1);
});

test('generic OCR preserves a prior candidate and its page when a later page is empty',()=>{
  const record=parseOCR([
    {text:'本薪: 12,345\n合計應發金額: 12,345',confidence:91,sourcePage:1,pageId:'source-a'},
    {text:'',confidence:0,sourcePage:2,pageId:'source-b'},
  ]);
  const salary=record.items.find(i=>i.group==='income'&&i.name==='本薪');
  assert.equal(salary.value,12345);assert.equal(salary.ocrValue,12345);assert.equal(salary.sourcePage,1);assert.equal(salary.ocrStatus,'NEEDS_REVIEW');assert.equal(salary.state,'unknown');
  assert.equal(record.totals.gross,12345);assert.equal(record.ocrMeta.fields[fieldKey('totals','gross')].ocrValue,12345);
});

test('generic OCR retains conflicting reads as a reviewable candidate',()=>{
  const record=parseOCR([
    {text:'本薪: 12,345',confidence:70,sourcePage:1,pageId:'source-a'},
    {text:'本薪: 98,765',confidence:92,sourcePage:2,pageId:'source-b'},
  ]);
  const salary=record.items.find(i=>i.group==='income'&&i.name==='本薪');
  assert.equal(salary.value,98765);assert.equal(salary.state,'unknown');assert.equal(salary.ocrStatus,'AMBIGUOUS');assert.equal(salary.ocrReason,'CONFLICTING_READS');assert.deepEqual(salary.ocrCandidates,[12345,98765]);
});

test('generic OCR uses spatial line blocks and exposes the source region for review',()=>{
  const bbox={x0:300,y0:40,x1:470,y1:62};
  const lines=flattenOcrLines([{confidence:88,paragraphs:[{confidence:90,lines:[{text:'本薪 12,345',bbox,confidence:94,words:[{text:'本薪',bbox:{x0:300,y0:40,x1:340,y1:62},confidence:95},{text:'12,345',bbox:{x0:400,y0:40,x1:470,y1:62},confidence:93}]}]}]}]);
  const record=parseOCR([{text:'本薪 12,345',lines,confidence:30,sourcePage:2,pageId:'page-two'}]);
  const salary=record.items.find(i=>i.group==='income'&&i.name==='本薪');
  assert.equal(salary.value,12345);assert.equal(salary.sourcePageId,'page-two');assert.deepEqual(salary.sourceRect,bbox);
  assert.deepEqual(record.ocrMeta.fields[fieldKey('income','本薪')].sourceRect,bbox);
});
