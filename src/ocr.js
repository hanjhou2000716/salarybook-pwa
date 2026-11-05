import {blankRecord} from './core.js';
import {fieldKey, normalizeNumericCell, traceField} from './ocr-diagnostics.js';
import {assetRoot, abortError, runWithCancel} from './runtime.js';

const base = assetRoot(import.meta.url);
const TOTAL_ALIASES = {
  taxable:['應稅項目小計','應稅項目小'], taxFree:['免稅項目小計'], gross:['合計應發金額','合計應發','應發項目小計'],
  deduction:['合計應扣'], net:['本次實發薪資','實發金額','本次實發','合計實發金額'], advance:['暫支薪已發'],
  absenceTotal:['缺勤減發小計'], employerPension:['本月公提退休金','本月公司提撥退休金'],
  employerCumulative:['累計公提退休金'], selfCumulative:['累計自提退休金'],
};
const ALIASES = {本薪:['本薪'],交通津貼:['交通津貼'],地區津貼:['地區津貼'],伙食津貼:['伙食津貼'],自提退休金:['自提退休金'],福利類扣款:['福利類扣款','福利類扣減']};
const HIDDEN = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

export async function readPages(files) {
  if (!files.length) throw Error('請選擇兩張圖片或一份兩頁 PDF');
  const pages=[];
  for (const f of files) {
    if (f.size > 35*1024*1024) throw Error('單檔上限 35 MB');
    if (f.type==='application/pdf'||/\.pdf$/i.test(f.name)) {
      const pdfjs=await import(new URL('vendor/pdf/pdf.mjs',base).href);
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf/pdf.worker.mjs',base).href;
      const pdf=await pdfjs.getDocument({data:new Uint8Array(await f.arrayBuffer()),isEvalSupported:false,cMapUrl:new URL('vendor/pdf/cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/pdf/standard_fonts/',base).href}).promise;
      try { if(pdf.numPages!==2)throw Error('請提供剛好兩頁的 PDF'); for(let n=1;n<=2;n++){const p=await pdf.getPage(n),v=p.getViewport({scale:Math.min(2,2400/p.getViewport({scale:1}).width)}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;pages.push({name:`${f.name} 第 ${n} 頁`,data:c.toDataURL('image/png'),pageId:crypto.randomUUID(),originalPage:n});} }
      finally { await pdf.destroy(); }
    } else if(['image/png','image/jpeg'].includes(f.type)) {
      const data=await new Promise((resolve,reject)=>{const q=new FileReader();q.onload=()=>resolve(q.result);q.onerror=()=>reject(Error('圖片讀取失敗'));q.readAsDataURL(f);});
      const image=await loadImage(data);pages.push({name:f.name,data,pageId:crypto.randomUUID(),originalPage:pages.length+1,width:image.width,height:image.height});
    } else throw Error('僅支援 JPG、PNG、PDF');
  }
  if(pages.length!==2)throw Error('請選擇剛好兩頁明細');
  for(const p of pages){const image=await loadImage(p.data);if(image.width*image.height>80000000)throw Error('圖片像素過大，請先匯出較小尺寸的副本再匯入。');p.width=image.width;p.height=image.height;p.original=p.data;p.rotation=0;p.crop=[0,0,100,100];p.hash=await hash(p.data);}
  return pages;
}
export async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('圖片格式損毀'));i.src=src;});}
export async function transform(p,upscale=false){const img=await loadImage(p.original||p.data),[x,y,w,h]=p.crop||[0,0,100,100],sw=img.width*w/100,sh=img.height*h/100;if(sw<20||sh<20)throw Error('裁切範圍過小');const rot=(p.rotation||0)%360,c=document.createElement('canvas'),scale=upscale?Math.min(3,2600/Math.max(sw,sh)):1;c.width=Math.round((rot%180?sh:sw)*scale);c.height=Math.round((rot%180?sw:sh)*scale);const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.translate(c.width/2,c.height/2);ctx.rotate(rot*Math.PI/180);ctx.drawImage(img,img.width*x/100,img.height*y/100,sw,sh,-sw*scale/2,-sh*scale/2,sw*scale,sh*scale);return c;}

