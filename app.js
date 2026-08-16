(() => {
'use strict';

const LS_KEY='bakery_os_state_v1', CLOUD_KEY='bakery_os_cloud_v1';
const UNITS=['גרם','ק"ג','מ"ל','ליטר','יחידה','חבילה','כפית','כף','כוס','קורט'];
const WEIGHT={'גרם':1,'ק"ג':1000}, VOLUME={'מ"ל':1,'ליטר':1000};
const STATUSES=['חדשה','מאושרת','בייצור','מוכנה','נמסרה','בוטלה'];
const SALES_EVENT_STATUSES=['מתוכנן','פעיל','הסתיים','בוטל'];
const SALES_UNITS=['שקיות','יחידות','עוגות','מגשים','מארזים'];
const PRODUCT_CATEGORIES=['עוגיות','עוגות','עוגות שמרים','חלות ולחמים','מאפים','מאפינס וקאפקייקס','קינוחים','טארטים ופאי','אחר'];
const INVOICE_STATUSES=['טיוטה','נשלחה','שולמה','בוטלה'];
const INVOICE_TYPES=['דרישת תשלום','חשבונית עסקה / פרופורמה','הצעת מחיר'];
const CATS=['יבשים','מקרר','קפואים','תוספות','אריזות','אחר'];
const TASK_TYPES={shop:'קניות',prep:'הכנה',sub:'תת־מתכון',bake:'אפייה',pack:'אריזה',delivery:'מסירה',clean:'ניקיון'};
let currentView='dashboard', cloud={client:null,user:null,channel:null,timer:null};
let selectedSalesEventId='', pendingImport=null, plannerWeekOffset=0, plannerMode='week', plannerDay=dayKey(new Date()), draggedTaskKey='', priceCatalogFilterTimer=null, touchPlanDrag=null, lastPlanDragEnd=0, taskCenterFilter='all';
const priceCatalogSearchCache=new WeakMap();

const empty=()=>({
  settings:{businessName:'Bakery Workspace',currency:'₪',distanceCostPerKm:1.5,ovens:1,ovenTrays:2,workStart:'08:00',workEnd:'18:00',planningBufferMin:120,weeklyAvailability:{0:[{start:'09:00',end:'13:00',available:true,label:'זמינה'}],1:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],2:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],3:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],4:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],5:[{start:'08:00',end:'13:00',available:true,label:'זמינה'}],6:[]},tabOrder:[]},
  invoiceProfile:{legalName:'',businessId:'',address:'',email:'',phone:'',vatRate:18,paymentTerms:'שוטף + 30',bankName:'',bankBranch:'',bankAccount:''},
  recipes:[],orders:[],salesEvents:[],invoices:[],invoiceSequence:1,todoItems:[],inventory:[],suppliers:[],priceImports:[],productionLogs:[],checkedTasks:{},checkedShopping:{},planOverrides:{},hiddenPlanTasks:{},manualTasks:[],aiMessages:[],updatedAt:null
});

function id(prefix='id'){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
function esc(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(n,d=2){return Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:d})}
function fmtQty(n,unit,d=2){return normalizedRecipeUnit(unit)==='גרם'?fmt(Math.round(Number(n||0)),0):fmt(n,d)}
function money(n){return `${fmt(n)} ${state.settings.currency||'₪'}`}
function dateText(value){if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('he-IL',{dateStyle:'short',timeStyle:String(value).includes('T')?'short':undefined})}
function dayKey(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return'';const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`}
function addDays(value,n){const d=new Date(value);d.setDate(d.getDate()+Number(n||0));return d}
function minutesFromTime(t){const [h,m]=String(t||'08:00').split(':').map(Number);return(h||0)*60+(m||0)}
function timeFromMinutes(m){m=Math.max(0,Math.round(m));return`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`}
function norm(q,u){if(WEIGHT[u])return{qty:Number(q||0)*WEIGHT[u],unit:'גרם'};if(VOLUME[u])return{qty:Number(q||0)*VOLUME[u],unit:'מ"ל'};return{qty:Number(q||0),unit:u}}
function showQty(q,u){const unit=normalizedRecipeUnit(u);if(unit==='גרם'&&Number(q)>=1000)return`${fmt(Number(q)/1000,2)} ק"ג`;if(unit==='גרם')return`${fmt(Math.round(Number(q||0)),0)} גרם`;if(unit==='מ"ל'&&Number(q)>=1000)return`${fmt(Number(q)/1000,2)} ליטר`;return`${fmt(q)} ${unit}`}
function salesUnitLabel(r){return SALES_UNITS.includes(r?.salesUnit)?r.salesUnit:'שקיות'}
function salesUnitSingular(unit){return({'שקיות':'שקית','יחידות':'יחידה','עוגות':'עוגה','מגשים':'מגש','מארזים':'מארז'})[unit]||'יחידה'}
function showShoppingQty(q,u){if(u==='גרם')return`${Math.ceil(Math.max(0,Number(q||0))).toLocaleString('he-IL')} גרם`;return showQty(q,u)}
function setStatus(text){const el=document.getElementById('saveStatus');if(el)el.textContent=text||''}
let saveFeedbackButton=null;
let modalDirty=false,modalPointerDown=null,modalPointerMoved=false,modalSuppressNextBackdropClick=false,modalSaveInProgress=false;
function showToast(text,type='success'){let box=document.getElementById('appToastStack');if(!box){box=document.createElement('div');box.id='appToastStack';box.className='toast-stack';document.body.appendChild(box)}const toast=document.createElement('div');toast.className=`app-toast ${type}`;toast.innerHTML=`<span>${type==='success'?'✓':'!'}</span><strong>${esc(text)}</strong>`;box.appendChild(toast);requestAnimationFrame(()=>toast.classList.add('show'));setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>toast.remove(),260)},2600)}
function showSaveOverlay(message='נשמר בהצלחה!',ok=true){
  let overlay=document.getElementById('saveSuccessOverlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');overlay.id='saveSuccessOverlay';overlay.className=`save-success-overlay ${ok?'success':'error'}`;
  overlay.innerHTML=`<div class="save-success-card"><div class="save-success-icon">${ok?'✓':'!'}</div><strong>${esc(message)}</strong></div>`;
  document.body.appendChild(overlay);requestAnimationFrame(()=>overlay.classList.add('show'));
  setTimeout(()=>{overlay.classList.remove('show');setTimeout(()=>overlay.remove(),260)},1450);
}
function finishSaveFeedback(ok=true,message='נשמר בהצלחה'){const button=saveFeedbackButton;saveFeedbackButton=null;if(button&&document.contains(button)){const original=button.dataset.saveOriginal||'שמירה';button.textContent=ok?'נשמר ✓':original;button.disabled=false;setTimeout(()=>{if(document.contains(button))button.textContent=original},1300)}showToast(message,ok?'success':'error');showSaveOverlay(ok?'נשמר בהצלחה!':message,ok)}


