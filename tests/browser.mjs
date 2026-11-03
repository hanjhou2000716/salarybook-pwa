import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const port=4174,base=`http://127.0.0.1:${port}/salarybook/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<60&&!ready;i++){
    try{ready=(await fetch(base)).ok;}catch{}
    if(!ready)await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'local preview server starts');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
    const {sample}=await import('./src/core.js'),DB=await import('./src/db.js');
    const base=sample();base.confirmed=true;await DB.save(base);
    const bonus=structuredClone(base);bonus.id=crypto.randomUUID();bonus.type='獎金';await DB.save(bonus);
    const august=structuredClone(base);august.id=crypto.randomUUID();august.month='2025-08';august.company='另一示範公司';await DB.save(august);
  });
  await page.reload({waitUntil:'networkidle'});
  await page.selectOption('#homeMonth','2025-06');
  await page.waitForSelector('.donut-sector');
  assert.match(await page.locator('.composition-card').innerText(),/已合併 2 筆/);
  assert.match(await page.locator('.overview-summary').innerText(),/4,400/);
  const percents=await page.locator('.legend-percent').allTextContents();
  assert.equal(Math.round(percents.reduce((sum,item)=>sum+Number.parseFloat(item),0)),100);
  await page.click('[data-mode="cashflow"]');
  assert.match(await page.locator('.donut-legend-list').innerText(),/實領[\s\S]*70,400[\s\S]*扣款[\s\S]*4,400/);
  assert.doesNotMatch(await page.locator('.donut-legend-list').innerText(),/退休金/);
  await page.click('[data-mode="income"]');
  await page.click('nav a[href="#history"]');
  await page.waitForSelector('.line-svg');
  assert.equal(await page.locator('.chart-month-label').count(),12);
  await page.click('[data-chart-month="2025-06"]');
  assert.match(await page.locator('#historyMonthSummary').innerText(),/2025-06/);
  await page.click('[data-action="show-month-records"]');
  assert.equal(await page.locator('#historyTable tbody tr').count(),2);
  await page.selectOption('#company',{label:'另一示範公司'});
  assert.equal(await page.locator('[data-chart-month]').count(),2);
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}#home`,{waitUntil:'networkidle'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px view has no page-level horizontal overflow');
  await page.waitForFunction(async()=>{
    const names=await caches.keys(),name=names.find(x=>x.startsWith('salarybook-'));
    return name&&(await(await caches.open(name)).keys()).length>=200;
  },{timeout:120000});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({waitUntil:'load'});
  assert.match(await page.locator('h1').innerText(),/每一份努力/);
  assert.deepEqual(pageErrors,[],'no uncaught page errors');
  await context.close();
  console.log('Browser checks passed: desktop charts, same-month bonus, filters, month jump, 390px layout, and offline reload.');
}finally{
  await browser?.close();
  server.kill();
}
