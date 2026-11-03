import {mkdir,cp,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
await mkdir('dist',{recursive:true});
for(const f of ['index.html','style.css','manifest.webmanifest','icon.svg'])await copyFile(f,`dist/${f}`);
await cp('src','dist/src',{recursive:true});await cp('icons','dist/icons',{recursive:true});
for(const dir of ['tesseract','core','lang','pdf'])await mkdir(`dist/vendor/${dir}`,{recursive:true});
for(const f of ['tesseract.min.js','worker.min.js'])await copyFile(`node_modules/tesseract.js/dist/${f}`,`dist/vendor/tesseract/${f}`);
for(const f of await readdir('node_modules/tesseract.js-core'))if(f.endsWith('.wasm')||f.endsWith('.wasm.js'))await copyFile(`node_modules/tesseract.js-core/${f}`,`dist/vendor/core/${f}`);
for(const lang of ['chi_tra','eng'])await copyFile(`node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`,`dist/vendor/lang/${lang}.traineddata.gz`);
for(const f of ['pdf.mjs','pdf.worker.mjs'])await copyFile(`node_modules/pdfjs-dist/build/${f}`,`dist/vendor/pdf/${f}`);
for(const d of ['cmaps','standard_fonts'])await cp(`node_modules/pdfjs-dist/${d}`,`dist/vendor/pdf/${d}`,{recursive:true});
await mkdir('dist/licenses',{recursive:true});
for(const [pkg,target] of [['tesseract.js','tesseract'],['tesseract.js-core','tesseract-core'],['pdfjs-dist','pdfjs']]){const files=await readdir(`node_modules/${pkg}`);const license=files.find(f=>/^LICENSE/i.test(f));if(license)await copyFile(`node_modules/${pkg}/${license}`,`dist/licenses/${target}.txt`);}
await writeFile('dist/licenses/models.txt','Tesseract traineddata: Apache-2.0. https://github.com/tesseract-ocr/tessdata https://github.com/naptha/tessdata');
await writeFile('dist/.nojekyll','');
async function walk(dir){let out=[];for(const f of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())out.push(...await walk(p));else if(!['sw.js','asset-manifest.json'].includes(f.name))out.push(p.replaceAll('\\','/').replace(/^dist\//,''));}return out;}
const assets=await walk('dist'),digest=createHash('sha256');for(const a of assets)digest.update(await readFile(`dist/${a}`));const version=digest.digest('hex').slice(0,12);
await writeFile('dist/asset-manifest.json',JSON.stringify({version,assets},null,2));
await writeFile('dist/sw.js',`const NAME='salarybook-'+${JSON.stringify(version)}+'-'+new URL(self.registration.scope).pathname;const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(NAME);await c.addAll(ASSETS.map(x=>new URL(x,self.registration.scope).href));await self.skipWaiting();})()));self.addEventListener('message',e=>{if(e.data?.type==='OFFLINE_STATUS'&&e.ports[0])e.waitUntil((async()=>{const c=await caches.open(NAME);const cachedCount=(await c.keys()).length;e.ports[0].postMessage({type:'OFFLINE_STATUS',cachedCount,total:ASSETS.length,ready:cachedCount>=ASSETS.length});})());});self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('salarybook-')&&k.endsWith('-'+new URL(self.registration.scope).pathname)&&k!==NAME)await caches.delete(k);await self.clients.claim();for(const client of await self.clients.matchAll())client.postMessage({type:'OFFLINE_READY',cachedCount:ASSETS.length,total:ASSETS.length,ready:true});})()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!u.href.startsWith(self.registration.scope))return;e.respondWith((async()=>{const c=await caches.open(NAME);const key=new URL(u.pathname,location.origin).href;const hit=await c.match(key);if(hit)return hit;try{return await fetch(e.request);}catch(error){if(e.request.mode==='navigate')return await c.match(new URL('index.html',self.registration.scope).href);throw error;}})());});`);
console.log(`Built ${assets.length} offline assets, version ${version}. No external runtime requests.`);