const HERO_MESSAGES=[
  {title:'אלונה, בואי נסדר את השבוע שלך בחכמה',text:'כל ההזמנות, המתכונים, תתי־המתכונים, המלאי והאריזה במקום אחד — כדי שתדעי בדיוק מה להכין ומתי.'},
  {title:'אלונה, הכול מוכן ליום אפייה מדויק ונעים יותר',text:'תכנון נכון של הכנות מוקדמות, אפייה, אריזה וקניות עוזר לך לעבוד רגוע יותר ולחסוך זמן.'},
  {title:'אלונה, היום שלך מתחיל בתמונה ברורה של כל המשימות',text:'פתחי הזמנה חדשה, בדקי מה חסר במלאי, או המשיכי ישר לתכנון השבועי ולסדר העבודה.'},
  {title:'אלונה, עוד צעד לעסק מסודר, יוקרתי ורווחי יותר',text:'המערכת מחברת בין ההזמנות והמתכונים כדי להפוך רעיונות לייצור מסודר ולמשלוחים בזמן.'}
];
const HERO_SESSION_KEY='bakery_workspace_hero_message_v1';
function heroMessageForSession(){
  let index=-1;
  try{index=Number(sessionStorage.getItem(HERO_SESSION_KEY))}catch(e){}
  if(!Number.isInteger(index)||index<0||index>=HERO_MESSAGES.length){
    index=Math.floor(Math.random()*HERO_MESSAGES.length);
    try{sessionStorage.setItem(HERO_SESSION_KEY,String(index))}catch(e){}
  }
  return HERO_MESSAGES[index];
}
function revealHeroMessage(){
  const el=document.querySelector('.hero-message');
  if(!el)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('is-visible')));
}

