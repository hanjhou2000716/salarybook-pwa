import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRecord} from '../src/core.js';
import {parseOCR} from '../src/ocr.js';
import {classifyOcrRecord,fieldKey,makeOcrJob,normalizeNumericCell,summarizeOcrJob,traceField} from '../src/ocr-diagnostics.js';

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

test('field keys keep duplicate names in separate categories',()=>{
  assert.notEqual(fieldKey('income','本薪'),fieldKey('absence','本薪'));
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
  assert.equal(salary.value,12345);assert.equal(salary.ocrValue,12345);assert.equal(salary.sourcePage,1);assert.equal(salary.ocrStatus,'PARSED');
  assert.equal(record.totals.gross,12345);assert.equal(record.ocrMeta.fields[fieldKey('totals','gross')].ocrValue,12345);
});

test('generic OCR retains conflicting reads as a reviewable candidate',()=>{
  const record=parseOCR([
    {text:'本薪: 12,345',confidence:70,sourcePage:1,pageId:'source-a'},
    {text:'本薪: 98,765',confidence:92,sourcePage:2,pageId:'source-b'},
  ]);
  const salary=record.items.find(i=>i.group==='income'&&i.name==='本薪');
  assert.equal(salary.value,98765);assert.equal(salary.state,'unknown');assert.equal(salary.ocrStatus,'AMBIGUOUS');assert.equal(salary.ocrReason,'CONFLICTING_READS');
});