function extractAfterLabel(text,names,{allowDecimal=false}={}) {
  const lines=String(text||'').normalize('NFKC').replace(HIDDEN,'').split(/\r?\n/);
  for(const line of lines){
    const clean=line.replace(/[＊*]/g,'');
    for(const name of names){const at=clean.indexOf(name);if(at<0)continue;const tail=clean.slice(at+name.length).replace(/^\s*[（(][^）)]*[）)]/,'').replace(/^\s*[:：=]?\s*/, '');
      const match=tail.match(/^([$＄]?\s*\d[\d,，.]*\s*(?:元)?)/);if(!match)continue;
      const result=normalizeNumericCell(match[1],{allowDecimal});if(result.status==='parsed')return result;
      return result;
    }
  }
  return {raw:'',normalized:'',value:null,status:'empty',reason:'NO_TEXT'};
}
function monthFrom(text){const s=String(text||'').normalize('NFKC').replace(HIDDEN,'');const m=s.match(/(20\d{2})\s*[年\-/]?\s*(0?[1-9]|1[0-2])\s*月?/)||s.match(/所得年月\s*[:：]?\s*(20\d{2})\s*(0[1-9]|1[0-2])/);return m?`${m[1]}-${String(m[2]).padStart(2,'0')}`:'';}
export function parseOCR(results,{job}={}) {
  const r=blankRecord();r.ocrMeta={fields:{}};for(const item of r.items.filter(i=>i.group==='income'||i.group==='deductions')){item.state='unknown';item.ocrStatus='UNREAD';}const collected=new Map();
  for(const [index,res] of results.entries()){
    const text=res.text||'',detectedMonth=monthFrom(text);if(job)traceField(job,{group:'basic',name:'month',page:res.sourcePage||index+1,pageId:res.pageId,raw:detectedMonth,normalized:detectedMonth,value:detectedMonth?Number(detectedMonth.replace('-','')):null,confidence:res.confidence,status:detectedMonth?'parsed':'empty',reason:detectedMonth?null:'NO_TEXT'});if(!r.month)r.month=detectedMonth;
    const normalizedText=text.normalize('NFKC').replace(HIDDEN,'');
    const deductionPage=/扣減項目|扣款明細|合計應扣/.test(normalizedText);
    for(const group of ['income','deductions'])for(const item of r.items.filter(i=>i.group===group)){
      if(group==='income'&&deductionPage)continue;
      if(group==='deductions'&&!deductionPage&&results.length>1)continue;
      const found=extractAfterLabel(text,ALIASES[item.name]||[item.name]);
      if(job)traceField(job,{group,name:item.name,page:res.sourcePage||index+1,pageId:res.pageId,raw:found.raw,normalized:found.normalized,value:found.value,confidence:res.confidence,status:found.status,reason:found.reason});
      const key=fieldKey(group,item.name),prior=collected.get(key);
      if(found.value===null){item.state='unknown';if(prior){item.value=prior.value;item.ocrValue=prior.value;item.ocrStatus=found.status==='empty'?(item.ocrStatus||'LOW_CONFIDENCE'):found.status==='ambiguous'?'AMBIGUOUS':'LOW_CONFIDENCE';item.ocrReason=found.reason||null;item.sourcePage=prior.page;item.confidence=prior.confidence;}else{item.ocrStatus=found.status==='empty'?'UNREAD':found.status.toUpperCase();item.sourcePage=res.sourcePage||index+1;item.confidence=res.confidence??0;}continue;}
      if(prior&&prior.value!==found.value){const current={value:found.value,confidence:res.confidence||0,page:res.sourcePage||index+1};const selected=current.confidence>prior.confidence?current:prior;collected.set(key,selected);Object.assign(item,{value:selected.value,ocrValue:selected.value,state:'unknown',ocrStatus:'AMBIGUOUS',ocrReason:'CONFLICTING_READS',sourcePage:selected.page,confidence:selected.confidence});continue;}
      const accepted={value:found.value,confidence:Math.max(prior?.confidence||0,res.confidence||0),page:prior?.page||res.sourcePage||index+1};collected.set(key,accepted);
      Object.assign(item,{value:found.value,ocrValue:found.value,state:accepted.confidence<60?'unknown':'value',ocrStatus:accepted.confidence<60?'LOW_CONFIDENCE':'PARSED',sourcePage:accepted.page,confidence:accepted.confidence,ocrReason:null});
    }
    for(const [key,names] of Object.entries(TOTAL_ALIASES)){
      const found=extractAfterLabel