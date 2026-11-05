import {GROUPS,TOTALS,blankRecord,sample,validate,months,duplicates,csv,uid,assertRecord} from './core.js';
import * as DB from './db.js';
import {pack,unpack,mergePlan} from './backup.js';
import {readPages,transform,recognize,loadImage,selfTest} from './ocr.js';
import {recognizeTemplate,hasDownloadTableStructure} from './template-ocr.js';
import {makeOcrJob,summarizeOcrJob,classifyOcrRecord,fieldKey} from './ocr-diagnostics.js';
import {BUILD_META} from './build-meta.js';
import {getComposition,getMonthlySeries} from './charts.js';
import {renderComposition,renderLineChart,renderSeriesLegend} from './chart-view.js';
import {isStandalone,detectInstallEnvironment} from './install.js';
const $=s=>document.querySelector(s),app=$('#app'),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null||n===undefined?'—':n.toLocaleString('zh-TW');
const groupLabel={income:'應發薪資',deductions:'扣款明細',absence:'缺勤減發（不重複扣除）',attendance:'考勤與加班'};
let records=[],draft=null,pages=[],busy=false,restoreData=null,view='home',settings={companies:[],custom:[]},installPrompt,installOutcome='',activeOcr=null,ocrCheckpoint=null,ocrSession=null,ocrDiagnostic=null,ocrLocalTrace=[],selfTestState=null;
let localOcrLock=false;
async function withOcrLock(task){if(navigator.locks?.request)return navigator.locks.request('salarybook-ocr-worker',{ifAvailable:true},lock=>{if(!lock)throw Error('另一個薪資簿分頁正在使用 OCR，請稍候再試。');return task();});if(localOcrLock)throw Error('另一個 OCR 工作仍在執行，請稍候再試。');localOcrLock=true;try{return await task();}finally{localOcrLock=false;}}
let homeMonth='',homeMode='income',activeSlice=0,historyYear='',historyCompany='',historySort='desc',selectedHistoryMonth='',showSelectedMonth=false,visibleSeries=new Set(['gross','net']),refreshHistory=()=>{},refreshAnalytics=()=>{};
function toast(s){$('#toast').textContent=s;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5000);}
const installEntry=()=>isStandalone()?'<span class="badge app-mode-badge" role="status">正在使用 App 模式</span>':'<button class="primary install-entry" data-action="open-install">安裝到手機</button>';
function installPage(){
 const standalone=isStandalone(),environment=detectInstallEnvironment();
 let guide='';
 if(standalone)guide='<div class="notice good">你正從手機主畫面以 App 模式使用薪資簿。</div>';
 else if(environment.androidChrome){guide=installPrompt?'<p>Chrome 已準備好安裝。點選下方按鈕後，依系統畫面完成安裝。</p><button class="primary" data-action="install-now">安裝到手機</button>':`<p>在 Chrome 右上角點選「⋮」，再選擇「安裝應用程式」或「新增至主畫面」。選項名稱會依 Chrome 版本不同。</p>${installOutcome==='dismissed'?'<div class="notice">安裝視窗已關閉。你可以在 Chrome 選單中再次手動安裝。</div>':''}${installOutcome==='accepted'?'<div class="notice good">已送出安裝要求，請依系統畫面完成安裝。</div>':''}`;}
 else if(environment.iosSafari)guide='<ol><li>點 Safari 工具列的「分享」圖示。</li><li>向下找到「加入主畫面」。</li><li>確認名稱後點選「新增」，再從主畫面開啟薪資簿。</li></ol><p class="help">若未看到「加入主畫面」，請確認目前使用 Safari 開啟。</p>';
 else if(environment.ios)guide='<p>請使用 iPhone 或 iPad 的 Safari 開啟此網站，再點「分享」→「加入主畫面」。LINE 等 App 內建瀏覽器不支援完整安裝流程。</p>';
 else if(environment.android||environment.inApp)guide='<p>請點選瀏覽器選單中的「在 Chrome 開啟」或「使用系統瀏覽器開啟」，再從 Chrome 選單選擇「安裝應用程式」或「新增至主畫面」。LINE 等 App 內建瀏覽器不支援完整安裝流程。</p>';
 else guide='<p>請使用手機系統瀏覽器開啟此網站。Android 請使用 Chrome；iPhone 或 iPad 請使用 Safari，並透過瀏覽器選單將薪資簿加入主畫面。</p>';
 const installStatus=installStatusText();
 app.innerHTML=heading('安裝到手機','將薪資簿加到主畫面，之後可像 App 一樣開啟。')+`<div class="install-grid"><section class="card install-card"><div class="install-icon" aria-hidden="true">薪</div><h2>薪資簿 SalaryBook</h2><p class="install-status"><b>安裝狀態</b><span data-install-status>${installStatus}</span></p><div class="install-guide">${guide}</div>${standalone?'':'<a class="backup-shortcut" href="#settings">先備份資料 → 前往「資料與設定」</a>'}</section><section class="card install-card"><h2>離線使用狀態</h2><p data-offline-status class="offline-status" role="status">正在檢查離線資源…</p><p class="help">程式離線快取、OCR 語言模型與 PDF 資源分開顯示。到「資料與設定 → OCR 自檢與資源修復」準備離線辨識模型。</p></section><section class="card install-card"><h2>換裝置時記得備份</h2><p>薪資紀錄留存在目前裝置與瀏覽器。換手機、換瀏覽器或用不同方式開啟後，原有資料可能不會自動出現；請先在舊裝置下載備份，再到新裝置還原。</p><a class="backup-shortcut" href="#settings">前往備份與還原 →</a></section></div><div class="actions spaced"><a class="back-link" href="#home">返回薪資總覽</a></div>`;
 updateOfflineStatus();
}
function installStatusText(){
 if(isStandalone())return '正在使用 App 模式。';
 if(installOutcome==='installed')return '瀏覽器已回報安裝完成；請從主畫面開啟 App。';
 return '目前以瀏覽器分頁開啟。此頁無法確認你是否已在其他位置安裝。';
}
async function queryOfflineStatus(){
 if(!('serviceWorker'in navigator)||!('MessageChannel'in window))return {shellReady:false,groups:{fixed:false,generic:false,pdf:false}};
 let worker=navigator.serviceWorker.controller;
 if(!worker){const registration=await navigator.serviceWorker.ready.catch(()=>null);worker=registration?.active;}
 if(!worker)return {shellReady:false,groups:{fixed:false,generic:false,pdf:false}};
 return await new Promise(resolve=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>resolve({shellReady:false,groups:{fixed:false,generic:false,pdf:false}}),4000);
  channel.port1.onmessage=event=>{clearTimeout(timer);const d=event.data||{};resolve(d.type==='OFFLINE_STATUS'?d:{shellReady:Boolean(d.ready),groups:{fixed:false,generic:false,pdf:false}});};
  try{worker.postMessage({type:'OFFLINE_STATUS',buildId:BUILD_META.buildId},[channel.port2]);}catch{clearTimeout(timer);resolve({shellReady:false,groups:{fixed:false,generic:false,pdf:false}});}
 });
}
let offlineQuery=0;
function updateOfflineStatus(){
 const query=++offlineQuery;
 document.querySelectorAll('[data-install-status]').forEach(node=>node.textContent=installStatusText());
 const nodes=[...document.querySelectorAll('[data-offline-status]')],resourceNode=$('[data-resource-state]'),activate=$('[data-action="activate-update"]');
 if(!nodes.length&&!resourceNode)return;
 nodes.forEach(node=>node.textContent='正在檢查離線資源…');
 queryOfflineStatus().then(status=>{
  if(query!==offlineQuery)return;
  const shell=Boolean(status.shellReady),groups=status.groups||{};
  const message=`離線查閱：${shell?'已準備':'尚未準備'} · OCR下載表格：${groups.fixed?'已準備':'尚未準備'} · OCR通用中文：${groups.generic?'已準備':'尚未準備'} · PDF：${groups.pdf?'已準備':'尚未準備'}`;
  nodes.forEach(node=>{node.textContent=message;node.classList.toggle('ready',shell);});
  if(resourceNode)resourceNode.textContent=message;
  navigator.serviceWorker?.getRegistration().then(reg=>{if(activate)activate.hidden=!reg?.waiting;}