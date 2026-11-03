import test from 'node:test';
import assert from 'node:assert/strict';
import { getComposition, getMonthlySeries } from '../src/charts.js';

const record = ({month, gross, net, deduction, advance=0, company='示範公司', type='月薪', items=[], pension=0}) => ({
  confirmed:true, month, company, type,
  totals:{gross, net, deduction, advance, employerPension:pension},
  items:items.map(([name,value,state='value'])=>({name,value,state,group:'income'})),
});

test('composition aggregates same-month payments and keeps pension outside both rings',()=>{
  const rows=[
    record({month:'2025-06',gross:10000,net:9000,deduction:1000,pension:700,items:[['本薪',8000],['交通津貼',1000],['伙食津貼',1000]]}),
    record({month:'2025-06',gross:5000,net:4500,deduction:500,type:'獎金',pension:300,items:[['獎金',5000]]}),
  ];
  const income=getComposition(rows,'2025-06','income');
  assert.equal(income.ok,true);
  assert.equal(income.total,15000);
  assert.deepEqual(income.slices.map(x=>[x.name,x.amount]),[['本薪',8000],['獎金',5000],['交通津貼',1000],['伙食津貼',1000]]);
  const cash=getComposition(rows,'2025-06','cashflow');
  assert.equal(cash.total,15000);
  assert.deepEqual(cash.slices.map(x=>[x.name,x.amount]),[['實領',13500],['扣款',1500]]);
  assert.ok(cash.slices.every(x=>x.name!=='公司公提退休金'));
});

test('unconfirmed income or mismatched totals suppresses income proportions',()=>{
  const incomplete=record({month:'2025-06',gross:10000,net:9000,deduction:1000,items:[['本薪',9000],['津貼',null,'unknown']]});
  assert.equal(getComposition([incomplete],'2025-06','income').ok,false);
  const mismatch=record({month:'2025-06',gross:10000,net:9000,deduction:1000,items:[['本薪',9000]]});
  assert.equal(getComposition([mismatch],'2025-06','income').ok,false);
  mismatch.totals.net=8900;
  assert.equal(getComposition([mismatch],'2025-06','cashflow').ok,false);
});

test('income chart groups small amounts into an expandable other slice',()=>{
  const items=[['本薪',7000],['交通津貼',1000],['伙食津貼',900],['地區津貼',800],['輪班津貼',700],['夜班津貼',600],['其他津貼',500]];
  const row=record({month:'2025-06',gross:11500,net:10500,deduction:1000,items});
  const result=getComposition([row],'2025-06','income',4);
  assert.deepEqual(result.slices.at(-1),{name:'其他',amount:1800,details:[{name:'輪班津貼',amount:700},{name:'夜班津貼',amount:600},{name:'其他津貼',amount:500}]});
});

test('yearly series aggregates bonus and leaves absent months as gaps',()=>{
  const rows=[
    record({month:'2025-02',gross:10000,net:9000,deduction:1000,items:[['本薪',10000]]}),
    record({month:'2025-02',gross:5000,net:4500,deduction:500,type:'獎金',items:[['獎金',5000]]}),
    record({month:'2025-04',gross:12000,net:11000,deduction:1000,items:[['本薪',12000]]}),
    record({month:'2025-03',gross:8000,net:7000,deduction:1000,company:'另一示範公司',items:[['本薪',8000]]}),
  ];
  const series=getMonthlySeries(rows,{year:'2025',company:'示範公司',includeDeduction:true});
  assert.equal(series.length,12);
  assert.deepEqual(series[1],{month:'2025-02',gross:15000,net:13500,deduction:1500});
  assert.deepEqual(series[2],{month:'2025-03',gross:null,net:null,deduction:null});
  assert.deepEqual(series[3],{month:'2025-04',gross:12000,net:11000,deduction:1000});
});
