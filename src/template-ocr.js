import {loadImage,transform} from './ocr.js';
import {blankRecord} from './core.js';
// Coordinates describe the supplied 691 x 1536 download-view screenshots, never amounts.
// This opt-in profile must not be used for a different screenshot layout.
const incomeRows=[362,398,429,459,490,521,552,582,612,665,695,727];
const incomeColumns=[
 ['本薪','交通津貼','地區津貼','輪班津貼','應稅臨時加班費','免稅臨時加班費','緊急入廠加班費','伙食津貼','醫療補助費','久任獎金','其他津貼'],
 ['經營津貼','職務津貼','作業津貼','作業用品代金','國定假日出勤獎金','假日加班費','特休未休代金','調任差旅津貼','工作獎金','春節出勤獎金','點心代金'],
 ['效率獎金','績效獎金','候傳補貼','服裝代金','應稅補發','免稅補發','公傷補償墊付款','擴建差旅津貼','颱風出勤獎金','回收津貼']
];
const deductions=[['所得稅','福利金','交通費','暫支薪資','福利類扣款','自提退休金','托兒所扣款','補充健保費'],['勞保費','工會費','伙食費','停車費','法院強制扣款','購股扣款','部門提撥基金'],['健保費','宿舍水電費','補扣','汽機車貸款','春節出勤獎金相關扣款','保證金','其他扣款']];
const freeCells=new Set(['0:5','0:6','0:7','1:5','1:6','2:5','2:6']); // '*' in the source form, not tax inference from names.
export async function recognizeTemplate(pages,onProgress){
 const images=await Promise.all(pages.map(p=>loadImage(p.original||p.data)));
 if(images.some(i=>Math.abs(i.width/i.height-691/1536)>.008)||pages.some(p=>p.rotation%360||p.crop.some((v,i)=>v!==[0,0,100,100][i])))throw Error('此版面僅適用原始 691:1536 比例、未裁切旋轉的兩張下載版截圖；其他版面請用通用辨識。');
 const base=new URL('../',import.meta.url),worker=await Tesseract.createWorker('eng',1,{workerPath:new URL('vendor/tesseract/worker.min.js',base).href,corePath:new URL('vendor/core/',base).href,langPath:new URL('vendor/lang',base).href,cacheMethod:'none'});
 const r=blankRecord();r.company='';const raw=[];let done=0;
 async function cell(page,rect,label,decimal=false){const img=images[page],c=document.createElement('canvas'),k=5;const [x0,y0,x1,y1]=rect.map((v,i)=>v*(i%2===0?img.width/691:img.height/1536));c.width=Math.round((x1-x0)*k)+40;c.height=Math.round((y1-y0)*k)+40;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,x0,y0,x1-x0,y1-y0,20,20,(x1-x0)*k,(y1-y0)*k);const pixels=ctx.getImageData(0,0,c.width,c.height);for(let n=0;n<pixels.data.length;n+=4){const v=(pixels.data[n]+pixels.data[n+1]+pixels.data[n+2])/3;const next=v;pixels.data[n]=pixels.data[n+1]=pixels.data[n+2]=next;}ctx.putImageData(pixels,0,0);const {data}=await worker.recognize(c.toDataURL('image/png'));const text=data.text.trim(),clean=text.replace(decimal?/[,，\s]/g:/[,.，\s]/g,''),value=(decimal?/^\d+(\.\d+)?$/:/^\d+$/).test(clean)?Number(clean):null;raw.push({page:page+1,label,text,value,confidence:data.confidence});onProgress('固定版面分格辨識：'+label,Math.min(.98,++done/150));return {value,text,confidence:data.confidence,page:page+1};}
 try{
 await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,.'});
 // Identify order with the expected YYYYMM cell. A failed header check blocks the profile.
 let month=await cell(0,[414,250,454,267],'所得年月');
 if(!/^20\d{2}(0[1-9]|1[0-2])$/.test(String(month.value))){images.reverse();month=await cell(0,[414,250,454,267],'所得年月（交換頁序）');}
 if(!/^20\d{2}(0[1-9]|1[0-2])$/.test(String(month.value)))throw Error('無法確認此固定版面的年月與頁序，請改用通用辨識或手動登錄。');
 r.month=String(month.value).slice(0,4)+'-'+String(month.value).slice(4);
 async function item(group,name,page,rect,tax='unknown',decimal=false){const v=await cell(page,rect,name,decimal),i=r.items.find(i=>i.group===group&&i.name===name);Object.assign(i,{value:v.value,state:v.value===null||v.confidence<60?'unknown':'value',ocrValue:v.value,sourcePage:v.page,confidence:v.confidence,tax});return i;}
 const ix=[[222,263],[385,425],[546,584]];
 for(let col=0;col<3;col++)for(let row=0;row<incomeColumns[col].length;row++)await item('income',incomeColumns[col][row],0,[ix[col][0],incomeRows[row]+3,ix[col][1],incomeRows[row+1]-3],freeCells.has(col+':'+row)?'free':'taxable');
 const dx=[[240,278],[403,439],[548,584]];
 for(let col=0;col<3;col++)for(let row=0;row<deductions[col].length;row++)await item('deductions',deductions[col][row],1,[dx[col][0],283+row*30.3,dx[col][1],308+row*30.3]);
 for(const [key,page,rect] of [['gross',0,[531,999,584,1024]],['taxable',0,[210,999,262,1024]],['taxFree',0,[374,999,424,1024]],['net',0,[514,288,583,308]],['absenceTotal',0,[532,967,583,992]],['deduction',1,[532,540,584,563]]])r.totals[key]=(await cell(page,rect,key)).value;
 // No advance total is printed in these screenshots. User must confirm it explicitly.
 r.totals.advance=null;
 for(const [name,col,row] of [['本薪',0,0],['作業津貼',0,1],['地區津貼',0,2],['經營津貼／效率獎金',1,0],['伙食津貼',1,1],['輪班津貼',1,2],['職務津貼',2,0],['交通津貼',2,1]])await item('absence',name,0,[ix[col][0],875+row*30,ix[col][1],899+row*30]);
 const left=['病假','半假','曠職','公傷假','特休','撫育假','產假','喪假','安胎假','排休假','原住民族假','新進假'],right=['遲到','忘打卡','未帶卡','遺失卡','無薪假','生理假','家庭照顧假','婚假','陪產（檢）假','駐廠假','產檢假','健檢假'];
 if(!r.items.some(i=>i.group==='attendance'&&i.name==='撫育假'))r.items.push({id:crypto.randomUUID(),group:'attendance',name:'撫育假',value:null,state:'unknown',tax:'unknown',unit:'小時',cumulative:null,paidHours:null,sourcePage:2,ocrValue:null,confidence:null});
 for(const [col,names] of [left,right].entries())for(let row=0;row<names.length;row++){const rect=col===0?[215,665+row*18,278,681+row*18]:[444,665+row*18,505,681+row*18];const i=await item('attendance',names[row],1,rect,'unknown',true);i.unit=col===1&&row<4?'次':'小時';i.cumulative=(await cell(1,col===0?[281,665+row*18,357,681+row*18]:[509,665+row*18,583,681+row*18],names[row]+'累計',true)).value;}
 for(const [name,col,row] of [['假日加班',0,0],['緊急入廠加班',0,1],['臨時加班（一）',1,0],['臨時加班（二）',1,1]]){const i=await item('attendance',name,1,col===0?[199,971+row*23,276,991+row*23]:[443,971+row*23,508,991+row*23],'unknown',true);i.paidHours=(await cell(1,col===0?[281,971+row*23,357,991+row*23]:[513,971+row*23,583,991+row*23],name+'計薪時數',true)).value;}
 const extra=await item('attendance','特別臨時加班',1,[435,1218,508,1237],'unknown',true);extra.paidHours=(await cell(1,[513,1218,583,1237],'特別臨時加班計薪時數',true)).value;
 for(const [key,rect] of [['employerPension',[197,1321,224,1336]],['employerCumulative',[317,1320,347,1337]],['selfCumulative',[446,1320,457,1337]]])r.totals[key]=(await cell(1,rect,key)).value;
 r.ocr=[{page:1,text:raw.filter(x=>x.page===1).map(x=>x.label+': '+x.text+' ['+Math.round(x.confidence)+'%]').join('\n'),confidence:raw.filter(x=>x.page===1).reduce((s,x)=>s+x.confidence,0)/raw.filter(x=>x.page===1).length},{page:2,text:raw.filter(x=>x.page===2).map(x=>x.label+': '+x.text+' ['+Math.round(x.confidence)+'%]').join('\n'),confidence:raw.filter(x=>x.page===2).reduce((s,x)=>s+x.confidence,0)/raw.filter(x=>x.page===2).length}];
 r.notes='固定版面 OCR 草稿。星號稅別依此樣本表格定義；請核對與原單是否一致。所有分格辨識值仍須逐項核對；未辨識欄位須補正。';
 const ordered=images.map(img=>pages.find(p=>(p.original||p.data)===img.src));
 r.sources=await Promise.all(ordered.map(async(p,i)=>({name:p.name,page:i+1,data:(await transform(p)).toDataURL('image/png'),hash:p.hash})));
 return r;
 }finally{await worker.terminate();}
}