function migrateRecipe(raw){
  const r={...raw};
  r.ingredients=Array.isArray(r.ingredients)?r.ingredients:[];
  r.steps=Array.isArray(r.steps)?r.steps:[];
  r.bakingSteps=Array.isArray(r.bakingSteps)?r.bakingSteps:[];
  r.subRecipes=(Array.isArray(r.subRecipes)?r.subRecipes:[]).map((s,index)=>({
    id:s.id||id('sub'),name:s.name||`תת־מתכון ${index+1}`,ingredients:(Array.isArray(s.ingredients)?s.ingredients:[]).map(normalizeRecipeIngredient),steps:Array.isArray(s.steps)?s.steps:[],
    usedQtyGrams:Math.max(0,Math.round(Number(s.usedQtyGrams||0))),evaporationPct:Number(s.evaporationPct??0),prepMin:Number(s.prepMin||0),restMin:Number(s.restMin||0),bakeMin:Number(s.bakeMin||0),ovenTemp:Number(s.ovenTemp||0),notes:String(s.notes||'')
  }));
  r.recipeType=r.subRecipes.length?'composite':'simple';
  r.categoryManual=!!r.categoryManual;
  r.category=effectiveRecipeCategory(r);
  r.salesUnit=SALES_UNITS.includes(r.salesUnit)?r.salesUnit:'שקיות';
  const inferredCategory=recipeCategoryFromText(`${r.name||''} ${r.category||''}`);
  if(r.salesUnit==='שקיות'&&['עוגות','עוגות שמרים'].includes(inferredCategory))r.salesUnit='יחידות';
  r.packageWeight=Math.max(1,Math.round(Number(r.packageWeight||r.unitWeight||200)));
  r.yieldUnits=Math.max(0,Math.round(Number(r.yieldUnits||0)));
  r.evaporationPct=Number(r.evaporationPct??12);
  r.warnings=Array.isArray(r.warnings)?r.warnings:[];
  r.notes=String(r.notes||'');
  delete r.packagingCost;
  r.productionTasks=Array.isArray(r.productionTasks)?r.productionTasks.map((t,i)=>({id:t.id||id('flow'),title:String(t.title||t.text||`משימה ${i+1}`),type:t.type||inferTaskType(t.title||t.text||''),activeMin:Math.max(5,Number(t.activeMin??t.durationMin??20)),passiveMin:Math.max(0,Number(t.passiveMin||0)),daysBefore:Math.max(0,Math.floor(Number(t.daysBefore??t.canPrepareDays??0))),canPrepareDays:Math.max(0,Math.floor(Number(t.daysBefore??t.canPrepareDays??0))),preferredTime:String(t.preferredTime||t.time||''),freshnessDays:Math.max(0,Number(t.freshnessDays||r.shelfLifeDays||0)),dependsOn:String(t.dependsOn||''),notes:String(t.notes||''),isPreprep:!!t.isPreprep})):[];
  r.ingredients=r.ingredients.map(i=>{
    const item=normalizeRecipeIngredient(i);
    if(!item.linkedSubRecipeId){const match=r.subRecipes.find(s=>ingredientNamesMatch(item.name,s.name));if(match)item.linkedSubRecipeId=match.id}
    return item;
  });
  if(r.originalRecipeBase&&typeof r.originalRecipeBase==='object'){
    r.originalRecipeBase={...r.originalRecipeBase,
      ingredients:(Array.isArray(r.originalRecipeBase.ingredients)?r.originalRecipeBase.ingredients:[]).map(normalizeRecipeIngredient),
      subRecipes:(Array.isArray(r.originalRecipeBase.subRecipes)?r.originalRecipeBase.subRecipes:[]).map((s,index)=>({...s,id:s.id||id('sub'),name:s.name||`תת־מתכון ${index+1}`,usedQtyGrams:Math.max(0,Math.round(Number(s.usedQtyGrams||0))),ingredients:(Array.isArray(s.ingredients)?s.ingredients:[]).map(normalizeRecipeIngredient)}))
    };
  }
  return r;
}
function migrateState(raw){
  const base=empty(),x={...base,...(raw||{})};
  x.settings={...base.settings,...(raw?.settings||{})};
  x.settings.weeklyAvailability={...base.settings.weeklyAvailability,...(raw?.settings?.weeklyAvailability||{})};
  x.settings.tabOrder=(Array.isArray(raw?.settings?.tabOrder)?raw.settings.tabOrder:[]).filter(v=>v!=='todo');
  if(!x.settings.businessName||x.settings.businessName==='Bakery OS')x.settings.businessName='Bakery Workspace';
  x.recipes=(Array.isArray(raw?.recipes)?raw.recipes:[]).map(migrateRecipe);
  x.orders=Array.isArray(raw?.orders)?raw.orders:[];
  x.salesEvents=(Array.isArray(raw?.salesEvents)?raw.salesEvents:[]).map(event=>({
    id:event.id||id('event'),name:String(event.name||'אירוע מכירה'),eventAt:String(event.eventAt||''),status:SALES_EVENT_STATUSES.includes(event.status)?event.status:'מתוכנן',notes:String(event.notes||''),
    targets:{materialsBudget:Math.max(0,Number(event.targets?.materialsBudget||0)),extraBudget:Math.max(0,Number(event.targets?.extraBudget||0)),plannedHours:Math.max(0,Number(event.targets?.plannedHours||0)),revenueTarget:Math.max(0,Number(event.targets?.revenueTarget||0)),profitTarget:Math.max(0,Number(event.targets?.profitTarget||0))},
    items:(Array.isArray(event.items)?event.items:[]).map(item=>({recipeId:String(item.recipeId||''),targetQty:Math.max(0,Math.round(Number(item.targetQty||0))),unit:SALES_UNITS.includes(item.unit)?item.unit:'יחידות',unitPrice:Math.max(0,Number(item.unitPrice||0)),preparedQty:Math.max(0,Math.round(Number(item.preparedQty||0))),soldQty:Math.max(0,Math.round(Number(item.soldQty||0))),givenQty:Math.max(0,Math.round(Number(item.givenQty||0))),damagedQty:Math.max(0,Math.round(Number(item.damagedQty||0)))})),
    expenses:(Array.isArray(event.expenses)?event.expenses:[]).map(x=>({id:x.id||id('expense'),type:String(x.type||'אחר'),amount:Math.max(0,Number(x.amount||0)),note:String(x.note||'')})),
    workLogs:(Array.isArray(event.workLogs)?event.workLogs:[]).map(x=>({id:x.id||id('work'),recipeId:String(x.recipeId||''),start:String(x.start||''),end:String(x.end||''),description:String(x.description||'')})),
    hourlySales:(Array.isArray(event.hourlySales)?event.hourlySales:[]).map(x=>({id:x.id||id('hour'),time:String(x.time||''),amount:Math.max(0,Number(x.amount||0)),note:String(x.note||'')})),
    createdAt:event.createdAt||new Date().toISOString()
  }));
  x.invoiceProfile={...base.invoiceProfile,...(raw?.invoiceProfile||{})};
  x.invoices=(Array.isArray(raw?.invoices)?raw.invoices:[]).map(inv=>({...inv,items:Array.isArray(inv.items)?inv.items:[],seller:{...x.invoiceProfile,...(inv.seller||{})},vatRate:Number(inv.vatRate??x.invoiceProfile.vatRate??18),vatEnabled:inv.vatEnabled!==false,status:INVOICE_STATUSES.includes(inv.status)?inv.status:'טיוטה'}));
  x.invoiceSequence=Math.max(1,Number(raw?.invoiceSequence||1));
  x.todoItems=(Array.isArray(raw?.todoItems)?raw.todoItems:[]).map(item=>({id:item.id||id('todo'),text:String(item.text||'').trim(),done:!!item.done,priority:['נמוכה','רגילה','גבוהה'].includes(item.priority)?item.priority:'רגילה',dueDate:String(item.dueDate||''),notes:String(item.notes||''),plannerTime:String(item.plannerTime||''),plannerDuration:Math.max(5,Number(item.plannerDuration||30)),plannerPassiveMin:Math.max(0,Number(item.plannerPassiveMin||0)),plannerType:TASK_TYPES[item.plannerType]?item.plannerType:'prep',createdAt:item.createdAt||new Date().toISOString()}));
  x.inventory=(Array.isArray(raw?.inventory)?raw.inventory:[]).map(item=>{const i={...item};delete i.minPackageCount;delete i.minQty;delete i.costPerPackage;delete i.unitCost;delete i.batch;delete i.batchNumber;delete i.lot;const count=Math.max(0,Math.round(Number(i.packageCount??(Number(i.qty||0)>0?1:0)))),per=Math.max(0,Number(i.amountPerPackage??i.qty??0));i.packageCount=count;if(!Number.isFinite(Number(i.stockQty)))i.stockQty=count*per;else i.stockQty=Math.max(0,Math.round(Number(i.stockQty)));i.unit='גרם';return i}).filter(i=>!isWaterIngredient(i.name));
  x.suppliers=(Array.isArray(raw?.suppliers)?raw.suppliers:[]).map(s=>({...s,prices:(Array.isArray(s.prices)?s.prices:[]).map(p=>({...p,id:p.id||id('price')}))}));
  x.productionLogs=(Array.isArray(raw?.productionLogs)?raw.productionLogs:[]).map(log=>({...log,id:log.id||id('prodlog'),date:String(log.date||dayKey(new Date())),recipeRuns:Math.max(0,Number(log.recipeRuns??log.recipeRuns??1)),outputQty:Math.max(0,Number(log.outputQty||0)),outputUnit:String(log.outputUnit||'שקיות'),deductions:Array.isArray(log.deductions)?log.deductions:[],shortages:Array.isArray(log.shortages)?log.shortages:[]}));
  x.priceImports=Array.isArray(raw?.priceImports)?raw.priceImports:[];
  x.checkedTasks=raw?.checkedTasks&&typeof raw.checkedTasks==='object'?raw.checkedTasks:{};
  x.checkedShopping=raw?.checkedShopping&&typeof raw.checkedShopping==='object'?raw.checkedShopping:{};
  x.planOverrides=raw?.planOverrides&&typeof raw.planOverrides==='object'?raw.planOverrides:{};
  x.hiddenPlanTasks=raw?.hiddenPlanTasks&&typeof raw.hiddenPlanTasks==='object'?raw.hiddenPlanTasks:{};
  x.manualTasks=Array.isArray(raw?.manualTasks)?raw.manualTasks:[];
  x.aiMessages=(Array.isArray(raw?.aiMessages)?raw.aiMessages:[]).slice(-40).map(m=>({id:m.id||id('aimsg'),role:m.role==='assistant'?'assistant':'user',text:String(m.text||''),createdAt:m.createdAt||new Date().toISOString(),action:m.action&&typeof m.action==='object'?m.action:null}));
  return x;
}
function bytesToBase64(bytes){let bin='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(bin)}
function base64ToBytes(text){const bin=atob(text),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function encodeLocalState(value){const json=JSON.stringify(value);if(typeof pako==='undefined')return json;try{return'gz:'+bytesToBase64(pako.deflate(json))}catch(e){console.warn('compression failed',e);return json}}
function decodeLocalState(raw){if(!raw)return null;if(!raw.startsWith('gz:'))return JSON.parse(raw);if(typeof pako==='undefined')throw new Error('pako unavailable');const json=pako.inflate(base64ToBytes(raw.slice(3)),{to:'string'});return JSON.parse(json)}
function load(){try{return migrateState(decodeLocalState(localStorage.getItem(LS_KEY)))}catch(e){console.warn(e);return empty()}}
let state=load();
function localStateSnapshot(){return{...state,priceImports:(state.priceImports||[]).map(imp=>({...imp,items:[]})),aiMessages:(state.aiMessages||[]).slice(-10)}}
function saveLocalSnapshot(){
  const snapshot=localStateSnapshot(),old=(()=>{try{return localStorage.getItem(LS_KEY)}catch(_e){return null}})();
  try{
    const compact=encodeLocalState(snapshot);
    localStorage.setItem(LS_KEY,compact);return true
  }catch(firstError){
    console.warn('compact local save failed, retrying after cleanup',firstError);
    try{
      for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&/^bakery_os_state_/i.test(key)&&key!==LS_KEY)localStorage.removeItem(key)}
      localStorage.removeItem(LS_KEY);
      localStorage.setItem(LS_KEY,JSON.stringify(snapshot));return true
    }catch(secondError){
      console.error(secondError);try{if(old!==null)localStorage.setItem(LS_KEY,old)}catch(_restore){}return false
    }
  }
}

