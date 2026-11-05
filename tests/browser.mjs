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
  await installGuide.waitForFunction(()=>location.hash==='#install'&&document.querySelector('h1')?.innerText.includes('安裝到手機'));
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
  await installGuide.waitForFunction(()=>location.hash==='#install'&&document.querySelector('h1')?.innerText.includes('安裝到手機'));
  assert.match(await installGuide.locator('h1').innerText(),/安裝到手機/);
  assert.match(await installGuide.locator('.install-guide').innerText(),/Chrome 右上角/,'dismissal leaves user-controlled Chrome menu steps');
  assert.ok(await installGuide.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px install guide has no page-level horizontal overflow');
  await installGuide.goto(`${base}#settings`,{waitUntil:'networkidle'});
  await installGuide.click('[data-action="prepare-fixed"]');
  await installGuide.waitForFunction(()=>document.querySelector('[data-resource-state]')?.textContent.includes('OCR下載表格：已準備'),{timeout:120000});
  assert.deepEqual(await installGuide.evaluate(async()=>{const moduleUrl=new URL(document.querySelector('script[type="module"]').src),{recognizeTemplate}=await import(new URL('template-ocr.js',moduleUrl)),makePage=(role)=>{const c=document.createElement('canvas');c.width=691;c.height=1536;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='12px Arial';x.textBaseline='middle';const cell=(rect,value)=>{const [x0,y0,x1,y1]=rect,w=x.measureText(value).width;x.fillText(value,x0+Math.max(1,(x1-x0-w)/2),(y0+y1)/2);};if(role==='income'){for(const y of [458,758]){x.strokeStyle='#111';x.lineWidth=2;x.beginPath();x.moveTo(180,y);x.lineTo(600,y);x.stroke();}cell([414,250,454,267],'202506');const rows=[362,398,429,459,490,521,552,582,612,665,695,727],cols=[['12345','647','1789','0','0','0','0','1500','0','0','0'],['0','0','0','0','0','0','0','0','0','0','0'],['0','0','0','0','0','0','0','0','0','0']];const xs=[[222,263],[385,425],[546,584]];for(let col=0;col<3;col++)for(let row=0;row<cols[col].length;row++)cell([xs[col][0],rows[row]+3,xs[col][1],rows[row+1]-3],cols[col][row]);for(const [rect,value] of [[[514,288,583,308],'16281'],[[531,999,584,1024],'16281'],[[210,999,262,1024],'14781'],[[374,999,424,1024],'1500'],[[532,967,583,992],'0']])cell(rect,value);const ax=[[222,263],[385,425],[546,584]];for(const [col,count] of [[0,3],[1,3],[2,2]])for(let row=0;row<count;row++)cell([ax[col][0],875+row*30,ax[col][1],899+row*30],'0');}else{x.strokeStyle='#111';x.lineWidth=2;for(const y of [266,311,433,464,538]){x.beginPath();x.moveTo(180,y);x.lineTo(600,y);x.stroke();}const dx=[[240,278],[403,439],[548,584]],ded=[8,7,7];for(let col=0;col<3;col++)for(let row=0;row<ded[col];row++)cell([dx[col][0],283+row*30.3,dx[col][1],308+row*30.3],'0');for(const [rect,value] of [[[532,540,584,563],'0'],[[197,1321,224,1336],'333'],[[317,1320,347,1337],'333'],[[446,1320,457,1337],'0']])cell(rect,value);const left=['病假','半假','曠職','公傷假','特休','撫育假','產假','喪假','安胎假','排休假','原住民族假','新進假'],right=['遲到','忘打卡','未帶卡','遺失卡','無薪假','生理假','家庭照顧假','婚假','陪產（檢）假','駐廠假','產檢假','健檢假'];for(const [col,names] of [left,right].entries())for(let row=0;row<names.length;row++){const v=col===0?[215,665+row*18,278,681+row*18]:[444,665+row*18,505,681+row*18],cum=col===0?[281,665+row*18,357,681+row*18]:[509,665+row*18,583,681+row*18];cell(v,'0');cell(cum,'0');}}return {name:`synthetic-${role}.png`,data:c.toDataURL(),original:c.toDataURL(),hash:'synthetic',rotation:0,crop:[0,0,100,100]};},syntheticPages=[makePage('income'),makePage('deduction')],record=await recognizeTemplate(syntheticPages,()=>{}),item=(name,value)=>record.items.find(i=>i.group==='income'&&i.name===name)?.value===value;window.__templateFixtureImages=syntheticPages.map(p=>p.data);return {month:record.month==='2025-06',salary:item('本薪',12345),transport:item('交通津貼',647),region:item('地區津貼',1789),meal:item('伙食津貼',1500),gross:record.totals.gross===16281,deduction:record.totals.deduction===0,net:record.totals.net===16281,pension:record.totals.employerPension===333};}),{month:true,salary:true,transport:true,region:true,meal:true,gross:true,deduction:true,net:true,pension:true},'template OCR regression checks real cell cropping, normalization and field mapping using a generated fictional table');
  const fictionalFiles=await installGuide.evaluate(()=>window.__templateFixtureImages);
  await installGuide.goto(`${base}#import`,{waitUntil:'networkidle'});
  await installGuide.locator('#files').setInputFiles(fictionalFiles.map((data,index)=>({name:`fictional-page-${index+1}.png`,mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')})));
  await installGuide.waitForFunction(()=>document.querySelectorAll('#previews img').length===2);
  await installGuide.click('[data-action="ocr"]');
  await installGuide.waitForFunction(()=>location.hash==='#edit'||/辨識失敗|沒有讀到/.test(document.querySelector('#importState')?.textContent||''),{timeout:120000});
  const rendered=await installGuide.evaluate(()=>{const item=(group,name)=>{const row=[...document.querySelectorAll(`[data-group="${group}"] .item-row`)].find(el=>el.querySelector('label')?.textContent.trim().startsWith(name));return row?.querySelector('[data-itemkey="value"]')?.value||'';};const total=key=>document.querySelector(`[data-total="${key}"]`)?.value||'';const summary=JSON.parse(document.querySelector('[data-diagnostic-preview]')?.textContent||'{}');const trace=JSON.parse(document.querySelector('[data-local-trace]')?.textContent||'[]');return {month:document.querySelector('[data-basic="month"]')?.value,salary:item('income','本薪'),transport:item('income','交通津貼'),region:item('income','地區津貼'),meal:item('income','伙食津貼'),gross:total('gross'),deduction:total('deduction'),net:total('net'),pension:total('employerPension'),pages:document.querySelectorAll('#sourceImages img').length,formMismatchCount:summary.job?.formMismatchCount,traceMatches:trace.some(x=>x.group==='income'&&x.name==='交通津貼'&&x.value===647&&x.modelValue===647&&x.formValue==='647'),summarySanitized:!['fields','raw','value','candidate','normalized','formValue','modelValue'].some(key=>Object.hasOwn(summary.job||{},key)),opened:location.hash==='#edit'};});
  assert.deepEqual(rendered,{month:'2025-06',salary:'12345',transport:'647',region:'1789',meal:'1500',gross:'16281',deduction:'0',net:'16281',pension:'333',pages:2,formMismatchCount:0,traceMatches:true,summarySanitized:true,opened:true},'real OCR result flows through the actual confirmation form and the shareable diagnostic stays sanitized');
  await installGuide.goto(`${base}#settings`,{waitUntil:'networkidle'});
  await installGuide.click('[data-action="self-test"]');
  await installGuide.waitForFunction(()=>document.querySelector('[data-selftest-state]')?.textContent.includes('自檢通過'),{timeout:120000});
  await context.setOffline(true);
  await installGuide.click('[data-action="self-test"]');
  await installGuide.waitForFunction(()=>document.querySelector('[data-selftest-state]')?.textContent.includes('自檢通過'),{timeout:120000});
  await context.setOffline(false);
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
    const registration=await navigator.serviceWorker.ready,worker=navigator.serviceWorker.controller||registration.active;if(!worker)return false;
    return new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>resolve(false),3000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data?.shellReady===true);};worker.postMessage({type:'OFFLINE_STATUS'},[channel.port2]);});
  },{timeout:120000});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({waitUntil:'load'});
  assert.match(await page.locator('h1').innerText(),/每一份努力/);
  assert.deepEqual(pageErrors,[],'no uncaught page errors');
  await context.close();
  console.log('Browser checks passed: charts, history filters, install guidance, 390px layout, verified offline shell, and real on-device OCR self-test online/offline.');
}finally{
  await browser?.close();
  server.kill();
}
