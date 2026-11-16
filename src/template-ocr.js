import {loadImage,transform} from './ocr.js';
import {blankRecord} from './core.js';
import {normalizeNumericCell,traceField,fieldKey,selectOcrCandidate,otsuThreshold,detectSingleZeroGlyph} from './ocr-diagnostics.js';
import {assetRoot,abortError,runWithCancel} from './runtime.js';

// Versioned coordinates for the supported downloaded payroll layout. Each page
// is registered against its printed grid anchors before any cell is cropped.
export const DOWNLOAD_LAYOUT_PROFILE={id:'download-salary-v1',width:691,height:1536,tableLeft:104,tableRight:588,
 roles:{income:{anchors:[458,758,841],minimumAnchors:3,requiredAnchors:[458,758,841]},deductions:{anchors:[266,311,433,464,538],minimumAnchors:4,requiredAnchors:[266,311,433,464]}}};
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

function lineAnalysis(image){
 const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
 const x0=Math.round(image.width*.08),x1=Math.round(image.width*.92),scores=new Float32Array(image.height),runAt=y=>{
  let bestStart=0,bestEnd=0,start=-1,last=-1;for(let x=x0;x<x1;x++){const i=(y*image.width+x)*4,l=(data[i]+data[i+1]+data[i+2])/3;if(l<168){if(start<0)start=x;last=x;}else if(start>=0&&x-last<=3)continue;else{if(last-start>bestEnd-bestStart){bestStart=start;bestEnd=last;}start=-1;last=-1;}}
  if(last-start>bestEnd-bestStart){bestStart=start;bestEnd=last;}return {left:bestStart,right:bestEnd,width:Math.max(0,bestEnd-bestStart+1)};
 };
 for(let y=0;y<image.height;y++){let dark=0;for(let x=x0;x<x1;x++){const i=(y*image.width+x)*4;if((data[i]+data[i+1]+data[i+2])/3<168)dark++;}scores[y]=dark/(x1-x0);}
 return {scores,runAt};
}
function calibratePage(image,role){
 const profile=DOWNLOAD_LAYOUT_PROFILE.roles[role],{scores,runAt}=lineAnalysis(image),baseY=image.height/DOWNLOAD_LAYOUT_PROFILE.height,baseX=image.width/DOWNLOAD_LAYOUT_PROFILE.width;
 let best=null;const scaleMin=baseY*.94,scaleMax=baseY*1.06,scaleStep=baseY*.003,offsetLimit=image.height*.05,offsetStep=Math.max(1,Math.round(image.height*.001));
 for(let sy=scaleMin;sy<=scaleMax;sy+=scaleStep)for(let oy=-offsetLimit;oy<=offsetLimit;oy+=offsetStep){let hits=0,strength=0;const matched=[];
  let priorHit=null;for(const anchor of profile.anchors){const target=Math.round(anchor*sy+oy),low=Math.max(0,target-3),high=Math.min(image.height-1,target+3);let peak=low,score=0;for(let y=low;y<=high;y++)if(scores[y]>score){score=scores[y];peak=y;}
   const spaced=!priorHit||peak-priorHit.y>=Math.max(3,(anchor-priorHit.expected)*sy*.45);
   if(score>=.14&&spaced){hits++;strength+=score;const hit={expected:anchor,y:peak,strength:score,run:runAt(peak)};matched.push(hit);priorHit=hit;}else matched.push(null);
  }
  const requiredHits=profile.requiredAnchors.filter(anchor=>matched[profile.anchors.indexOf(anchor)]).length,quality=requiredHits*10+hits+strength*.08-Math.abs(oy)/image.height*.08-Math.abs(sy-baseY)/baseY*.04;
  if(!best||quality>best.quality)best={quality,hits,requiredHits,sy,oy,matched};
 }
 if(!best||best.hits<profile.minimumAnchors||best.requiredHits!==profile.requiredAnchors.length)return null;
 const points=best.matched.filter(Boolean),meanX=points.reduce((sum,value)=>sum+value.expected,0)/points.length,meanY=points.reduce((sum,value)=>sum+value.y,0)/points.length,denominator=points.reduce((sum,value)=>sum+(value.expected-meanX)**2,0),refinedY=denominator?points.reduce((sum,value)=>sum+(value.expected-meanX)*(value.y-meanY),0)/denominator:baseY,refinedOffset=meanY-refinedY*meanX;
 if(refinedY<baseY*.94||refinedY>baseY*1.06||Math.abs(refinedOffset)>image.height*.05)return null;
 const broad=best.matched.filter(value=>value&&value.run.width>=image.width*.65);
 let sx=baseX,ox=0;
 if(broad.length){const left=broad.reduce((n,value)=>n+value.run.left,0)/broad.length,right=broad.reduce((n,value)=>n+value.run.right,0)/broad.length,span=right-left;
  if(span>image.width*.45){sx=span/(DOWNLOAD_LAYOUT_PROFILE.tableRight-DOWNLOAD_LAYOUT_PROFILE.tableLeft);ox=left-DOWNLOAD_LAYOUT_PROFILE.tableLeft*sx;}
 }
 if(sx<baseX*.82||sx>baseX*1.18||Math.abs(ox)>image.width*.08)return null;
 return {role,scaleX:sx,scaleY:refinedY,offsetX:ox,offsetY:refinedOffset,anchors:best.matched.filter(Boolean).map(value=>({expected:value.expected,actual:value.y,strength:value.strength})),confidence:best.hits/profile.anchors.length};
}
export async function detectDownloadLayout(pages){
 if(pages.length!==2||pages.some(p=>(p.rotation||0)%360||(p.crop||[0,0,100,100]).some((v,i)=>v!==[0,0,100,100][i])))return null;
 try{const images=await Promise.all(pages.map(p=>loadImage(p.original||p.data))),calibrations=images.map(image=>({income:calibratePage(image,'income'),deductions:calibratePage(image,'deductions')})),incomePage=calibrations.findIndex(value=>value.income),deductionPage=calibrations.findIndex(value=>value.deductions);
  if(incomePage<0||deductionPage<0||incomePage===deductionPage)return null;
  return {profileId:DOWNLOAD_LAYOUT_PROFILE.id,images,calibrations:{income:calibrations[incomePage].income,deductions:calibrations[deductionPage].deductions},incomePage,deductionPage};
 }catch{return null;}
}
export async function hasDownloadTableStructure(pages){return Boolean(await detectDownloadLayout(pages));}
function scaledRect(rect,calibration){return rect.map((value,index)=>index%2===0?value*calibration.scaleX+calibration.offsetX:value*calibration.scaleY+calibration.offsetY);}