const DEVICE_DB='bakery_workspace_device_v1',DEVICE_STORE='snapshots',DEVICE_STATE_KEY='current';
function openDeviceDB(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB'in window))return reject(new Error('IndexedDB unavailable'));
    const request=indexedDB.open(DEVICE_DB,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(DEVICE_STORE))db.createObjectStore(DEVICE_STORE)};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
  });
}
async function saveIndexedSnapshot(snapshot=localStateSnapshot()){
  let db;try{db=await openDeviceDB();return await new Promise((resolve,reject)=>{const tx=db.transaction(DEVICE_STORE,'readwrite');tx.objectStore(DEVICE_STORE).put(snapshot,DEVICE_STATE_KEY);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('IndexedDB save failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB save aborted'))})}catch(error){console.warn('IndexedDB backup failed',error);return false}finally{try{db?.close()}catch(_e){}}
}
async function loadIndexedSnapshot(){
  let db;try{db=await openDeviceDB();return await new Promise((resolve,reject)=>{const tx=db.transaction(DEVICE_STORE,'readonly'),request=tx.objectStore(DEVICE_STORE).get(DEVICE_STATE_KEY);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error||new Error('IndexedDB read failed'))})}catch(error){console.warn('IndexedDB restore unavailable',error);return null}finally{try{db?.close()}catch(_e){}}
}
async function restoreDeviceSnapshot(){
  const backup=await loadIndexedSnapshot();if(!backup)return false;
  const localTime=Date.parse(state.updatedAt||0)||0,backupTime=Date.parse(backup.updatedAt||0)||0;
  if(!hasBusinessData(state)||backupTime>localTime){state=migrateState(backup);saveLocalSnapshot();return true}return false;
}

