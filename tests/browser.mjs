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
  const manifest=await(await context.request.get(`${base}manifest.webmanifest`)).json();
  assert.equal(manifest.id,'./','PWA identity remains stable across updates');
  assert.equal(manifest.scope,'./','PWA scope remains stable across updates');
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'),'manifest includes a dedicated Android-safe icon');
  assert.deepEqual(await page.evaluate(async()=>{const icon=new Image();icon.src=document.querySelector('link[rel="apple-touch-icon"]').href;await icon.decode();return [icon.naturalWidth,icon.naturalHeight];}),[180,180],'Apple touch icon is 180px square');
  assert.equal(await page.locator('.install-entry').count(),1,'browser tabs show an install entry without claiming the app is installed');
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

  const installGuide=await context.newPage();
  await installGuide.setViewportSize({width:390,height:844});
  await installGuide.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'}));
  await installGuide.goto(`${base}#home`,{waitUntil:'networkidle'});
  await installGuide.evaluate(()=>{window.__installPromptCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.__installPromptCalls++;};event.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(event);});
  await installGuide.click('.install-entry');
  assert.match(await installGuide.locator('h1').innerText(),/安裝到手機/);
  assert.match(await installGuide.locator('.install-guide').innerText(),/Chrome 已準備好安裝/);
  await installGuide.click('[data-action="install-now"]');
  assert.equal(await installGuide.evaluate(()=>window.__installPromptCalls),1,'Android Chrome install prompt opens only after a user action');
  assert.match(await installGuide.locator('.install-guide').innerText(),/安裝視窗已關閉/);
  await installGuide.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('可離線使用'),{timeout:120000});
  await installGuide.goto(`${base}#settings`,{waitUntil:'networkidle'});
  assert.equal(await installGuide.locator('.install-entry').count(),1,'settings keeps the same install guide entry');
  assert.match(await installGuide.locator('[data-install-status]').innerText(),/瀏覽器分頁開啟/,'a browser tab does not claim that the app is already installed');
  assert.ok(await installGuide.locator('.install-entry').evaluate(el=>el.getBoundingClientRect().height>=44),'install button meets touch target height');
  await installGuide.click('.install-entry');
  assert.match(await installGuide.locator('h1').innerText(),/安裝到手機/);
  assert.match(await installGuide.locator('.install-guide').innerText(),/Chrome 右上角/,'dismissal leaves user-controlled Chrome menu steps');
  assert.ok(await installGuide.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px install guide has no page-level horizontal overflow');
  await installGuide.close();

  const iosGuide=await context.newPage();
  await iosGuide.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}));
  await iosGuide.goto(`${base}#install`,{waitUntil:'networkidle'});
  assert.match(await iosGuide.locator('.install-guide').innerText(),/分享/);
  assert.match(await iosGuide.locator('.install-guide').innerText(),/加入主畫面/);
  await iosGuide.close();

  const standalone=await context.newPage();
  await standalone.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
  await standalone.goto(`${base}#home`,{waitUntil:'networkidle'});
  assert.equal(await standalone.locator('.install-entry').count(),0,'standalone app mode hides repeated install actions');
  assert.match(await standalone.locator('.app-mode-badge').innerText(),/正在使用 App 模式/);
  await standalone.goto(`${base}#install`,{waitUntil:'networkidle'});
  assert.match(await standalone.locator('[data-install-status]').innerText(),/正在使用 App 模式/);
  await standalone.close();

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
  console.log('Browser checks passed: charts, history filters, Android install prompt/dismissal, iPhone Safari guidance, standalone mode, 390px layout, offline readiness, and offline reload.');
}finally{
  await browser?.close();
  server.kill();
}
