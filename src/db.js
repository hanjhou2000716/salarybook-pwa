const DB='salarybook-v1';
let opened;
export function db(){return opened??=new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{q.result.createObjectStore('records',{keyPath:'id'});q.result.createObjectStore('images',{keyPath:'id'});q.result.createObjectStore('settings',{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function tx(stores,mode,fn){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(stores,mode);let result;try{result=fn(t);}catch(e){t.abort();reject(e);return;}t.oncomplete=()=>resolve(typeof result==='function'?result():result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('儲存已取消'));});}
export async function all(){return tx(['records','images'],'readonly',t=>{const a=t.objectStore('records').getAll(),b=t.objectStore('images').getAll();return ()=>a.result.map(r=>({...r,sources:b.result.find(x=>x.id===r.id)?.sources||[]}));});}
export async function save(r){await tx(['records','images'],'readwrite',t=>{const {sources,...record}=r;t.objectStore('records').put(record);t.objectStore('images').put({id:r.id,sources});});}
export async function remove(id){await tx(['records','images'],'readwrite',t=>{t.objectStore('records').delete(id);t.objectStore('images').delete(id);});}
export async function restore(records,replace){await tx(['records','images'],'readwrite',t=>{if(replace){t.objectStore('records').clear();t.objectStore('images').clear();}for(const r of records){const {sources,...record}=r;t.objectStore('records').put(record);t.objectStore('images').put({id:r.id,sources});}});}
export async function setting(id,value){return tx(['settings'],value===undefined?'readonly':'readwrite',t=>{const s=t.objectStore('settings');if(value!==undefined){s.put({id,value});return value;}const q=s.get(id);return ()=>q.result?.value;});}
export const saveOcrCheckpoint=value=>setting('ocr-draft-v1',value);
export const loadOcrCheckpoint=()=>setting('ocr-draft-v1');
export const clearOcrCheckpoint=()=>tx(['settings'],'readwrite',t=>t.objectStore('settings').delete('ocr-draft-v1'));