async function persist(sync=true){
  state.updatedAt=new Date().toISOString();
  const snapshot=localStateSnapshot(),localOk=saveLocalSnapshot(),indexedOk=await saveIndexedSnapshot(snapshot),deviceOk=localOk||indexedOk,cloudAttempted=!!(sync&&cloud.user);
  if(deviceOk){
    modalDirty=false;setStatus('✓ נשמר');setTimeout(()=>setStatus(''),1200);
    if(saveFeedbackButton)finishSaveFeedback(true,'נשמר בהצלחה');
    if(cloudAttempted){
      pushCloud().then(ok=>{if(!ok){setStatus('⚠ נשמר במכשיר, הסנכרון לענן נכשל');showToast('נשמר במכשיר; הסנכרון לענן ינסה שוב','error')}}).catch(error=>{console.error('background cloud save failed',error);setStatus('⚠ נשמר במכשיר, הסנכרון לענן נכשל')});
    }
    return true;
  }
  let cloudOk=false;
  if(cloudAttempted){try{cloudOk=await pushCloud()}catch(error){console.error('cloud save failed',error);cloudOk=false}}
  if(cloudOk){modalDirty=false;setStatus('✓ נשמר בענן');showToast('נשמר בענן ✓','success');showSaveOverlay('נשמר בענן ✓',true)}
  else{setStatus('⚠ השמירה נכשלה');showToast('השמירה נכשלה','error');showSaveOverlay('השמירה נכשלה',false)}
  if(saveFeedbackButton){if(cloudOk)finishSaveFeedback(true,'נשמר בענן');else finishSaveFeedback(false,'השמירה נכשלה')}
  return cloudOk;
}
async function pushCloud(){if(!cloud.user||!cloud.client)return false;const stamp=state.updatedAt||new Date().toISOString();state.updatedAt=stamp;const {error}=await cloud.client.from('bakery_os_data').upsert({user_id:cloud.user.id,data:state,updated_at:stamp},{onConflict:'user_id'});if(error){console.error(error);setStatus('⚠ השמירה בענן נכשלה');return false}return true}
async function pullCloud(show=true){if(!cloud.user||!cloud.client)return;if(show)setStatus('טוען מהענן…');const {data,error}=await cloud.client.from('bakery_os_data').select('data,updated_at').eq('user_id',cloud.user.id).maybeSingle();if(error){if(show)setStatus('⚠ שגיאת טעינה');console.error(error);return}if(data?.data){if(remoteIsNewer(data.updated_at)||!hasBusinessData(state))applyRemote(data.data,data.updated_at,show);else if(show){setStatus('✓ כבר מעודכן');setTimeout(()=>setStatus(''),1200)}}}
function stopCloudSync(){if(cloud.channel&&cloud.client)cloud.client.removeChannel(cloud.channel);cloud.channel=null;if(cloud.timer)clearInterval(cloud.timer);cloud.timer=null}
function startCloudSync(){stopCloudSync();if(!cloud.user||!cloud.client)return;cloud.channel=cloud.client.channel('bakery-os-'+cloud.user.id).on('postgres_changes',{event:'*',schema:'public',table:'bakery_os_data',filter:'user_id=eq.'+cloud.user.id},payload=>{const row=payload.new;if(row?.data&&remoteIsNewer(row.updated_at))applyRemote(row.data,row.updated_at,true)}).subscribe();cloud.timer=setInterval(()=>{if(document.visibilityState==='visible')pullCloud(false)},15000)}
async function initSession(){if(!initCloud())return;const {data,error}=await cloud.client.auth.getSession();if(error){console.warn('Session restore failed',error);return}cloud.user=data?.session?.user||null;if(cloud.user){setStatus('מתחברת לענן…');await initialCloudSync();startCloudSync();setStatus('✓ מחוברת לענן');setTimeout(()=>setStatus(''),1400)}}
function exportData(){const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bakery-os-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href)}
async function importData(file){try{state=migrateState(JSON.parse(await file.text()));await persist();render();alert('הנתונים יובאו')}catch(e){alert('קובץ לא תקין')}}

