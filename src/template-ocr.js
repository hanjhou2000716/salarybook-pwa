import {loadImage,transform} from './ocr.js';
import {blankRecord} from './core.js';
import {normalizeNumericCell,traceField,fieldKey} from './ocr-diagnostics.js';
import {assetRoot,abortError,runWithCancel} from './runtime.js';

// Coordinates are ratios against the supplied download table. The profile is
// used only after both pages pass visual grid checks and the month cell check.
const incomeRows=[362,398,429,459,490,521,552,582,612,665,695,727];
const incomeColumns=[
 ['本薪','交通津貼','地區津貼','輪班津貼','應稅臨時加班費','免稅臨時加班費','緊急入廠加班費','伙食津貼','醫療補助費','久任獎金','其他津貼'],
 ['經營津貼','職務津貼','作業津貼','作業用品代金','國定假日出勤獎金','假日加班費','特休未休代金','調任差旅津貼','工作獎金','春節出勤獎金','點心代金'],
 ['效率獎金','績效獎金','候傳補貼','服裝代金','應稅補發','免稅補發','公傷補償墊付款','擴建差旅津貼','颱風出勤獎金','回收津貼']
];
const deductions=[['所得稅','福利金','交通費','暫支薪資','福利類扣款','自提退休金','托兒所扣款','補充健保費'],['勞保費','工會費','伙食費','停車費','法院強制扣款','購股扣款','部門提撥基金'],['健保費','宿舍水電費','補扣','汽機車貸款','春節出勤獎金相關扣款','保證金','其他扣款']];
const freeCells=new Set(['0:5','0:6','0:7','1:5','1:6','2:5','2:6']);
const totalCells=[['gross',0,[531,999,584,1024]],['taxable',0,[210,999,262,1024]],['taxFree',0,[374,999,424,1024]],['net',0,[514,288,583,308]],['absenceTotal',0,[532,967,583,992]],['deduction',1,[532,540,584,563]],['employerPension',1,[197,1321,224,1336]],['employerCumulative',1,[317,1320,347,1337]],['selfCumulative',1,[446,1320,457,1337]]];
const base=assetRoot(import.meta.url);

function scaledRect(rect,image){return rect.map((v,i)=>v*(i%2===0?image.width/691:image.height/1536));}
function horizontalRuleStrength(image,y){
 const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;
 const py=Math.round(y*image.height/1536),left=Math.round(180*image.width/691),right=Math.round(600*image.width/691);let dark=0,total=0;
 for(let yy=Math.max(0,py-1);yy<=Math.min(image.height-1,py+1);yy++)for(let x=left;x<right;x++){const i=(yy*image.width+x)*4,l=(pixels[i]+pixels[i+1]+pixels[i+2])/3;if(l<160)dark++;total++;}return dark/total;
}
function hasIncomeTable(image){return horizontalRuleStrength(image,458)>.2&&horizontalRuleStrength(image,758)>.08;}
function hasDeductionTable(image){return [266,311,433,464].every(y=>horizontalRuleStrength(image,y)>.2)&&horizontalRuleStrength(image,538)>.07;}
export async function hasDownloadTableStructure(pages){
 if(pages.length!==2||pages.some(p=>(p.rotation||0)%360||(p.crop||[0,0,100,100]).some((v,i)=>v!==[0,0,100,100][i])))return false;
 try{const images=await Promise.all(pages.map(p=>loadImage(p.original||p.data)));if(images.some(i=>i.width/i.height<.42||i.width/i.height>.48))return false;
   return images.some(hasIncomeTable)&&images.some(hasDeductionTable);
 }catch{return false;}
}

function makeCellCanvas(image,rect,attempt){
 const [x0,y0,x1,y1]=scaledRect(rect,image),width=x1-x0,height=y1-y0;if(!Number.isFinite(width)||!Number.isFinite(height)||width<8||height<6||x0<0||y0<0||x1>image.width||y1>image.height)throw Object.assign(Error('分格範圍無效'),{code:'CROP_BOUNDS'});
 const factor=attempt===0?5:8,margin=20,canvas=document.createElement('canvas');canvas.width=Math.round(width*factor)+margin*2;canvas.height=Math.round(height*factor)+margin*2;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=attempt===0;ctx.imageSmoothingQuality='high';ctx.drawImage(image,x0,y0,width,height,margin,margin,width*factor,height*factor);
 const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);let min=255,max=0;
 for(let i=0;i<imageData.data.length;i+=4){const v=Math.round((imageData.data[i]+imageData.data[i+1]+imageData.data[i+2])/3);min=Math.min(min,v);max=Math.max(max,v);let out=v;if(attempt===1)out=v<Math.min(225,Math.max(165,(min+max)/2))?0:255;imageData.data[i]=imageData.data[i+1]=imageData.data[i+2]=out;imageData.data[i+3]=255;}
 ctx.putImageData(imageData,0,0);return canvas;
}