function makeCellCanvas(image,rect,attempt,calibration,{factor=8,preserveColor=false}={}){
 const [x0,y0,x1,y1]=scaledRect(rect,calibration),width=x1-x0,height=y1-y0;if(!Number.isFinite(width)||!Number.isFinite(height)||width<8||height<6||x0<0||y0<0||x1>image.width||y1>image.height)throw Object.assign(Error('分格範圍無效'),{code:'CROP_BOUNDS'});
 const margin=20,canvas=document.createElement('canvas');canvas.width=Math.round(width*factor)+margin*2;canvas.height=Math.round(height*factor)+margin*2;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,x0,y0,width,height,margin,margin,width*factor,height*factor);
 if(attempt===0){if(!preserveColor){const id=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<id.data.length;i+=4){const v=Math.round((id.data[i]+id.data[i+1]+id.data[i+2])/3);id.data[i]=id.data[i+1]=id.data[i+2]=v;}ctx.putImageData(id,0,0);}return canvas;}
 const imageData=ctx.getImageData(0,0,canvas.width,canvas.height),gray=new Uint8Array(canvas.width*canvas.height),histogram=new Uint32Array(256);
 for(let i=0,p=0;i<imageData.data.length;i+=4,p++){const v=Math.round((imageData.data[i]+imageData.data[i+1]+imageData.data[i+2])/3);gray[p]=v;histogram[v]++;}
 const threshold=otsuThreshold(histogram);
 if(attempt===1){for(let p=0;p<gray.length;p++){const value=gray[p]<threshold?0:255,i=p*4;imageData.data[i]=imageData.data[i+1]=imageData.data[i+2]=value;imageData.data[i+3]=255;}}
 else if(attempt===4){for(let p=0;p<gray.length;p++){const value=gray[p]<225?0:255,i=p*4;imageData.data[i]=imageData.data[i+1]=imageData.data[i+2]=value;imageData.data[i+3]=255;}}
 else if(attempt===3){
  const mask=new Uint8Array(gray.length);for(let p=0;p<gray.length;p++){const i=p*4,r=imageData.data[i],g=imageData.data[i+1],b=imageData.data[i+2],mean=gray[p],ink=mean<threshold||(b-Math.max(r,g)>=5&&mean<250)||mean<145,value=ink?0:255;mask[p]=ink?1:0;imageData.data[i]=imageData.data[i+1]=imageData.data[i+2]=value;imageData.data[i+3]=255;}
  const roi={x0:Math.round(canvas.width*.48),x1:canvas.width-margin,y0:Math.round(canvas.height*.25),y1:Math.round(canvas.height*.68)};let left=roi.x1,top=roi.y1,right=roi.x0-1,bottom=roi.y0-1;
  for(let y=roi.y0;y<roi.y1;y++)for(let x=roi.x0;x<roi.x1;x++){if(mask[y*canvas.width+x]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  ctx.putImageData(imageData,0,0);
  if(right>=left&&bottom>=top){const pad=14,out=document.createElement('canvas');out.width=right-left+1+pad*2;out.height=bottom-top+1+pad*2;const outCtx=out.getContext('2d',{willReadFrequently:true});outCtx.fillStyle='#fff';outCtx.fillRect(0,0,out.width,out.height);outCtx.drawImage(canvas,left,top,right-left+1,bottom-top+1,pad,pad,right-left+1,bottom-top+1);const outData=outCtx.getImageData(0,0,out.width,out.height),outMask=new Uint8Array(out.width*out.height);for(let p=0;p<outMask.length;p++)outMask[p]=outData.data[p*4]<128?1:0;out.visionZeroCandidate=detectSingleZeroGlyph(outMask,out.width,out.height);canvas.remove();return out;}
  canvas.visionZeroCandidate=detectSingleZeroGlyph(mask,canvas.width,canvas.height);
 }
 else {
  const stride=canvas.width+1,integral=new Float64Array((canvas.width+1)*(canvas.height+1));
  for(let y=1;y<=canvas.height;y++){let row=0;for(let x=1;x<=canvas.width;x++){row+=gray[(y-1)*canvas.width+x-1];integral[y*stride+x]=integral[(y-1)*stride+x]+row;}}
  const radius=Math.max(5,Math.round(Math.min(canvas.width,canvas.height)*.09)),c=9;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const x0=Math.max(0,x-radius),x1=Math.min(canvas.width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(canvas.height,y+radius+1),area=(x1-x0)*(y1-y0),mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/area,value=gray[y*canvas.width+x]<mean-c?0:255,i=(y*canvas.width+x)*4;imageData.data[i]=imageData.data[i+1]=imageData.data[i+2]=value;imageData.data[i+3]=255;}
 }
 ctx.putImageData(imageData,0,0);return canvas;
}

function financialField(item){return item.group==='income'||item.group==='deductions';}
export async function recognizeTemplate(pages,onProgress=()=>{},options={}){
 const {signal,job,financialOnly=false}=options;abortError(signal);if(pages.length!==2)throw Object.assign(Error('固定版面需要兩頁薪資單'),{code:'PAGE_COUNT'});
 const layout=await detectDownloadLayout(pages);if(!layout)throw Object.assign(Error('無法定位兩頁下載版表格的格線錨點；請保留完整表格、檢查方向，或改用通用辨識。'),{code:'LAYOUT_UNCONFIRMED'});
 const {images,incomePage,deductionPage,calibrations}=layout,calibrationFor=page=>page===incomePage?calibrations.income:calibrations.deductions;
 const started=performance.now();let worker,initCancelled=false;const create=Tesseract.createWorker('eng',1,{workerPath:new URL('vendor/tesseract/worker.min.js',base).href,corePath:new URL('vendor/core/',base).href,langPath:new URL('vendor/lang',base).href,cacheMethod:'none'});create.then(w=>{if(signal?.aborted||initCancelled)w.terminate();}).catch(()=>{});worker=await runWithCancel(create,60000,'ENGINE_INIT_TIMEOUT',signal,()=>worker);
 const r=blankRecord();r.company='';r.ocrMeta={fields:{},layout:{profileId:layout.profileId,roles:{income:incomePage,deductions:deductionPage},calibrations}};for(const item of r.items.filter(x=>x.group==='income'||x.group==='deductions')){item.state='unknown';item.ocrStatus='UNREAD';}const raw=[];let done=0,total=0,stopped=false;
 total=incomeColumns.reduce((n,c)=>n+c.length,0)+deductions.reduce((n,c)=>n+c.length,0)+totalCells.length+(financialOnly?0:8+24*2+5*2)+1;
 const ensureAlive=()=>{abortError(signal);if(performance.now()-started>300000)throw Object.assign(Error('OCR 工作超過 5 分鐘，已停止。'),{code:'JOB_TIMEOUT'});};
 async function runCell(page,rect,{group='totals',name='unknown',allowDecimal=false}={}){
   ensureAlive();const image=images[page],calibration=calibrationFor(page),crop=scaledRect(rect,calibration);if(crop[0]<0||crop[1]<0||crop[2]>image.width||crop[3]>image.height||crop[2]-crop[0]<8||crop[3]-crop[1]<6)throw Object.assign(Error('分格影像範圍或像素不足'),{code:'CROP_BOUNDS'});
   const attempts=[],financial=group==='income'||group==='deductions'||group==='totals';
   const recognizeAttempt=async attempt=>{
      ensureAlive();let cropCanvas;try{const pensionRescue=attempt===2&&group==='totals'&&name==='employerPension',emptyInput=attempts.length>0&&attempts.every(value=>value.status==='empty'),largeEmptyRetry=attempt===2&&emptyInput,finalRetry=attempt===3,faintRecovery=attempt===4,cropAttempt=pensionRescue?0:attempt===3?3:attempt,factor=largeEmptyRetry||finalRetry||faintRecovery?12:8,preserveColor=attempt===0&&!pensionRescue,psm=pensionRescue?'7':largeEmptyRetry?'7':finalRetry?'7':faintRecovery?'10':['7','7','13','7'][attempt],method=pensionRescue?'pension-gray-line':largeEmptyRetry?'adaptive-12x-line':finalRetry?'otsu-isolated-line':faintRecovery?'bright-threshold-225-line':['gray-line','otsu-line','adaptive-raw-line'][attempt];cropCanvas=makeCellCanvas(image,rect,cropAttempt,calibration,{factor,preserveColor});const effectivePsm=finalRetry&&cropCanvas.visionZeroCandidate?'10':psm;await runWithCancel(worker.setParameters({tessedit_pageseg_mode:effectivePsm,tessedit_char_whitelist:allowDecimal?'0123456789,.':'0123456789,'}),15000,'PARAMETERS_TIMEOUT',signal,()=>worker);const {data}=await runWithCancel(worker.recognize(cropCanvas.toDataURL('image/png')),15000,'CELL_TIMEOUT',signal,()=>worker);ensureAlive();const baseParsed=normalizeNumericCell(data.text,{allowDecimal}),visionZero=baseParsed.status==='empty'&&cropCanvas.visionZeroCandidate,parsed=visionZero?{...normalizeNumericCell('0'),raw:String(data.text||''),reason:'VISION_SINGLE_ZERO_NEEDS_CONFIRM'}:baseParsed,confidence=visionZero?35:faintRecovery?Math.min(64,Number(data.confidence)||0):Number(data.confidence)||0,item={method:visionZero?'vision-zero-contour':method,text:String(data.text||'').trim(),...parsed,confidence};attempts.push(item);
       if(job)traceField(job,{group,name,page:pages[page].originalPage||page+1,pageId:pages[page].pageId,rect:crop,raw:data.text,normalized:parsed.normalized,value:parsed.value,confidence,status:parsed.status==='parsed'&&confidence<85?'needsReview':parsed.status,reason:parsed.reason||null});
     }finally{cropCanvas?.remove();}
   };
   await recognizeAttempt(0);await recognizeAttempt(1);
   let selected=selectOcrCandidate(attempts);
   if(financial&&!selected.autoTrusted){await recognizeAttempt(2);selected=selectOcrCandidate(attempts);}
    if(financial&&!selected.autoTrusted){await recognizeAttempt(3);selected=selectOcrCandidate(attempts);}
    if(financial&&selected.value===null){await recognizeAttempt(4);selected=selectOcrCandidate(attempts);}
   const confidence=selected.confidence||0,status=selected.status,reason=selected.reason;
   raw.push({page:pages[page].originalPage||page+1,group,name,text:attempts.map(x=>x.text).join(' / '),value:selected.value,confidence,status,reason,candidates:selected.candidates});
   done++;onProgress(`分格 ${done}/${total} · ${name}`,Math.min(.98,done/total));return {value:selected.value,text:selected.normalized||selected.text||'',confidence,page:pages[page].originalPage||page+1,status,reason,autoTrusted:selected.autoTrusted,attempts:attempts.map(({method,text,normalized,value,confidence,status,reason})=>({method,text,normalized,value,confidence,status,reason})),candidates:selected.candidates};
 }
 try{
   await runWithCancel(worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,.'}),15000,'PARAMETERS_TIMEOUT',signal,()=>worker);
   const monthRect=[414,250,454,267],month=await runCell(incomePage,monthRect,{group:'basic',name:'month'});
   if(!/^20\d{2}(0[1-9]|1[0-2])$/.test(String(month.value)))throw Object.assign(Error('表格結構通過，但無法讀取年月欄位；請檢查裁切或改用通用辨識。'),{code:'MONTH_UNREADABLE'});
   r.month=String(month.value).slice(0,4)+'-'+String(month.value).slice(4);
   const ix=[[222,263],[385,425],[546,584]],dx=[[240,278],[403,439],[548,584]];
   const assignItem=async(group,name,page,rect,tax='unknown',decimal=false)=>{const v=await runCell(page,rect,{group,name,allowDecimal:decimal});let i=r.items.find(x=>x.group===group&&x.name===name);if(!i){i={id:crypto.randomUUID(),group,name,value:null,state:'unprovided',tax:'unknown',unit:group==='attendance'?'小時':'元',cumulative:null,paidHours:null,sourcePage:null,ocrValue:null,confidence:null,custom:true};r.items.push(i);r.ocrMeta.unmappedFields=[...(r.ocrMeta.unmappedFields||[]),{fieldId:fieldKey(group,name),page:v.page,reason:'NO_CONFIRMED_FIELD_MAPPING'}];}Object.assign(i,{value:v.value,state:v.value===null?'unknown':v.autoTrusted?'value':'unknown',ocrValue:v.value,ocrCandidates:v.candidates,ocrStatus:v.status==='parsed'?'PARSED':v.status==='needsReview'?'NEEDS_REVIEW':v.status.toUpperCase(),ocrReason:v.reason||null,sourcePage:v.page,sourcePageId:pages[page].pageId,sourceRect:scaledRect(rect,calibrationFor(page)),confidence:v.confidence,tax});r.ocrMeta.fields[fieldKey(group,name)]={status:v.status,page:v.page,pageId:pages[page].pageId,sourceRect:scaledRect(rect,calibrationFor(page)),confidence:v.confidence,reason:v.reason||null,ocrValue:v.value,candidates:v.candidates,attempts:v.attempts};return i;};
   for(let col=0;col<3;col++)for(let row=0;row<incomeColumns[col].length;row++)await assignItem('income',incomeColumns[col][row],incomePage,[ix[col][0],incomeRows[row]+3,ix[col][1],incomeRows[row+1]-3],freeCells.has(col+':'+row)?'free':'taxable');
   const notPrinted=r.items.find(x=>x.group==='income'&&x.name==='夜點費');if(notPrinted)Object.assign(notPrinted,{value:null,state:'unprovided',ocrValue:null,ocrCandidates:[],ocrStatus:'NOT_PRINTED_ON_LAYOUT',ocrReason:'FIELD_NOT_PRINTED_ON_SUPPORTED_LAYOUT',sourcePage:null,sourcePageId:null,sourceRect:null,confidence:null});
   for(let col=0;col<3;col++)for(let row=0;row<deductions[col].length;row++)await assignItem('deductions',deductions[col][row],deductionPage,[dx[col][0],283+row*30.3,dx[col][1],308+row*30.3]);
   for(const [key,role,rect] of totalCells){const page=role===0?incomePage:deductionPage;const v=await runCell(page,rect,{group:'totals',name:key});r.totals[key]=v.value;r.ocrMeta.fields[fieldKey('totals',key)]={status:v.status,page:v.page,pageId:pages[page].pageId,sourceRect:scaledRect(rect,calibrationFor(page)),confidence:v.confidence,reason:v.reason||null,ocrValue:v.value,candidates:v.candidates,attempts:v.attempts};}
   // This source layout does not print the separate advance-paid total.
   r.totals.advance=null;
   const absence=[['本薪',0,0],['作業津貼',0,1],['地區津貼',0,2],['經營津貼／效率獎金',1,0],['伙食津貼',1,1],['輪班津貼',1,2],['職務津貼',2,0],['交通津貼',2,1]],ax=[[222,263],[385,425],[546,584]];
   if(!financialOnly)for(const [name,col,row] of absence)await assignItem('absence',name,incomePage,[ax[col][0],875+row*30,ax[col][1],899+row*30]);
   const left=['病假','半假','曠職','公傷假','特休','撫育假','產假','喪假','安胎假','排休假','原住民族假','新進假'],right=['遲到','忘打卡','未帶卡','遺失卡','無薪假','生理假','家庭照顧假','婚假','陪產（檢）假','駐廠假','產檢假','健檢假'];
   if(!financialOnly){for(const [col,names] of [left,right].entries())for(let row=0;row<names.length;row++){const rect=col===0?[215,665+row*18,278,681+row*18]:[444,665+row*18,505,681+row*18],i=await assignItem('attendance',names[row],deductionPage,rect,'unknown',true);if(i){i.unit=col===1&&row<4?'次':'小時';const cumulative=await runCell(deductionPage,col===0?[281,665+row*18,357,681+row*18]:[509,665+row*18,583,681+row*18],{group:'attendance',name:names[row]+':cumulative',allowDecimal:true});i.cumulative=cumulative.value;}}
    for(const [name,col,row] of [['假日加班',0,0],['緊急入廠加班',0,1],['臨時加班（一）',1,0],['臨時加班（二）',1,1]]){const rect=col===0?[199,971+row*23,276,991+row*23]:[443,971+row*23,508,991+row*23],i=await assignItem('attendance',name,deductionPage,rect,'unknown',true);if(i){const p=await runCell(deductionPage,col===0?[281,971+row*23,357,991+row*23]:[513,971+row*23,583,991+row*23],{group:'attendance',name:name+':paidHours',allowDecimal:true});i.paidHours=p.value;}}
    const extra=await assignItem('attendance','特別臨時加班',deductionPage,[435,1218,508,1237],'unknown',true);if(extra)extra.paidHours=(await runCell(deductionPage,[513,1218,583,1237],{group:'attendance',name:'特別臨時加班:paidHours',allowDecimal:true})).value;}
   r.ocr=[1,2].map(page=>{const rows=raw.filter(x=>x.page===page);return {page,text:rows.map(x=>`${x.group}/${x.name}: ${x.text} [${Math.round(x.confidence)}%]${x.reason?` {${x.reason}}`:''}`).join('\n'),confidence:rows.length?rows.reduce((s,x)=>s+x.confidence,0)/rows.length:0};});
   const financialCount=r.items.filter(financialField).filter(i=>Number.isSafeInteger(i.value)).length+['gross','deduction','net','employerPension'].filter(k=>Number.isSafeInteger(r.totals[k])).length;
   if(!financialCount)throw Object.assign(Error('沒有讀到有效薪資金額。原圖已保留，請檢查圖片完整性或改用通用辨識。'),{code:'NO_FINANCIAL_VALUES'});
   r.notes='固定下載表格 OCR 草稿。請核對所有候選值、明示的 0、稅別與未讀欄位；空白不代表 0。';
   const sources=await Promise.all(pages.map(async(p,i)=>({name:p.name,page:i+1,data:(await transform(p)).toDataURL('image/png'),hash:p.hash})));r.sources=sources;
   onProgress('固定版面辨識完成',1);return r;
 }catch(error){stopped=true;if(!worker)initCancelled=true;throw error;}
 finally{try{await worker.terminate();}catch{}if(!stopped)onProgress('辨識完成',1);}
}

export {calibratePage as calibrateDownloadPage,makeCellCanvas as makeDownloadCellCanvas};