window.App={
  askAI:assistantQuickQuestion,sendAI:sendAssistantMessage,confirmAIAction,dismissAIAction,clearAIChat,
  go,openPlanner,close,setTaskCenterFilter,
  newTodo:()=>todoForm(),editTodo:x=>todoForm(state.todoItems.find(t=>t.id===x)||{}),toggleTodo:async x=>{const item=state.todoItems.find(t=>t.id===x);if(item){item.done=!item.done;await persist();render()}},deleteTodo:async x=>{if(confirm('למחוק את המשימה?')){state.todoItems=state.todoItems.filter(t=>t.id!==x);await persist();render()}},clearCompletedTodos:async()=>{if(confirm('למחוק את כל המשימות שסומנו כהושלמו?')){state.todoItems=state.todoItems.filter(t=>!t.done);await persist();render()}},
  newOrder:()=>orderForm(),editOrder:x=>orderForm(state.orders.find(o=>o.id===x)),newSalesEvent:()=>salesEventForm(),editSalesEvent:x=>salesEventForm(state.salesEvents.find(e=>e.id===x)),selectSalesEvent,addSalesExpense,deleteSalesExpense,startSalesWork,stopSalesWork,addSalesWorkLog,addHourlySale,addSalesEventItem:()=>document.getElementById('salesEventItems').insertAdjacentHTML('beforeend',salesEventItemRow({})),syncSalesEventItem,deleteSalesEvent:async x=>{if(confirm('למחוק את אירוע המכירה?')){state.salesEvents=state.salesEvents.filter(e=>e.id!==x);await persist();render()}},repeatOrderNextWeek,deleteOrder:async x=>{if(confirm('למחוק את ההזמנה?')){state.orders=state.orders.filter(o=>o.id!==x);await persist();render()}},addOrderItem:()=>document.getElementById('orderItems').insertAdjacentHTML('beforeend',orderRow({recipeId:'',qty:1})),
  newInvoice:()=>invoiceForm(),editInvoice:x=>invoiceForm(state.invoices.find(i=>i.id===x)),invoiceFromOrder,addInvoiceItem:()=>{document.getElementById('invoiceItems').insertAdjacentHTML('beforeend',invoiceItemRow());updateInvoicePreview()},updateInvoicePreview,printInvoice,deleteInvoice:async x=>{if(confirm('למחוק את המסמך?')){state.invoices=state.invoices.filter(i=>i.id!==x);await persist();render()}},
  filterRecipeCards,setRecipeCategory,recipeCostBreakdown,editRecipeStep,editRecipeEditorStep,refreshRecipeEditorSteps,autoSuggestRecipeCategory,markRecipeCategoryManual,newRecipe:()=>recipeForm(),editRecipe:x=>recipeForm(state.recipes.find(r=>r.id===x)),showRecipeEditorStep,setRecipeEditMode,moveRecipeEditor,deleteRecipe:async x=>{if(confirm('למחוק את המתכון?')){state.recipes=state.recipes.filter(r=>r.id!==x);await persist();render()}},
  addIngredient:()=>{document.getElementById('recipeIngredients').insertAdjacentHTML('beforeend',ingredientRow({name:'',qty:'',unit:'גרם',category:'אחר'}));updateRecipeWeightPreview()},removeIngredient:b=>{b.closest('.ingredient-row').remove();updateRecipeWeightPreview()},roundIngredientInput,syncIngredientUnit,addStep:()=>document.getElementById('recipeSteps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:1,time:'',durationMin:0})),addBakingStep:()=>document.getElementById('recipeBakingSteps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:0,time:'',durationMin:0})),addRecipeOrderTask:()=>{document.querySelector('.recipe-task-empty')?.remove();document.getElementById('recipeOrderTasks').insertAdjacentHTML('beforeend',recipeOrderTaskRow({title:'',daysBefore:1,activeMin:20,preferredTime:'',notes:''}))},
  addSubRecipe:()=>{document.getElementById('subRecipes').insertAdjacentHTML('beforeend',subRecipeCard());updateRecipeWeightPreview()},addSubIngredient:b=>{b.parentElement.querySelector('.sub-ingredients').insertAdjacentHTML('beforeend',ingredientRow({name:'',qty:'',unit:'גרם',category:'אחר'},true));updateRecipeWeightPreview()},addSubStep:b=>b.parentElement.querySelector('.sub-steps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:3,time:'',durationMin:0},true)),updateRecipeWeightPreview,
  weightCalc:x=>weightCalculator(state.recipes.find(r=>r.id===x)),saveRecipeScale:saveScaledRecipe,resetRecipeOriginal:resetRecipeToOriginal,scaleMode:(mode,button)=>{window.__scaleMode=mode;document.getElementById('scaleWeightField').hidden=mode!=='weight';document.getElementById('scaleBagsField').hidden=mode!=='bags';button.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));window.__updateScale?.()},
  importRecipe:importRecipeModal,analyzeRecipeImport,openPendingRecipe:()=>{const r=pendingImport;pendingImport=null;close();recipeForm(r)},filterRecipeBook,openBookRecipe,openSubRecipeFromIngredient,switchBookPane:(pane,button)=>{document.querySelectorAll('.book-pane').forEach(x=>x.classList.toggle('active',x.id===`book-${pane}`));button.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button))},copyRecipe:async x=>{const r=recipe(x);try{await navigator.clipboard.writeText(recipePlainText(r));setStatus('✓ המתכון הועתק')}catch(e){alert(recipePlainText(r))}},
  toggleTask:async k=>{if(String(k).startsWith('todo:')){const item=state.todoItems.find(x=>`todo:${x.id}`===k);if(item)item.done=!item.done}else state.checkedTasks[k]=!state.checkedTasks[k];await persist();render()},toggleShopping:async k=>{state.checkedShopping[k]=!state.checkedShopping[k];await persist();render()},
  scrollTabs,editAvailability:availabilityModal,addAvailability:day=>document.getElementById(`avail-${day}`).insertAdjacentHTML('beforeend',availabilityRow(day)),workflowEditor,addWorkflowTask:()=>document.getElementById('workflowRows').insertAdjacentHTML('beforeend',workflowRow()),editTabOrder:tabOrderEditor,saveTabOrder:async()=>{state.settings.tabOrder=[...document.querySelectorAll('#tabOrderList .tab-order-item')].map(x=>x.dataset.view);await persist();close();initTabOrder();render()},resetTabOrder:async()=>{state.settings.tabOrder=[];await persist();location.reload()},
  plannerPrev:()=>{plannerWeekOffset--;render()},plannerNext:()=>{plannerWeekOffset++;render()},plannerToday:()=>{plannerWeekOffset=0;plannerDay=dayKey(new Date());render()},setPlannerMode:m=>{plannerMode=m;render()},setPlannerDay:d=>{plannerDay=d;render()},buildPlan:async()=>{state.planOverrides={};await persist();render();setStatus('✓ התוכנית נבנתה מחדש')},newManualTask:manualTaskForm,editPlanTask,deletePlanTask,dragPlanTask:(e,key)=>{draggedTaskKey=key;e.dataTransfer.setData('text/plain',key);e.dataTransfer.effectAllowed='move'},dragOverPlanTask,dropPlanTaskAt,clearPlannerDropHint,startTouchPlanDrag,moveTouchPlanDrag,endTouchPlanDrag,deleteManualTask:deletePlanTask,
  newInventory:()=>inventoryForm(),editInventory:x=>inventoryForm(state.inventory.find(i=>i.id===x)),adjustInventory,setInventoryCount,productionSummary:productionSummaryForm,undoProductionLog,deleteInventory:async x=>{if(confirm('למחוק את הפריט?')){state.inventory=state.inventory.filter(i=>i.id!==x);await persist();render()}},
  newSupplier:()=>supplierForm(),editSupplier:x=>supplierForm(state.suppliers.find(s=>s.id===x)),syncSupplierPriceUnit,deleteSupplier:async x=>{if(confirm('למחוק את הספק?')){state.suppliers=state.suppliers.filter(s=>s.id!==x);await persist();render()}},addPrice:()=>document.getElementById('supplierPrices').insertAdjacentHTML('beforeend',priceRow({id:id('price'),ingredient:'',packQty:1,unit:'ק"ג',packPrice:0})),
  filterPriceCatalog,schedulePriceCatalogFilter,setPrivateBrandFilter,clearPriceCatalogFilters,linkCatalogProduct,deletePriceImport:async x=>{if(confirm('למחוק את קובץ המחירים שיובא?')){state.priceImports=state.priceImports.filter(i=>i.id!==x);await persist();render()}},
  exportData,cloudLogin:()=>cloudAuth('login'),cloudSignup:()=>cloudAuth('signup'),pullCloud,logout:async()=>{stopCloudSync();if(cloud.client)await cloud.client.auth.signOut();cloud.user=null;setStatus('התנתקת מהענן');render()},resetAll:async()=>{if(confirm('למחוק את כל הנתונים?')){state=empty();await persist(false);render()}}
};


