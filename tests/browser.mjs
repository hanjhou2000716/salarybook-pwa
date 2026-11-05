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
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  const manifest=await(await context.request.get(`${base}manifest.webmanifest`)).json();
  assert.equal(manifest.id,'./','PWA identity remains stable across updates');
  assert.equal(manifest.scope,'./','PWA scope remains stable across updates');
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'),'manifest includes a dedicated Android-safe icon');
  assert.deepEqual(await page.evaluate(async()=>{const icon=new Image();icon.src=document.querySelector('link[rel="apple-touch-icon"]').href;await icon.decode();return [icon.naturalWidth,icon.naturalHeight];}),[180,180],'Apple touch icon is 180px square');
  assert.deepEqual(await page.evaluate(async()=>{const appModule=new URL(document.querySelector('script[type="module"]').src),{hasDownloadTableStructure}=await import(new URL('template-ocr.js',appModule));const fake=(kind,index)=>{const c=document.createElement('canvas');c.width=691;c.height=1536;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);if(kind==='table'){x.strokeStyle='#111';x.lineWidth=2;const ys=index===0?[458,758]:[266,311,433,464,538];for(const y of ys){x.beginPath();x.moveTo(180,y);x.lineTo(600,y);x.stroke();}}return {data:c.toDataURL(),rotation:0,crop:[0,0,100,100]};};const table=await hasDownloadTableStructure([fake('table',0),fake('table',1)]),swapped=await hasDownloadTableStructure([fake('table',1),fake('table',0)]),cards=await hasDownloadTableStructure([fake('cards',0),fake('cards',1)]);return [table,swapped,cards];}),[true,true,false],'both page roles are validated, swapped order is supported, and cards are rejected');
  assert.equal(await page.locator('.install-entry').count(),1,'browser tabs show an install entry without claiming the app is installed');
  await page.evaluate(async()=>{
    const appModule=new URL(document.querySelector('script[type="module"]').src),{sample}=await import(new URL('core.js',appModule)),DB=await import(new URL('db.js',appModule));
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

  const installGuide=await context.newPage();
  await installGuide.setViewportSize({width:390,height:844});
  await installGuide.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'}));
  await installGuide.goto(`${base}#home`,{waitUntil:'networkidle'});
  await installGuide.evaluate(()=>{window.__installPromptCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.__installPromptCalls++;};event.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(event);});
  await installGuide.click('.install-entry');
  await installGuide.waitForFunction(()=>location.hash==='#install');
  assert.match(await installGuide.locator('h1').innerText(),/安裝到手機/);
  assert.match(await installGuide.locator('.install-guide').innerText(),/Chrome 已準備好安裝/);
  await installGuide.click('[data-action="install-now"]');
  assert.equal(await installGuide.evaluate(()=>window.__installPromptCalls),1,'Android Chrome install prompt opens only after a user action');
  assert.match(await installGuide.locator('.install-guide').innerText(),/安裝視窗已關閉/);
  await installGuide.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.includes('離線查閱：已準備'),{timeout:120000});
  await installGuide.goto(`${base}#settings`,{waitUntil:'networkidle'});
  assert.equal(await installGuide.locator('.install-entry').count(),1,'settings keeps the same install guide entry');
  assert.match(await installGuide.locator('[data-install-status]').innerText(),/瀏覽器分頁開啟/,'a browser tab does not claim that the app is already installed');
  assert.ok(await installGuide.locator('.install-entry').evaluate(el=>el.getBoundingClientRect().height>=44),'install button meets touch target height');
  await installGuide.click('.install-entry');
  await installGuide.waitForFunction(()=>location.hash==='#install');
  assert.match(await installGuide.locator('h1').innerText(),/安裝到手機/);
  assert.match(await installGuide.locator('.install-guide').innerText(),/Chrome 右上角/,'dismissal leaves user-controlled Chrome menu steps');
  assert.ok(await installGuide.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px install guide has no page-level horizontal overflow');
  await installGuide.goto(`${base}#settings`,{waitUntil:'networkidle'});
  await installGuide.click('[data-action="prepare-fixed"]');
  await installGuide.waitForFunction(()=>document.querySelector('[data-resource-state]')?.textContent.includes('OCR下載表格：已準備'),{timeout:120000});
  assert.deepEqual(await installGuide.evaluate(async()=>{const moduleUrl=new URL(document.querySelector('script[type="module"]').src),{recognizeTemplate}=await import(new URL('template-ocr.js',moduleUrl)),makePage=(role)=>{const c=document.createElement('canvas');c.width=691;c.height=1536;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='12px Arial';x.textBaseline='middle';const cell=(rect,value)=>{const [x0,y0,x1,y1]=rect,w=x.measureText(value).width;x.fillText(value,x0+Math.max(1,(x1-x0-w)/2),(y0+y1)/2);};if(role==='income'){for(const y of [458,758]){x.strokeStyle='#111';x.lineWidth=2;x.beginPath();x.moveTo(180,y);x.lineTo(600,y);x.stroke();}cell([414,250,454,267],