function financialField(item){return item.group==='income'||item.group==='deductions';}
export async function recognizeTemplate(pages,onProgress=()=>{},options={}){
 const {signal,job}=options;abortError(signal);if(pages.length!==2)throw Object.assign(Error('固定版面需要兩頁薪資單'),{code:'PAGE_COUNT'});
 const images=await Promise.all(pages.map(p=>loadImage(p.original||p.data)));
 if(images.some(i=>Math.abs(i.width/i.height-691/1536)>.02)||!await hasDownloadTableStructure(pages))throw Object.assign(Error('無法確認下載表格的直線欄位結構；請裁切至完整表格或使用通用辨識。'),{code:'LAYOUT_UNCONFIRMED'});
 const started=performance.now();let worker,initCancelled=false;const create=Tesseract.createWorker('eng',1,{workerPath:new URL('vendor/tesseract/worker.min.js',base).href,corePath:new URL('vendor/core/',base).href,langPath:new URL('vendor/lang',base).href,cacheMethod:'none'});create.then(w=>{if(signal?.aborted||initCancelled)w.terminate();}).catch(()=>{});worker=await runWithCancel(create,60000,'ENGINE_INIT_TIMEOUT',signal,()=>worker);
 const r=blankRecord();r.company='';r.ocrMeta={fields:{}};for(const item of r.items.filter(x=>x.group==='income'||x.group==='deductions')){item.state='unknown';item.ocrStatus='UNREAD';}const raw=[];let done=0,rolePages=[0,1],total=0,stopped=false;
 total=incomeColumns.reduce((n,c)=>n+c.length,0)+deductions.reduce((n,c)=>n+c.length,0)+totalCells.length+8+24*2+5*2+1;
 const ensureAlive=()=>{abortError(signal);if(performance.now()-started>300000)throw Object.assign(Error('OCR 工作超過 5 分鐘，已停止。'),{code:'JOB_TIMEOUT'});};
 async function runCell(page,rect,{group='totals',name='unknown',allowDecimal=false}={}){
   ensureAlive();const image=images[page],crop=scaledRect(rect,image);if(crop[0]<0||crop[1]<0||crop[2]>image.width||crop[3]>image.height||crop[2]-crop[0]<8||crop[3]-crop[1]<6)throw Object.assign(Error('分格影像範圍或像素不足'),{code:'CROP_BOUNDS'});
   const attempts=[];
   for(let attempt=0;attempt<2;attempt++){
     if(attempt&&attempts[0].parsed.value!==null&&attempts[0].confidence>=85)break;
     ensureAlive();let cropCanvas;try{cropCanvas=makeCellCanvas(image,rect,attempt);const {data}=await runWithCancel(worker.recognize(cropCanvas.toDataURL('image/png')),15000,'CELL_TIMEOUT',signal,()=>worker);ensureAlive();const parsed=normalizeNumericCell(data.text,{allowDecimal}),confidence=Number(data.confidence)||0;attempts.push({text:String(data.text||'').trim(),parsed,confidence});
       if(job)traceField(job,{group,name,page:pages[page].originalPage||page+1,pageId:pages[page].pageId,rect:crop,raw:data.text,normalized:parsed.normalized,value:parsed.value,confidence,status:parsed.status==='parsed'&&confidence<60?'needsReview':parsed.status,reason:parsed.reason||null});
       if(parsed.status==='parsed'&&confidence>=75)break;
     }finally{cropCanvas?.remove();}
   }
   const first=attempts[0]||{text:'',parsed:{value:null,status:'empty',reason:'NO_TEXT'},confidence:0};const conflict=attempts.length>1&&first.parsed.value!==null&&attempts[1].parsed.value!==null&&first.parsed.value!==attempts[1].parsed.value;
   const selected=attempts.reduce((best,current)=>current.parsed.value!==null&&current.confidence>best.confidence?current:best,first);const confidence=selected.confidence;
   const status=conflict?'ambiguous':selected.parsed.value===null?selected.parsed.status:confidence<60?'needsRevie