window.__BakeryModalDiagnostics=()=>({open:document.getElementById('modal')?.classList.contains('open')||false,dirty:modalDirty,saving:modalSaveInProgress,suppressBackdrop:modalSuppressNextBackdropClick});
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.view));
const tabsEl=document.getElementById('tabs');
if(tabsEl){tabsEl.addEventListener('scroll',updateTabScrollButtons,{passive:true});tabsEl.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();tabsEl.scrollLeft+=e.deltaY;}},{passive:false});window.addEventListener('resize',updateTabScrollButtons);setTimeout(updateTabScrollButtons,120);} 
document.addEventListener('submit',e=>{const button=e.submitter||e.target.querySelector('button[type=submit],button:not([type])');if(!button)return;saveFeedbackButton=button;if(!button.dataset.saveOriginal)button.dataset.saveOriginal=button.textContent.trim()||'שמירה';button.textContent='שומרת…';button.disabled=true;setTimeout(()=>{if(saveFeedbackButton===button){button.disabled=false;button.textContent=button.dataset.saveOriginal;saveFeedbackButton=null}},5000)},true);
document.getElementById('modalClose').onclick=()=>close();
const modalRoot=document.getElementById('modal'),modalBody=document.getElementById('modalBody');
modalRoot.addEventListener('pointerdown',modalPointerStart,true);
modalRoot.addEventListener('pointermove',modalPointerMove,true);
modalRoot.addEventListener('pointerup',modalPointerEnd,true);
modalRoot.addEventListener('pointercancel',()=>{modalPointerDown=null;modalPointerMoved=false},true);
modalRoot.addEventListener('click',modalBackdropClick);
modalBody.addEventListener('input',markModalDirty,true);
modalBody.addEventListener('change',markModalDirty,true);
modalBody.addEventListener('click',e=>{if(e.target.closest('button')&&!e.target.closest('button[type=submit]')&&!e.target.closest('[data-no-dirty]')){const b=e.target.closest('button');if(!/ביטול|סגירה|חזרה/.test(b.textContent||''))setTimeout(markModalDirty,0)}},true);
document.getElementById('backupBtn').onclick=exportData;document.getElementById('cloudBtn').onclick=()=>go('settings');
document.getElementById('importFile').onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=''};document.getElementById('ramiImportFile').onchange=e=>{if(e.target.files[0])importRamiFile(e.target.files[0]);e.target.value=''};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloud.user)pullCloud(false)});window.addEventListener('focus',()=>{if(cloud.user)pullCloud(false)});window.addEventListener('online',()=>{if(cloud.user)pullCloud(false)});
function showAppUpdate(registration){
  if(document.getElementById('appUpdateBanner'))return;
  const banner=document.createElement('div');
  banner.id='appUpdateBanner';banner.className='app-update-banner';
  banner.innerHTML='<div><strong>זמינה גרסה חדשה</strong><span>לחצי לעדכון. הנתונים שלך יישמרו.</span></div><button type="button">עדכון עכשיו</button>';
  banner.querySelector('button').onclick=()=>{
    banner.classList.add('is-updating');
    banner.querySelector('button').textContent='מעדכנת…';
    if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
    else registration.update().catch(()=>{});
  };
  document.body.appendChild(banner);
}
function initServiceWorkerUpdates(){
  if(!('serviceWorker'in navigator))return;
  let refreshing=false,registrationRef=null;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(refreshing)return;refreshing=true;
    window.location.reload();
  });
  const inspect=registration=>{
    registrationRef=registration;
    if(registration.waiting&&navigator.serviceWorker.controller)showAppUpdate(registration);
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;if(!worker)return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed'&&navigator.serviceWorker.controller)showAppUpdate(registration);
      });
    });
  };
  window.addEventListener('load',async()=>{
    try{
      const registration=await navigator.serviceWorker.register('./sw.js?v=1231',{updateViaCache:'none'});
      inspect(registration);
      await registration.update();
      const check=()=>registrationRef?.update().catch(()=>{});
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
      window.addEventListener('focus',check);
      window.addEventListener('online',check);
      setInterval(check,30*60*1000);
    }catch(error){console.warn('Service worker update check failed',error)}
  });
}
initServiceWorkerUpdates();
initTabOrder();restoreDeviceSnapshot().catch(()=>false).then(()=>initSession()).finally(render);
})();
