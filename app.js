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
let pendingImport=null, plannerWeekOffset=0, plannerMode='week', plannerDay=dayKey(new Date()), draggedTaskKey='', priceCatalogFilterTimer=null, touchPlanDrag=null, lastPlanDragEnd=0, taskCenterFilter='all';
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
  x.salesEvents=(Array.isArray(raw?.salesEvents)?raw.salesEvents:[]).map(event=>({id:event.id||id('event'),name:String(event.name||'אירוע מכירה'),eventAt:String(event.eventAt||''),status:SALES_EVENT_STATUSES.includes(event.status)?event.status:'מתוכנן',notes:String(event.notes||''),items:(Array.isArray(event.items)?event.items:[]).map(item=>({recipeId:String(item.recipeId||''),targetQty:Math.max(0,Math.round(Number(item.targetQty||0))),unit:SALES_UNITS.includes(item.unit)?item.unit:'יחידות',unitPrice:Math.max(0,Number(item.unitPrice||0)),preparedQty:Math.max(0,Math.round(Number(item.preparedQty||0))),soldQty:Math.max(0,Math.round(Number(item.soldQty||0)))})),createdAt:event.createdAt||new Date().toISOString()}));
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
function load(){try{return migrateState(JSON.parse(localStorage.getItem(LS_KEY)||'null'))}catch(e){console.warn(e);return empty()}}
let state=load();
function localStateSnapshot(){return{...state,priceImports:(state.priceImports||[]).map(imp=>({...imp,items:[]}))}}

async function persist(sync=true){
  state.updatedAt=new Date().toISOString();
  let localOk=true,cloudOk=true;
  try{
    localStorage.setItem(LS_KEY,JSON.stringify(localStateSnapshot()));setStatus('✓ נשמר');setTimeout(()=>setStatus(''),1200)
  }catch(e){localOk=false;console.error(e);setStatus('⚠ אין מקום לשמירה מקומית');showToast('השמירה המקומית נכשלה','error');showSaveOverlay('השמירה נכשלה',false)}
  if(sync&&cloud.user)cloudOk=await pushCloud();
  if(saveFeedbackButton){
    if(localOk&&cloudOk)finishSaveFeedback(true,'נשמר בהצלחה');
    else if(localOk&&!cloudOk)finishSaveFeedback(false,'נשמר במכשיר, אך השמירה בענן נכשלה');
    else finishSaveFeedback(false,'השמירה נכשלה');
  }
  return localOk&&cloudOk;
}

/* מנוע משקל והמרות. ערכי נפח ביתיים הם קירובים; גרמים מפורשים תמיד גוברים. */
const INGREDIENT_PROFILES=[
{keys:['חלבון ביצה','חלבוני ביצה','חלבונים','egg white'],water:.88,unitWeight:33,tspGrams:5.2,tbspGrams:15.5,cupGrams:248},
{keys:['חלמון','חלמונים','egg yolk'],water:.50,unitWeight:18,tspGrams:5.7,tbspGrams:17,cupGrams:272},
{keys:['ביצה גדולה','ביצה l','ביצת l','large egg'],water:.74,unitWeight:50},
{keys:['ביצה','ביצים','egg'],water:.74,unitWeight:50},
{keys:['מלח דק','מלח שולחן','מלח','salt'],water:0,tspGrams:6,tbspGrams:18,cupGrams:288,pinchGrams:.35},
{keys:['סודה לשתייה','סודה לשתיה','baking soda'],water:0,tspGrams:4.6,tbspGrams:13.8,cupGrams:221,pinchGrams:.25},
{keys:['אבקת אפייה','אבקת אפיה','baking powder'],water:0,tspGrams:4,tbspGrams:12,cupGrams:192,pinchGrams:.25},
{keys:['תמצית וניל','vanilla extract'],density:.95,water:.65,tspGrams:4.2,tbspGrams:12.6,cupGrams:202},
{keys:['גלוקוזה','סירופ גלוקוז','סירופ תירס','corn syrup','glucose syrup'],density:1.38,water:.20,tspGrams:6.9,tbspGrams:20.7,cupGrams:331},
{keys:['טופי בייטס','שבבי טופי','toffee bits'],water:0,tspGrams:3.5,tbspGrams:10.5,cupGrams:168},
{keys:['סוכר חום כהה','סוכר חום דביק','סוכר חום','brown sugar'],water:.02,tspGrams:4.6,tbspGrams:13.8,cupGrams:220},
{keys:['סוכר לבן','סוכר','white sugar','granulated sugar'],water:0,tspGrams:4.2,tbspGrams:12.5,cupGrams:200},
{keys:['קמח חיטה','קמח לבן','קמח','flour'],water:.12,tspGrams:2.6,tbspGrams:7.8,cupGrams:125},
{keys:['חמאה','butter'],density:.96,water:.16,tspGrams:4.7,tbspGrams:14.2,cupGrams:227},
{keys:['מים','water'],density:1,water:1,tspGrams:5,tbspGrams:15,cupGrams:240},
{keys:['שוקולד צ׳יפס','שוקולד ציפס','שוקולד צ\'יפס','chocolate chips'],water:0,tspGrams:3.5,tbspGrams:10.5,cupGrams:170},
{keys:['שוקולד מריר','שוקולד','chocolate'],water:0,tspGrams:3.5,tbspGrams:10.5,cupGrams:170},
{keys:['אבקת סוכר','powdered sugar','icing sugar'],water:0,tspGrams:2.5,tbspGrams:7.5,cupGrams:120},
{keys:['קקאו','cocoa'],water:.03,tspGrams:2.1,tbspGrams:6.3,cupGrams:85},
{keys:['דבש','honey'],density:1.42,water:.17,tspGrams:7.1,tbspGrams:21.3,cupGrams:340},
{keys:['שמן','oil'],density:.92,water:0,tspGrams:4.6,tbspGrams:13.8,cupGrams:221},
{keys:['חלב','milk'],density:1.03,water:.87,tspGrams:5.15,tbspGrams:15.45,cupGrams:247},
{keys:['שמנת חמוצה','sour cream'],density:1,water:.73,tspGrams:5,tbspGrams:15,cupGrams:240},
{keys:['שמנת','cream'],density:.99,water:.60,tspGrams:4.95,tbspGrams:14.85,cupGrams:238},
{keys:['יוגורט','yogurt'],density:1.03,water:.84,tspGrams:5.15,tbspGrams:15.45,cupGrams:247},
{keys:['מרגרינה','margarine'],density:.96,water:.16,tspGrams:4.7,tbspGrams:14.2,cupGrams:227},
{keys:['מחית','puree'],density:1,water:.80,tspGrams:5,tbspGrams:15,cupGrams:240},
{keys:['ריבה','jam'],density:1.30,water:.30,tspGrams:6.5,tbspGrams:19.5,cupGrams:312},
{keys:['סירופ','syrup'],density:1.30,water:.35,tspGrams:6.5,tbspGrams:19.5,cupGrams:312},
{keys:['מיץ','juice'],density:1.04,water:.90,tspGrams:5.2,tbspGrams:15.6,cupGrams:250},
{keys:['שיבולת שועל','קוואקר','oats'],water:.10,tspGrams:1.9,tbspGrams:5.6,cupGrams:90}
];
function cleanIngredientName(name){return String(name||'').toLowerCase().replace(/[״"']/g,'').replace(/[^\u0590-\u05ffa-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()}
function ingredientProfile(name){const n=cleanIngredientName(name);return INGREDIENT_PROFILES.find(p=>p.keys.some(k=>n.includes(cleanIngredientName(k))))||{density:1,water:0}}
function ingredientWeightData(item){
  const qty=Number(item?.qty||0),unit=item?.unit||'גרם',p=ingredientProfile(item?.name);
  if(!qty)return{grams:0,waterGrams:0,known:true,estimated:false};
  let grams=0,known=true,estimated=false;
  if(unit==='גרם')grams=qty;else if(unit==='ק"ג')grams=qty*1000;
  else if(unit==='מ"ל'){grams=qty*Number(p.density||1);estimated=!p.density}
  else if(unit==='ליטר'){grams=qty*1000*Number(p.density||1);estimated=!p.density}
  else if(unit==='כפית'&&p.tspGrams){grams=qty*p.tspGrams;estimated=true}
  else if(unit==='כף'&&p.tbspGrams){grams=qty*p.tbspGrams;estimated=true}
  else if(unit==='כוס'&&p.cupGrams){grams=qty*p.cupGrams;estimated=true}
  else if(unit==='קורט'&&p.pinchGrams){grams=qty*p.pinchGrams;estimated=true}
  else if((unit==='יחידה'||unit==='חבילה')&&p.unitWeight){grams=qty*p.unitWeight;estimated=true}
  else known=false;
  return{grams:known?grams:0,waterGrams:known?grams*Number(p.water||0):0,known,estimated};
}
function calculateIngredientListWeight(ingredients,evaporationPct=0){
  let rawWeight=0,waterAvailable=0,estimatedCount=0;const excluded=[];
  (ingredients||[]).filter(i=>String(i.name||'').trim()&&Number(i.qty||0)>0).forEach(i=>{const x=ingredientWeightData(i);rawWeight+=x.grams;waterAvailable+=x.waterGrams;if(!x.known)excluded.push(i.name);if(x.estimated)estimatedCount++});
  const pct=Math.max(0,Math.min(100,Number(evaporationPct||0))),evaporationLoss=Math.min(waterAvailable,waterAvailable*pct/100);
  return{rawWeight,waterAvailable,evaporationPct:pct,evaporationLoss,finalWeight:Math.max(0,rawWeight-evaporationLoss),excludedCount:excluded.length,excluded:[...new Set(excluded)],estimatedCount};
}
function calculateSubRecipeWeight(sub){return calculateIngredientListWeight(sub?.ingredients||[],sub?.evaporationPct||0)}
function calculateRecipeWeight(r,override){return calculateIngredientListWeight(override||r?.ingredients||[],r?.evaporationPct??12)}
function packageSummary(r,weight=null){const finalWeight=weight??calculateRecipeWeight(r).finalWeight,packageWeight=Math.max(1,Number(r?.packageWeight||r?.unitWeight||200)),fullBags=Math.floor(finalWeight/packageWeight),remainder=Math.max(0,finalWeight-fullBags*packageWeight);return{finalWeight,packageWeight,fullBags,remainder}}
function recipeYieldUnits(r){
  if(salesUnitLabel(r)==='שקיות'){const p=packageSummary(r);return p.fullBags>0?p.fullBags:Math.max(0,Math.round(Number(r?.yieldUnits||0)))}
  return Math.max(0,Math.round(Number(r?.yieldUnits||0)));
}
function recipeYieldBags(r){return recipeYieldUnits(r)}

function canonicalAmount(name,qty,unit){const w=ingredientWeightData({name,qty,unit});if(w.known&&w.grams>0)return{qty:w.grams,unit:'גרם'};return norm(qty,unit)}
function recipe(recipeId){return state.recipes.find(r=>r.id===recipeId)}
function activeOrders(){return state.orders.filter(o=>!['נמסרה','בוטלה'].includes(o.status))}
function activeSalesEvents(){return(state.salesEvents||[]).filter(e=>e.status!=='בוטל'&&e.status!=='הסתיים')}
function revenue(order){return(order.items||[]).reduce((sum,item)=>sum+(recipe(item.recipeId)?.salePrice||0)*Number(item.qty||0),0)}
function salesEventExpectedRevenue(event){return(event.items||[]).reduce((sum,item)=>sum+Number(item.targetQty||0)*Number(item.unitPrice||0),0)}
function salesEventActualRevenue(event){return(event.items||[]).reduce((sum,item)=>sum+Number(item.soldQty||0)*Number(item.unitPrice||0),0)}

function isWaterIngredient(name){const n=cleanIngredientName(name);return n==='מים'||n==='water'||n.startsWith('מים ')}
function inventoryPackageCount(i){return Math.max(0,Math.round(Number(i?.packageCount||0)))}

const INGREDIENT_DESCRIPTOR_WORDS=new Set(['רגיל','רגילה','איכותי','איכותית','פרימיום','טהור','טהורה','טבעי','טבעית','דק','דקה','חדש','חדשה','אריזה','חבילה','מארז','מותג','של','עם']);
const INGREDIENT_WEAK_WORDS=new Set(['אבקת','אבקה','קמח','סוכר','שמן','תמצית','מחית','קרם','חלב']);
function ingredientAliasName(value){
  let n=cleanIngredientName(value).replace(/\b(?:\d+(?:[.,]\d+)?|גרם|גרמים|קג|קילו|קילוגרם|מל|מיליליטר|ליטר|יחידות?|חבילות?)\b/g,' ').replace(/\s+/g,' ').trim();
  const replacements=[
    [/אבקת התפחה/g,'אבקת אפייה'],[/אבקה להתפחה/g,'אבקת אפייה'],[/עמילן תירס/g,'קורנפלור'],[/סוכר טחון/g,'אבקת סוכר'],[/סוכר פודרה/g,'אבקת סוכר'],
    [/סודה לשתיה/g,'סודה לשתייה'],[/קמח חיטה לבן/g,'קמח לבן'],[/קמח לבן רגיל/g,'קמח לבן'],[/סוכר לבן רגיל/g,'סוכר לבן'],[/תמצית וניל איכותית/g,'תמצית וניל']
  ];
  replacements.forEach(([re,to])=>n=n.replace(re,to));
  return n.split(' ').filter(w=>w&&!INGREDIENT_DESCRIPTOR_WORDS.has(w)).join(' ').trim();
}
const INGREDIENT_CORE_RULES=[
  ['אבקת אפייה',/\bאבקת?\s*אפ(?:י|ייה|יה)|\bbaking powder\b/i],['אבקת סוכר',/\bאבקת?\s*סוכר|\bicing sugar\b|\bpowdered sugar\b/i],
  ['סודה לשתייה',/\bסודה\s*לשת(?:י|ייה|יה)|\bbaking soda\b/i],['סוכר חום',/\bסוכר\s*חום/i],['סוכר לבן',/\bסוכר\s*לבן/i],
  ['קמח',/\bקמח\b|\bflour\b/i],['חמאה',/\bחמאה\b|\bbutter\b/i],['מלח',/\bמלח\b|\bsalt\b/i],['קורנפלור',/\bקורנפלור\b|\bעמילן\s*תירס|\bcornstarch\b/i],
  ['שוקולד מריר',/\bשוקולד\s*מריר|\bdark chocolate\b/i],['שוקולד חלב',/\bשוקולד\s*חלב|\bmilk chocolate\b/i],['חלב',/\bחלב\b|\bmilk\b/i],
  ['שמרים',/\bשמרים\b|\byeast\b/i],['ביצה',/\bביצ(?:ה|ים)\b|\begg/i],['וניל',/\bוניל\b|\bvanilla\b/i],['שמן',/\bשמן\b|\boil\b/i]
];
function ingredientCoreKey(value){const n=ingredientAliasName(value);const hit=INGREDIENT_CORE_RULES.find(([,re])=>re.test(n));return hit?hit[0]:''}
function ingredientMatchScore(a,b){
  const an=ingredientAliasName(a),bn=ingredientAliasName(b);if(!an||!bn)return 0;if(an===bn)return 100;
  const ac=ingredientCoreKey(an),bc=ingredientCoreKey(bn);
  if(ac||bc){if(ac&&bc&&ac!==bc)return 0;if(ac&&bc&&ac===bc)return an.includes(bn)||bn.includes(an)?98:90}
  if(an.includes(bn)||bn.includes(an)){
    const shorter=an.length<=bn.length?an:bn;
    if(shorter.length>=3&&!INGREDIENT_WEAK_WORDS.has(shorter))return 86;
  }
  const at=new Set(an.split(' ').filter(Boolean)),bt=new Set(bn.split(' ').filter(Boolean)),common=[...at].filter(x=>bt.has(x));
  const strong=common.filter(x=>!INGREDIENT_WEAK_WORDS.has(x));
  if(!strong.length)return 0;
  const union=new Set([...at,...bt]).size,score=Math.round(common.length/Math.max(1,union)*65+strong.length/Math.max(1,Math.min(at.size,bt.size))*35);
  return score>=50?score:0;
}
function ingredientNamesEquivalent(a,b){return ingredientMatchScore(a,b)>=70}
function supplierPriceMatches(name){
  const matches=[];if(!cleanIngredientName(name))return matches;
  state.suppliers.forEach(s=>(s.prices||[]).forEach((p,index)=>{
    const score=ingredientMatchScore(name,p.ingredient);if(score<70||Number(p.packQty||0)<=0)return;
    const pack=canonicalAmount(p.ingredient,p.packQty,p.unit),price=Math.max(0,Number(p.packPrice||0));
    matches.push({supplierId:s.id,supplierName:s.name,priceIndex:index,priceId:p.id||'',ingredient:p.ingredient,productName:p.productName||'',packQty:Number(p.packQty||0),unit:p.unit||'גרם',packPrice:price,canonicalQty:pack.qty,canonicalUnit:pack.unit,baseUnitCost:pack.qty?price/pack.qty:Number.POSITIVE_INFINITY,updatedAt:p.updatedAt||'',matchScore:score});
  }));
  return matches.sort((a,b)=>b.matchScore-a.matchScore||a.baseUnitCost-b.baseUnitCost||a.supplierName.localeCompare(b.supplierName,'he'));
}
function inventoryLinkedPrice(i){
  const options=supplierPriceMatches(i?.name);
  return options.find(o=>i?.supplierPriceId&&o.priceId===i.supplierPriceId)||options.find(o=>o.supplierId===i?.supplierId)||options[0]||null;
}
function inventoryAmountPerPackage(i){const linked=inventoryLinkedPrice(i);if(linked){const c=canonicalAmount(linked.ingredient,linked.packQty,linked.unit);return c.unit==='גרם'?Math.max(0,c.qty):Math.max(0,Number(linked.packQty||0))}const c=canonicalAmount(i?.name,Number(i?.amountPerPackage??i?.qty??0),i?.unit||'גרם');return c.unit==='גרם'?Math.max(0,c.qty):Math.max(0,Number(i?.amountPerPackage??i?.qty??0))}
function inventoryUnit(i){return 'גרם'}
function inventorySupplier(i){const linked=inventoryLinkedPrice(i);return linked?state.suppliers.find(s=>s.id===linked.supplierId)||null:null}
function ingredientPurchaseSpec(name,qty=1,unit='יחידה'){
  const n=cleanIngredientName(name),u=normalizedRecipeUnit(unit);
  // חלמון וחלבון נקנים כביצים. לצורך עלות/מלאי כל אחד מוערך כחצי ביצה.
  if(u==='יחידה'&&/^חלמונ|^חלבונ/.test(n))return{name:'ביצה',qty:Number(qty||0)*0.5,unit:'יחידה',sourceName:name,derived:true};
  return{name,qty:Number(qty||0),unit:u,sourceName:name,derived:false};
}
function inventoryTotal(i){
  if(Number.isFinite(Number(i?.stockQty)))return Math.max(0,Number(i.stockQty));
  return Math.max(0,Number(i?.packageCount||0))*inventoryAmountPerPackage(i);
}
function invAmount(name,unit){
  const requested=canonicalAmount(name,1,unit);let total=0;
  state.inventory.forEach(i=>{if(!ingredientNamesEquivalent(i.name,name))return;const x=canonicalAmount(i.name,inventoryTotal(i),inventoryUnit(i));if(x.unit===requested.unit)total+=x.qty/requested.qty});return total;
}
function unitCost(name,unit){
  const spec=ingredientPurchaseSpec(name,1,unit),requested=canonicalAmount(spec.name,spec.qty,spec.unit);let best=null;
  supplierPriceMatches(spec.name).forEach(p=>{const pack=canonicalAmount(p.ingredient,p.packQty,p.unit);if(pack.unit!==requested.unit||!pack.qty)return;const cost=Number(p.packPrice||0)/pack.qty*requested.qty;if(best===null||cost<best)best=cost});
  return best||0;
}
function expandedIngredients(r){
  const out=[];
  (r.ingredients||[]).forEach(i=>{
    const sub=(r.subRecipes||[]).find(s=>s.id===i.linkedSubRecipeId||cleanIngredientName(i.name)===cleanIngredientName(s.name));
    if(!sub){out.push({...i});return}
    const used=ingredientWeightData(i).grams||Number(sub.usedQtyGrams||0),yieldWeight=calculateSubRecipeWeight(sub).finalWeight;
    if(!used||!yieldWeight){out.push({...i});return}
    const factor=used/yieldWeight;
    (sub.ingredients||[]).forEach(si=>out.push({...si,qty:Number(si.qty||0)*factor,sourceSubRecipe:sub.name}));
  });
  return out;
}
function recipeCost(r){
  let ingredients=0;expandedIngredients(r).forEach(i=>{ingredients+=Number(i.qty||0)*unitCost(i.name,i.unit)});
  const bags=recipeYieldBags(r),total=ingredients*(1+Number(r.wastePct||0)/100);
  return{ingredients,labor:0,packaging:0,total,perUnit:bags?total/bags:null};
}
function demand(){
  const byRecipe={},ingredients={};
  activeOrders().forEach(o=>(o.items||[]).forEach(i=>byRecipe[i.recipeId]=(byRecipe[i.recipeId]||0)+Number(i.qty||0)));
  activeSalesEvents().forEach(event=>(event.items||[]).forEach(item=>{if(item.recipeId)byRecipe[item.recipeId]=(byRecipe[item.recipeId]||0)+Number(item.targetQty||0)}));
  Object.entries(byRecipe).forEach(([rid,units])=>{const r=recipe(rid);if(!r)return;const recipeRuns=Math.ceil(units/Math.max(1,recipeYieldUnits(r)));expandedIngredients(r).forEach(i=>{if(i.asNeeded)return;const spec=ingredientPurchaseSpec(i.name,Number(i.qty||0)*recipeRuns,i.unit),x=canonicalAmount(spec.name,spec.qty,spec.unit),key=`${cleanIngredientName(spec.name)}|${x.unit}`;if(!ingredients[key])ingredients[key]={name:spec.name,unit:x.unit,required:0,category:ingredientCategory(spec.name),derivedFrom:spec.derived?[i.name]:[]};ingredients[key].required+=x.qty;if(spec.derived&&!ingredients[key].derivedFrom.includes(i.name))ingredients[key].derivedFrom.push(i.name)})});
  return{byRecipe,ingredients};
}
function shopping(){return Object.entries(demand().ingredients).filter(([,x])=>!isWaterIngredient(x.name)).map(([key,x])=>{const available=invAmount(x.name,x.unit);return{...x,key,available,need:Math.max(0,x.required-available),checked:!!state.checkedShopping[key]}}).filter(x=>x.need>0).sort((a,b)=>a.category.localeCompare(b.category,'he')||a.name.localeCompare(b.name,'he'))}
function supplierOptions(){const items=shopping();return state.suppliers.map(s=>{let itemsCost=0,covered=0;items.forEach(it=>{let best=null;(s.prices||[]).filter(p=>ingredientNamesEquivalent(p.ingredient,it.name)).forEach(p=>{const x=canonicalAmount(p.ingredient,p.packQty,p.unit);if(x.unit!==it.unit||!x.qty)return;const packs=Math.ceil(it.need/x.qty),cost=packs*Number(p.packPrice||0);if(best===null||cost<best)best=cost});if(best!==null){itemsCost+=best;covered++}});const delivery=Number(s.deliveryCost||0),distanceCost=Number(s.distanceKm||0)*2*Number(state.settings.distanceCostPerKm||0);return{supplier:s,itemsCost,covered,delivery,distanceCost,total:itemsCost+delivery+distanceCost}}).sort((a,b)=>a.total-b.total)}

function bestPriceDetail(name,unit){
  const spec=ingredientPurchaseSpec(name,1,unit),requested=canonicalAmount(spec.name,spec.qty,spec.unit);let best=null;
  supplierPriceMatches(spec.name).forEach(p=>{const pack=canonicalAmount(p.ingredient,p.packQty,p.unit);if(pack.unit!==requested.unit||!pack.qty)return;const cost=Number(p.packPrice||0)/pack.qty*requested.qty;if(!best||cost<best.unitCost)best={...p,unitCost:cost,purchaseIngredient:spec.name,derived:spec.derived}});return best;
}
function recipeCostBreakdown(recipeId){
  const r=recipe(recipeId);if(!r)return;const c=recipeCost(r),unit=salesUnitLabel(r),rows=expandedIngredients(r).map(i=>{const detail=bestPriceDetail(i.name,i.unit),cost=Number(i.qty||0)*(detail?.unitCost||0);return{...i,detail,cost}});
  const yieldCount=recipeYieldUnits(r),perUnitText=yieldCount&&c.perUnit!==null?money(c.perUnit):'לא ניתן לחשב עדיין';
  modal(`פירוט עלות — ${r.name}`,`<div class="cost-breakdown-head"><div><span>עלות חומרי גלם למתכון</span><strong>${money(c.total)}</strong></div><div><span>תפוקה</span><strong>${yieldCount?`${yieldCount} ${esc(unit)}`:'לא הוגדר'}</strong></div><div><span>עלות ל${esc(salesUnitSingular(unit))}</span><strong>${perUnitText}</strong></div></div><div class="notice">החישוב כולל חומרי גלם ופחת בלבד. שכר עבודה ועלות אריזה אינם נכללים.</div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>רכיב</th><th>כמות</th><th>מחיר שנמצא</th><th>עלות במתכון</th></tr></thead><tbody>${rows.map(i=>`<tr><td><strong>${esc(i.name)}</strong>${i.sourceSubRecipe?`<div class="meta">מתוך ${esc(i.sourceSubRecipe)}</div>`:''}</td><td>${fmtQty(i.qty,i.unit)} ${esc(normalizedRecipeUnit(i.unit))}</td><td>${i.detail?`${esc(i.detail.supplierName)} · ${money(i.detail.packPrice)} / ${fmtQty(i.detail.packQty,i.detail.unit)} ${esc(normalizedRecipeUnit(i.detail.unit))}`:'<span class="muted">אין מחיר תואם</span>'}</td><td class="money">${money(i.cost)}</td></tr>`).join('')}</tbody></table></div>`)
}

/* ניתוח מתכונים מקומי — v11.9: ניקוי, נרמול והבנת מבנה גמישה */
const FRACTION_VALUES={'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875,'חצי':.5,'רבע':.25,'שליש':1/3};
const HEB_NUMBER_VALUES={'אחד':1,'אחת':1,'שני':2,'שתי':2,'שניים':2,'שתיים':2,'שלושה':3,'שלוש':3,'ארבעה':4,'ארבע':4,'חמישה':5,'חמש':5,'שישה':6,'שש':6,'שבעה':7,'שבע':7,'שמונה':8,'תשעה':9,'תשע':9,'עשרה':10,'עשר':10};
const UNIT_ALIASES=[
{re:/^(?:ק[״"]?ג|קילו(?:גרם)?|קילוגרם|קילוגרמים)(?=\s|$)/i,unit:'ק"ג'},
{re:/^(?:גרם|גרמים|גר׳|ג׳|ג')(?=\s|$)/i,unit:'גרם'},
{re:/^(?:מ[״"]?ל|מיליליטר(?:ים)?|ml)(?=\s|$)/i,unit:'מ"ל'},
{re:/^(?:ליטר|ליטרים)(?=\s|$)/i,unit:'ליטר'},
{re:/^(?:כפית|כפיות|כפ׳)(?=\s|$)/i,unit:'כפית'},
{re:/^(?:כף|כפות)(?=\s|$)/i,unit:'כף'},
{re:/^(?:כוס|כוסות)(?=\s|$)/i,unit:'כוס'},
{re:/^(?:קורט|קורטים)(?=\s|$)/i,unit:'קורט'},
{re:/^(?:חבילה|חבילות|מארז|מארזים|שקית|שקיות|מיכל|מיכלים|פחית|פחיות)(?=\s|$)/i,unit:'חבילה'},
{re:/^(?:יחידה|יחידות)(?=\s|$)/i,unit:'יחידה'}
];
function parseNumberToken(token){
  token=String(token||'').trim().replace(',','.');
  if(FRACTION_VALUES[token]!==undefined)return FRACTION_VALUES[token];
  if(HEB_NUMBER_VALUES[token]!==undefined)return HEB_NUMBER_VALUES[token];
  if(/^\d+\/\d+$/.test(token)){const[a,b]=token.split('/').map(Number);return b?a/b:0}
  if(/^\d+\s+\d+\/\d+$/.test(token)){const parts=token.split(/\s+/);return Number(parts[0])+parseNumberToken(parts[1])}
  const n=Number(token);return Number.isFinite(n)?n:0;
}
function ingredientCategory(name){const n=cleanIngredientName(name);if(/עוגת?\s*שמרים.*מוכנ/.test(n))return'אחר';if(/חלב|חמאה|שמנת|יוגורט|גבינ|ביצה|ביצים|חלמון|חלבון/.test(n))return'מקרר';if(/קפוא|גלידה/.test(n))return'קפואים';if(/קופס|שקית|נייר אפייה|אריז|מדבקה|סרט/.test(n))return'אריזות';if(/שוקולד|אגוז|שקד|פקאן|פיסטוק|צימוק|סוכריות|תמצית|וניל|מחית|ריבה|ממרח|טופי/.test(n))return'תוספות';if(/קמח|סוכר|קקאו|מלח|אבקת אפייה|סודה|שמרים|קורנפלור|שיבולת|קוואקר/.test(n))return'יבשים';return'אחר'}
function recipeCategoryFromText(text){
  const n=cleanIngredientName(text);
  if(/עוגת?\s*שמרים|בבקה|קראנץ/.test(n))return'עוגות שמרים';
  if(/חלה|חלות|לחם|לחמנ|בריוש/.test(n))return'חלות ולחמים';
  if(/עוגי|קוקי|קנטוצ|ביסקוט|סבלה|שורטברד|מקרון/.test(n))return'עוגיות';
  if(/טארט|פאי|קיש/.test(n))return'טארטים ופאי';
  if(/מאפין|קאפקייק/.test(n))return'מאפינס וקאפקייקס';
  if(/קרואסון|בורקס|פלמייר|palmiers|מאפה|דניש|שבלול/.test(n))return'מאפים';
  if(/מוס|פודינג|מלבי|פנקוטה|טירמיסו|קינוח|קרם ברולה|טרייפל/.test(n))return'קינוחים';
  if(/עוגה|קייק|cake/.test(n))return'עוגות';
  return'אחר';
}
function recipeCategoryText(r={}){return [r.name,r.notes,r.category,...(r.ingredients||[]).map(i=>i.name),...(r.subRecipes||[]).map(x=>x.name)].filter(Boolean).join(' ')}
function effectiveRecipeCategory(r={}){const existing=String(r.category||'').trim();if(r.categoryManual&&existing)return existing;const inferred=recipeCategoryFromText(recipeCategoryText(r));return inferred!=='אחר'?inferred:(existing||'אחר')}
function recipeCategoryOptions(selected=''){const values=[...PRODUCT_CATEGORIES];if(selected&&!values.includes(selected))values.splice(values.length-1,0,selected);return values}
function autoSuggestRecipeCategory(){const form=document.getElementById('recipeForm'),select=form?.elements.category,name=form?.elements.name;if(!form||!select||!name||select.dataset.manual==='true')return;const ingredients=readRecipeFormIngredients().map(i=>i.name).join(' '),suggested=recipeCategoryFromText(`${name.value} ${ingredients}`);if(suggested&&suggested!=='אחר')select.value=suggested}
function markRecipeCategoryManual(select){if(select)select.dataset.manual='true'}
function stripIngredientComment(text){
  return String(text||'').replace(/\s*[–—-]\s*(?:מעניק|מומלץ|לאיזון|לטעם|אופציונלי|רשות).*/i,'').replace(/\((?:מומלץ|לאיזון|אופציונלי|לפי הטעם|בסוף|בהתחלה)[^)]*\)/gi,'').trim();
}
function normalizeIngredientName(text){
  return stripIngredientComment(String(text||'').replace(/^של\s+/,'').replace(/\s+/g,' ').replace(/[,:;.-]+$/,'').trim());
}
function cleanRecipePaste(text){
  let s=String(text||'').replace(/\r/g,'\n').replace(/\u00a0/g,' ');
  // Markdown links: keep the visible label, discard the URL/title.
  s=s.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g,'$1');
  s=s.replace(/https?:\/\/\S+/gi,' ');
  s=s.replace(/<[^>]*>/g,' ');
  s=s.replace(/!\[[^\]]*\]\([^)]*\)/g,' ');
  s=s.replace(/[*_~`]+/g,'');
  s=s.replace(/^\s*#{1,6}\s*/gm,'');
  s=s.replace(/^\s*>\s?/gm,'');
  // Common copied-site noise.
  s=s.replace(/^.*(?:המרת מידות ומשקלות|לכל המתכונים עם|למתכונים נוספים|פרסומת|בשיתוף|תוכן ממומן).*$/gmi,'');
  // Put spaces between attached numbers/fractions and Hebrew/Latin words.
  s=s.replace(/(\d|[½¼¾⅓⅔⅛⅜⅝⅞])(?=[\u0590-\u05FFA-Za-z])/g,'$1 ');
  s=s.replace(/([\u0590-\u05FFA-Za-z])(?=\d+(?:[.,]\d+)?\s*(?:גרם|קג|ק"ג|מ"ל|מל|ליטר|כפית|כף|כוס)\b)/g,'$1 ');
  s=s.replace(/[‐‑‒–—]/g,'-');
  // Split numbered method steps that were pasted in one paragraph.
  s=s.replace(/[ \t]+(?=\d{1,2}[.)]\s+)/g,'\n');
  s=s.replace(/[ \t]+[•▪◦]\s*/g,'\n• ');
  s=s.replace(/\n{3,}/g,'\n\n');
  return s.split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
}
function parseQuantityAndUnit(text){
  let s=String(text||'').trim();
  const wordNums=Object.keys(HEB_NUMBER_VALUES).join('|');
  const amount=s.match(new RegExp(`^(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞]|חצי|רבע|שליש|${wordNums})\\s*(.*)$`,'i'));
  if(!amount)return null;
  let qty=parseNumberToken(amount[1]),rest=amount[2].trim();
  if(!qty)return null;
  let unit='יחידה';
  for(const a of UNIT_ALIASES){const m=rest.match(a.re);if(m){unit=a.unit;rest=rest.slice(m[0].length).trim();break}}
  if(/^ו?חצי(?:\s|$)/.test(rest)){qty+=.5;rest=rest.replace(/^ו?חצי\s*/,'')}
  const explicit=rest.match(/\((?:כ\s*[-־]?\s*)?(\d+(?:[.,]\d+)?)\s*(גרם|גרמים|ק[״"]?ג|מ[״"]?ל|מיליליטר(?:ים)?|ליטר|ליטרים|ml)\)/i);
  if(explicit){
    qty=Number(explicit[1].replace(',','.'));
    const u=explicit[2];
    unit=/^ק/i.test(u)?'ק"ג':/ליטר/i.test(u)&&!/מיל/i.test(u)?'ליטר':/מ|ml/i.test(u)?'מ"ל':'גרם';
    rest=rest.replace(explicit[0],' ');
  }
  rest=rest.replace(/^(?:גדושה|שטוחה|מלאה|מלא|דחוסה|דחוס)\s+/,'').trim();
  return{qty,unit,rest};
}
function parseIngredientLine(line){
  let s=String(line||'').trim().replace(/^[•*\-–—]+\s*/,'').replace(/\s+/g,' ');if(!s)return null;
  if(/^\d+[.)]\s+/.test(s)||/^שלב\s*\d+\b/i.test(s))return null;
  if(/^(?:או|או לחלופין|לחלופין)\b/i.test(s))return null;
  const asNeeded=s.match(/^(.+?)\s+(?:לפי הצורך|לפי הטעם|לשימון|לקימוח|לפיזור|להברשה)\s*$/i);
  if(asNeeded&&!/\d/.test(asNeeded[1])){const name=normalizeIngredientName(asNeeded[1]);return name?{name,qty:0,unit:'יחידה',category:ingredientCategory(name),asNeeded:true}:null}
  if(/^קורט\s+/.test(s)){
    const name=normalizeIngredientName(s.replace(/^קורט\s+/,''));
    return name?{name,qty:1,unit:'קורט',category:ingredientCategory(name)}:null;
  }
  // "כף וחצי קמח", "כפית וניל" without an explicit leading 1.
  let m=s.match(/^(כפית|כף|כוס)\s+וחצי\s+(.+)$/i);
  if(m){const unit=m[1],name=normalizeIngredientName(m[2]);return name?{name,qty:1.5,unit,category:ingredientCategory(name)}:null}
  if(/^(?:כפית|כף|כוס|חבילה|יחידה|מיכל|מקל|פחית)\s+/i.test(s)){
    const parsed=parseQuantityAndUnit(`1 ${s}`);
    if(parsed){const name=normalizeIngredientName(parsed.rest);return name?{name,qty:parsed.qty,unit:parsed.unit,category:ingredientCategory(name)}:null}
  }
  // "name: 220 g"
  m=s.match(/^([^:]{2,100})\s*:\s*(.+)$/);
  if(m){
    const parsed=parseQuantityAndUnit(m[2]);
    if(parsed){let name=normalizeIngredientName(m[1]);if(name)return{name,qty:parsed.qty,unit:parsed.unit,category:ingredientCategory(name)}}
  }
  // Normal order: "220 g butter".
  let parsed=parseQuantityAndUnit(s);
  if(parsed){
    let rest=normalizeIngredientName(parsed.rest);
    if(/^ביצ(?:ה|ים)\b/.test(rest)){parsed.unit='יחידה';rest=rest.replace(/^ביצ(?:ה|ים)\b/,'ביצה')}
    if(/^חלמונ(?:ים)?(?=\s|$)/.test(rest)){parsed.unit='יחידה';rest=rest.replace(/^חלמונ(?:ים)?(?=\s|$)/,'חלמון')}
    if(/^חלבונ(?:ים)?(?=\s|$)/.test(rest)){parsed.unit='יחידה';rest=rest.replace(/^חלבונ(?:ים)?(?=\s|$)/,'חלבון')}
    if(rest)return{name:rest,qty:parsed.qty,unit:parsed.unit,category:ingredientCategory(rest)};
  }
  // Reverse order: "butter 200 g", "eggs 2".
  const unitWords='(?:גרם|גרמים|ג[׳\\\']?|ק[״"]?ג|קג|מ[״"]?ל|מל|ליטר|ליטרים|כפית|כפיות|כף|כפות|כוס|כוסות|יחידה|יחידות|חבילה|חבילות)';
  m=s.match(new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|[½¼¾⅓⅔⅛⅜⅝⅞])\\s*(${unitWords})\\s*$`,'i'));
  if(m){
    const candidate=`${m[2]} ${m[3]} ${m[1]}`,x=parseQuantityAndUnit(candidate);
    if(x){const name=normalizeIngredientName(x.rest);if(name)return{name,qty:x.qty,unit:x.unit,category:ingredientCategory(name)}}
  }
  return null;
}
function inferAllergens(ingredients){const text=cleanIngredientName((ingredients||[]).map(i=>i.name).join(' ')),a=[];if(/קמח|גלוטן|חיטה|שיבולת|שיפון|שעורה/.test(text))a.push('גלוטן');if(/חלב|חמאה|שמנת|יוגורט|גבינ/.test(text))a.push('חלב');if(/ביצה|ביצים|חלבון|חלמון/.test(text))a.push('ביצים');if(/אגוז|שקד|פקאן|פיסטוק|לוז|קשיו/.test(text))a.push('אגוזים');if(/בוטנ/.test(text))a.push('בוטנים');if(/שומשום|טחינה/.test(text))a.push('שומשום');if(/סויה/.test(text))a.push('סויה');return a.join(', ')}
function normalizeSectionName(text){return String(text||'').replace(/[📦✨]/g,'').replace(/[:\-–—]+$/,'').replace(/^(?:ל|עבור)\s+/,'').replace(/^ה(?=עוגיות|טופי|בצק|קרם|מילוי)/,'').trim()}
function isGenericHeading(line){return/^(?:מצרכים|רכיבים|חומרים|מה צריך|מה צריכים|אופן הכנה|אופן ההכנה|הוראות|הכנה|שלבי הכנה|איך מכינים|אפייה|הערות|טיפים|אחסון|אחסון וחיי מדף|ingredients|method|instructions)\s*:?$/i.test(String(line||'').replace(/[📦✨]/g,'').trim())}
function isActionLine(line){return/(?:מערבב|ממיס|מוסיפ|מקפל|אופ|מחממ|מקרר|מצננ|מעביר|שופכ|מכניס|מוציא|מקציפ|חותכ|שובר|מבשל|מרדד|יוצר|מסדר|מניח|מחלק|מגלגל|משטח|מרפד|מכין|טורף|מוזג|מפסיק|שמים|פורס|מסננ|לוחצ|נותנ|ממלא|מחזיר|מגיש|מערבבים|מרתיח|משמנים)/.test(cleanIngredientName(line))}
function isNoteLine(line){return/(?:טיפ|הערה|אחסון|נשמר|חיי מדף|תנאי אחסון|חשוב|שימו לב|אפשר לשמור|חובה לאחסן|הערת המערכת|עד \d+ (?:ימים|חודשים))/.test(cleanIngredientName(line))}
function ingredientNamesMatch(a,b){const x=cleanIngredientName(a).replace(/\b(?:איכותית|רכה|כהה|דביק|גדולה|קטנה|שבבים|חתיכות)\b/g,'').trim(),y=cleanIngredientName(b).replace(/\b(?:מתכון|תת מתכון|שלב)\b/g,'').trim();return !!x&&!!y&&(x===y||x.includes(y)||y.includes(x))}
function isMainIngredientSubsectionHeading(line){
  const t=cleanIngredientName(normalizeSectionName(line));
  return /^(?:חומרים\s+)?(?:ל)?(?:בצק|קיפול|הברשה|ציפוי|קישוט|פיזור|הגשה|אפייה|תבנית|שימון|סיום|גימור)(?:\s+.*)?$/.test(t)||/^(?:לקיפול|להברשה|לציפוי|לקישוט|לפיזור|להגשה|לפני אפייה|לאחר אפייה|אחרי אפייה)$/.test(t);
}
function isSubRecipeHeading(line){
  const t=cleanIngredientName(normalizeSectionName(line));if(!t||isMainIngredientSubsectionHeading(t))return false;
  return /(?:^|\s)(?:מילוי|קרם|גנאש|פרלינה|טופי|רוטב|סירופ|ריבה|קראמבל|סטרויזל|קונפי|פטיסייר|מרנג|בלילה)(?:\s|$)/.test(t);
}
function isMainMethodHeading(line){const t=cleanIngredientName(normalizeSectionName(line));return /^(?:הרכבה|עיצוב|עיצוב והרכבה|הרכבה ואפייה|התפחה|התפחה ואפייה|אפייה|סיום|גימור|אופן ההכנה|אופן הכנה|הכנה|שלבי הכנה|מגישים)$/.test(t)}
function extractInlineIngredients(line){
  const text=String(line||'').replace(/([.;])/g,' $1 '),out=[];
  const unit='(?:גרם|ק[״"׳\']?ג|מ[״"׳\']?ל|מיליליטר|ליטר|כפית|כפיות|כף|כפות|כוס|כוסות|יחידה|יחידות|מיכל|מיכלים)';
  const re=new RegExp('(\\d+(?:[.,]\\d+)?|\\d+\\/\\d+)\\s*('+unit+')\\s+(.+?)(?=(?:\\s+ו?\\s*\\d+(?:[.,]\\d+)?\\s*'+unit+')|[.;]|$)','g');
  let m;while((m=re.exec(text))){const cleanName=String(m[3]||'').replace(/\s+(?:ו?טורפים|ו?מערבבים|ו?ממיסים|ו?מוסיפים)(?:\s+.*)?$/,'').replace(/\s+מהמקרר(?:\s+.*)?$/,'').replace(/\s+ו\s*$/,'').trim();const parsed=parseIngredientLine(`${m[1]} ${m[2]} ${cleanName}`);if(parsed&&parsed.name&&!/^(?:דקות|שעות|מעלות)$/.test(parsed.name))out.push(parsed)}
  return out;
}
function inferStepMeta(text,kindHint=''){
  const n=cleanIngredientName(text),meta={text:String(text||'').trim(),daysBefore:0,time:'',durationMin:0,passiveMin:0,ovenTemp:0,notes:'',kind:kindHint||'הכנה'};
  const temp=String(text).match(/(\d{2,3})\s*(?:°|מעלות|c\b)/i);if(temp)meta.ovenTemp=Number(temp[1]);
  const mins=String(text).match(/(?:כ[- ]?)?(\d+)\s*(?:-|עד|–|—)?\s*(\d+)?\s*(?:דקות|דק['׳]?)/i);
  const hours=String(text).match(/(?:כ[- ]?)?(\d+(?:[.,]\d+)?)\s*(?:-|עד|–|—)?\s*(\d+(?:[.,]\d+)?)?\s*(?:שעה|שעות)/i);
  let time=mins?Number(mins[2]||mins[1]):hours?Math.round(Number((hours[2]||hours[1]).replace(',','.'))*60):0;
  if(/יום לפני|יום קודם/.test(n))meta.daysBefore=1;
  if(/(?:^|\s)לילה(?:\s|$)|למשך הלילה|overnight/.test(n)){meta.daysBefore=Math.max(meta.daysBefore,1);time=Math.max(time,480)}
  if(/אופ|תנור/.test(n)){meta.kind='אפייה';meta.passiveMin=time}
  else if(/התפח/.test(n)){meta.kind='התפחה';meta.passiveMin=time}
  else if(/מקרר|מצננ|קירור|מקפיא|הקפא/.test(n)){meta.kind='קירור';meta.passiveMin=time}
  else if(/מניחים.*(?:דקות|שעה)|נותנים לעמוד|מנוחה/.test(n)){meta.kind='מנוחה';meta.passiveMin=time}
  else if(/מרכיב|הרכבה|ממלא|מגלגל|מעצב/.test(n))meta.kind='הרכבה';
  else if(time)meta.durationMin=time;
  return meta;
}
function localParseRecipe(text){
  const cleaned=cleanRecipePaste(text),raw=cleaned,lines=cleaned.split('\n').map(x=>x.trim()).filter(Boolean);
  let originalTitle='',mode='unknown',current=null,mainSection=null;const sections=[],warnings=[];
  const findSection=name=>sections.find(s=>cleanIngredientName(s.name)===cleanIngredientName(normalizeSectionName(name)));
  const useSection=(name,role='auto')=>{const clean=normalizeSectionName(name)||originalTitle||'מתכון ראשי';current=findSection(clean)||{id:id('sub'),name:clean,role,ingredients:[],steps:[],bakingSteps:[],notes:[]};if(role!=='auto')current.role=role;if(!sections.includes(current))sections.push(current);if(current.role==='main'&&!mainSection)mainSection=current;return current};
  const useMain=()=>{if(mainSection){current=mainSection;return current}mainSection=useSection(originalTitle||'מתכון ראשי','main');return mainSection};
  let lastIngredient=null;
  for(let index=0;index<lines.length;index++){
    const line=lines[index],plain=line.replace(/[📦✨]/g,'').trim(),next=lines[index+1]||'';
    if(!originalTitle&&index<5&&!parseIngredientLine(line)&&!isGenericHeading(line)&&!isActionLine(line)&&!/(?:רכיבים|מצרכים|חומרים|אופן הכנה)/.test(plain)&&line.length<120){originalTitle=normalizeSectionName(line);continue}
    // Alternative ingredient line: attach to the previous ingredient instead of counting twice.
    let alt=plain.match(/^(?:או|או לחלופין|לחלופין)\s+(.+)$/i);
    if(alt&&lastIngredient){
      const altIng=parseIngredientLine(alt[1]);
      lastIngredient.alternatives=[...(lastIngredient.alternatives||[]),altIng||{text:alt[1]}];
      continue;
    }
    let m=plain.match(/^((?:לקיפול|להברשה|לציפוי|לקישוט|לפיזור|להגשה))\s*:\s*(.+)$/i);
    if(m){useMain();const inline=parseIngredientLine(m[2]);if(inline){current.ingredients.push(inline);lastIngredient=inline}mode='ingredients';continue}
    m=plain.match(/^(.+?)\s*:\s*(.+)$/i);
    if(m&&isSubRecipeHeading(m[1])&&parseIngredientLine(m[2])){useSection(m[1],'sub');const inline=parseIngredientLine(m[2]);current.ingredients.push(inline);lastIngredient=inline;mode='ingredients';continue}
    m=plain.match(/^(?:מצרכים|רכיבים|חומרים|מה צריך|מה צריכים)\s+(?:ל|עבור)?\s*(.+?)\s*:?$/i);
    if(m){const heading=normalizeSectionName(m[1]);if(isMainIngredientSubsectionHeading(heading)||/^(?:ה)?בצק(?:\s|$)/.test(cleanIngredientName(heading))){useMain()}else if(isSubRecipeHeading(heading)){useSection(heading,'sub')}else useMain();mode='ingredients';continue}
    if(/^(?:מצרכים|רכיבים|חומרים|מה צריך|מה צריכים|ingredients)\s*:?$/i.test(plain)){useMain();mode='ingredients';continue}
    m=plain.match(/^(.+?)\s+(?:אופן\s+ההכנה|אופן\s+הכנה|הוראות\s+הכנה)\s*:?$/i);
    if(m){const heading=normalizeSectionName(m[1]);if(isSubRecipeHeading(heading))useSection(heading,'sub');else useMain();mode='steps';continue}
    m=plain.match(/^(?:אופן\s+הכנת|הוראות\s+הכנת)\s+(.+?)\s*:?$/i)||plain.match(/^אופן\s+ההכנה\s+(?:ל|של)\s*(.+?)\s*:?$/i);
    if(m){const heading=normalizeSectionName(m[1]);if(isSubRecipeHeading(heading))useSection(heading,'sub');else useMain();mode='steps';continue}
    if(/^(?:אופן\s+הכנה|אופן\s+ההכנה|הוראות(?:\s+הכנה)?|הכנה|שלבי\s+הכנה|איך\s+מכינים|דרך\s+הכנה|method|instructions)\s*:?$/i.test(plain)){useMain();mode='steps';continue}
    if(/^(?:אפייה|שלב\s+האפייה)\s*:?$/i.test(plain)){useMain();mode='baking';continue}
    if(/^(?:הערות|טיפים|אחסון|אחסון\s+וחיי\s+מדף)\s*:?$/i.test(plain)){if(!current)useMain();mode='notes';continue}
    if(isMainIngredientSubsectionHeading(plain)){useMain();mode=/אפייה/.test(cleanIngredientName(plain))?'baking':(/הרכבה|התפחה|עיצוב|סיום|גימור/.test(cleanIngredientName(plain))?'steps':'ingredients');continue}
    if(mode!=='steps'&&mode!=='baking'&&isSubRecipeHeading(plain)&&line.length<70&&!parseIngredientLine(line)){useSection(plain,'sub');mode='ingredients';continue}
    if(isMainMethodHeading(plain)){useMain();mode=/אפייה/.test(cleanIngredientName(plain))?'baking':'steps';continue}
    if(/^שלב\s*\d+\s*[:.\-]/i.test(plain)||/^שלב\s*\d+\b/i.test(plain)){if(!current)useMain();mode='steps';current.steps.push(inferStepMeta(plain.replace(/[:]+$/,'')));continue}
    const inlineIngredients=extractInlineIngredients(line);
    if(inlineIngredients.length>=2&&mode!=='steps'&&mode!=='baking'){if(!current)useMain();const existing=new Set(current.ingredients.map(i=>`${cleanIngredientName(i.name)}|${i.qty}|${i.unit}`));inlineIngredients.forEach(i=>{const key=`${cleanIngredientName(i.name)}|${i.qty}|${i.unit}`;if(!existing.has(key)){current.ingredients.push(i);lastIngredient=i;existing.add(key)}});mode='ingredients';continue}
    const ing=parseIngredientLine(line),nextIng=parseIngredientLine(next);
    const shortHeading=!ing&&!/^שלב\s*\d+/i.test(plain)&&!isActionLine(line)&&!isNoteLine(line)&&line.length<55&&nextIng&&!/^(?:זמן|תפוקה|טמפרטורה)/.test(line);
    if(shortHeading){if(isSubRecipeHeading(line)){useSection(line,'sub')}else useMain();mode='ingredients';continue}
    // Ingredients are accepted whenever we have not clearly entered method text yet.
    if(ing&&mode!=='steps'&&mode!=='baking'&&mode!=='notes'){if(!current)useMain();current.ingredients.push(ing);lastIngredient=ing;mode='ingredients';continue}
    const clean=line.replace(/^\d+[.)]\s*/,'').replace(/^[•*\-–—]+\s*/,'').trim();if(!clean)continue;
    if(/^מומלץ\b/.test(cleanIngredientName(clean))){if(!current)useMain();current.notes.push(clean);continue}
    const systemNoteAt=clean.search(/הערת המערכת\s*:/i);if(systemNoteAt>0){if(!current)useMain();const before=clean.slice(0,systemNoteAt).trim().replace(/[.;,:-]+$/,'');const note=clean.slice(systemNoteAt).trim();if(before)current.steps.push(inferStepMeta(before));if(note)current.notes.push(note);mode='steps';continue}
    if(current?.role==='sub'&&/(?:לחלק את הבצק|לרדד (?:את )?הבצק|לרדד כל חלק|לעצב (?:את )?הבצק|להתפיח .*?(?:מאפ|בצק)|לאפות .*?(?:מאפ|עוג|בצק))/i.test(cleanIngredientName(clean))){useMain();mode='steps'}
    if(isNoteLine(clean)||mode==='notes'){if(!current)useMain();current.notes.push(clean);mode='notes';continue}
    if(mode==='baking'){if(!current)useMain();current.bakingSteps.push(inferStepMeta(clean,'אפייה'));continue}
    if(isActionLine(clean)||mode==='steps'||sections.some(s=>s.ingredients.length)){if(!current)useMain();current.steps.push(inferStepMeta(clean));mode='steps';continue}
  }
  if(!sections.length)useMain();
  if(!mainSection)mainSection=sections.find(s=>s.role==='main')||sections.find(s=>!isSubRecipeHeading(s.name))||sections[0];
  const ingredientLinks=[];sections.forEach(container=>container.ingredients.forEach(i=>sections.forEach(candidate=>{if(candidate!==container&&candidate.ingredients.length&&candidate.role==='sub'&&ingredientNamesMatch(i.name,candidate.name))ingredientLinks.push({container,ingredient:i,sub:candidate})})));
  let main=mainSection||ingredientLinks[0]?.container||sections.slice().sort((a,b)=>b.ingredients.length-a.ingredients.length)[0]||sections[0];
  const linkedSubs=[...new Set(ingredientLinks.filter(x=>x.container===main).map(x=>x.sub))],explicitSubs=sections.filter(s=>s!==main&&s.ingredients.length&&s.role==='sub');
  const subSections=[...new Set([...linkedSubs,...explicitSubs])];
  const subRecipes=subSections.map(s=>({...s,usedQtyGrams:0,evaporationPct:0,prepMin:0,restMin:0,bakeMin:0,ovenTemp:0,notes:s.notes.join('\n')}));
  main.ingredients.forEach(i=>{const match=subRecipes.find(s=>ingredientNamesMatch(i.name,s.name));if(match){i.linkedSubRecipeId=match.id;match.usedQtyGrams=ingredientWeightData(i).grams}});
  subRecipes.forEach(sub=>{const linked=main.ingredients.find(i=>i.linkedSubRecipeId===sub.id||ingredientNamesMatch(i.name,sub.name));if(linked)return;const fullYield=Math.round(calculateSubRecipeWeight(sub).finalWeight||0);if(fullYield>0){sub.usedQtyGrams=fullYield;main.ingredients.push({name:sub.name,qty:fullYield,unit:'גרם',category:'תוספות',linkedSubRecipeId:sub.id});warnings.push(`לא צוינה כמות שימוש עבור ${sub.name}; הנחתי שכל תת-המתכון נכנס למתכון הראשי. אפשר לשנות זאת במסך העריכה.`)}});
  const inferredTitleStep=[...main.steps,...main.bakingSteps].map(x=>x.text).map(t=>String(t||'').match(/מכינים את ([^:]{2,50})\s*:/i)).filter(Boolean).map(m=>m[1].trim()).find(x=>!/^(?:הבלילה|הבצק|המילוי|הקרם|הגנאש)$/.test(cleanIngredientName(x)));
  const finalName=originalTitle||inferredTitleStep||main.name||'מתכון מיובא',allIngredients=[...main.ingredients,...subRecipes.flatMap(s=>s.ingredients)],allText=cleanIngredientName(allIngredients.map(i=>i.name).join(' ')),stepText=cleanIngredientName([...main.steps,...main.bakingSteps,...subRecipes.flatMap(s=>s.steps),...subRecipes.flatMap(s=>s.bakingSteps||[])].map(s=>s.text).join(' '));
  if(/שוקולד/.test(stepText)&&!/שוקולד/.test(allText))warnings.push('אופן ההכנה מזכיר שוקולד, אבל שוקולד לא מופיע ברשימת המצרכים. לא הוספתי שוקולד אוטומטית.');
  const temp=raw.match(/(?:תנור[^\d]{0,18}|)(\d{2,3})\s*(?:°|מעלות)/),bakeRange=raw.match(/אופים?[^\d]{0,20}(\d+)\s*(?:[-–—]\s*(\d+))?\s*(?:דקות|דק['׳]?)/i),prep=raw.match(/זמן\s+הכנה[^\d]{0,10}(\d+)/);
  let yieldM=raw.match(/(?:תפוקה|יוצא|מתקבל(?:ות|ים)?)[^\d]{0,15}(\d+)\s*(שקיות|יחידות|עוגיות|עוגות|מאפים|מנות|מגשים|מארזים)?/i);
  if(!yieldM)yieldM=raw.match(/(?:לכמות של|מספיק ל)[^\d]{0,10}(\d+)\s*(שקיות|יחידות|עוגיות|עוגות|מאפים|מנות|מגשים|מארזים)/i);
  if(!yieldM)warnings.push('לא נמצאה תפוקה מדויקת. אפשר לשמור את המתכון בלי תפוקה ולהשלים אותה מאוחר יותר.');
  const category=recipeCategoryFromText(finalName)!=='אחר'?recipeCategoryFromText(finalName):recipeCategoryFromText(raw),yieldUnit=yieldM?.[2]||'',salesUnit=/שק/.test(yieldUnit)?'שקיות':/מגש/.test(yieldUnit)?'מגשים':/מארז/.test(yieldUnit)?'מארזים':/עוגות/.test(yieldUnit)||['עוגות','עוגות שמרים','קינוחים','מאפינס וקאפקייקס','טארטים ופאי','מאפים'].includes(category)?'יחידות':/יחיד|עוגי|מאפ|מנות/.test(yieldUnit)?'יחידות':'שקיות';
  const packageM=raw.match(/(?:שקית|אריזה)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*גרם/i);
  return{name:finalName,category,salesUnit,packageWeight:packageM?Number(packageM[1].replace(',','.')):200,yieldUnits:yieldM?Number(yieldM[1]):0,unitWeight:0,prepMin:prep?Number(prep[1]):0,restMin:0,bakeMin:bakeRange?Number(bakeRange[2]||bakeRange[1]):0,ovenTemp:temp?Number(temp[1]):0,traysPerBatch:1,unitsPerTray:12,shelfLifeDays:4,wastePct:5,evaporationPct:12,salePrice:0,allergens:inferAllergens(allIngredients),notes:main.notes.join('\n'),ingredients:main.ingredients,steps:main.steps,bakingSteps:main.bakingSteps,subRecipes,warnings,recipeType:subRecipes.length?'composite':'simple'};
}
function sanitizeIngredient(i){const item=normalizeRecipeIngredient(i);return{...item,asNeeded:!!i?.asNeeded,alternatives:Array.isArray(i?.alternatives)?i.alternatives:[],linkedSubRecipeId:String(i?.linkedSubRecipeId||'')}}
function sanitizeStep(s){return{text:String(s?.text||s||'').trim(),daysBefore:Math.max(0,Number(s?.daysBefore||0)),time:String(s?.time||''),durationMin:Math.max(0,Number(s?.durationMin||0)),passiveMin:Math.max(0,Number(s?.passiveMin||0)),ovenTemp:Math.max(0,Number(s?.ovenTemp||0)),notes:String(s?.notes||''),kind:String(s?.kind||'הכנה')}}
function sanitizeImportedRecipe(data,text){
  const base=localParseRecipe(text),x=data&&typeof data==='object'?data:{},structured=base.ingredients.length>=2&&(base.steps.length+base.bakingSteps.length)>=2;
  const subsSource=structured?base.subRecipes:(Array.isArray(x.subRecipes)?x.subRecipes:base.subRecipes);
  const subs=subsSource.map((s,index)=>({id:String(s.id||id('sub')),name:String(s.name||`תת־מתכון ${index+1}`),usedQtyGrams:Math.max(0,Math.round(Number(s.usedQtyGrams||0))),evaporationPct:Math.max(0,Number(s.evaporationPct||0)),prepMin:Math.max(0,Number(s.prepMin||0)),restMin:Math.max(0,Number(s.restMin||0)),bakeMin:Math.max(0,Number(s.bakeMin||0)),ovenTemp:Math.max(0,Number(s.ovenTemp||0)),notes:String(s.notes||''),ingredients:(Array.isArray(s.ingredients)?s.ingredients:[]).map(sanitizeIngredient).filter(i=>i.name&&(i.qty||i.asNeeded)),steps:(Array.isArray(s.steps)?s.steps:[]).map(sanitizeStep).filter(s=>s.text)}));
  const ingredientSource=structured?base.ingredients:(Array.isArray(x.ingredients)?x.ingredients:base.ingredients);
  const ingredients=ingredientSource.map(sanitizeIngredient).filter(i=>i.name&&(i.qty||i.asNeeded));
  ingredients.forEach(i=>{if(!i.linkedSubRecipeId){const m=subs.find(s=>ingredientNamesMatch(i.name,s.name));if(m)i.linkedSubRecipeId=m.id}});
  subs.forEach(s=>{const i=ingredients.find(x=>x.linkedSubRecipeId===s.id||ingredientNamesMatch(x.name,s.name));if(i){i.linkedSubRecipeId=s.id;s.usedQtyGrams=ingredientWeightData(i).grams||s.usedQtyGrams}});
  const steps=(structured?base.steps:(Array.isArray(x.steps)?x.steps:base.steps)).map(sanitizeStep).filter(s=>s.text);
  const bakingSteps=(structured?base.bakingSteps:(Array.isArray(x.bakingSteps)?x.bakingSteps:base.bakingSteps)).map(sanitizeStep).filter(s=>s.text);
  return migrateRecipe({...base,...x,id:'',name:String(structured?base.name:(x.name||base.name||'מתכון מיובא')),category:String(x.category||base.category||'אחר'),packageWeight:Math.max(1,Number(x.packageWeight||base.packageWeight||200)),yieldUnits:Math.max(0,Number(x.yieldUnits??base.yieldUnits??0)),prepMin:Math.max(0,Number(x.prepMin??base.prepMin??0)),restMin:Math.max(0,Number(x.restMin??base.restMin??0)),bakeMin:Math.max(0,Number(x.bakeMin??base.bakeMin??0)),ovenTemp:Math.max(0,Number(x.ovenTemp??base.ovenTemp??0)),traysPerBatch:Math.max(1,Number(x.traysPerBatch||1)),unitsPerTray:Math.max(1,Number(x.unitsPerTray||12)),shelfLifeDays:Math.max(0,Number(x.shelfLifeDays??4)),wastePct:Math.max(0,Number(x.wastePct??5)),evaporationPct:Math.max(0,Number(x.evaporationPct??12)),salePrice:Math.max(0,Number(x.salePrice||0)),allergens:String(x.allergens||inferAllergens([...ingredients,...subs.flatMap(s=>s.ingredients)])),notes:String(structured?base.notes:(x.notes||base.notes||'')),ingredients,steps,bakingSteps,subRecipes:subs,warnings:[...new Set([...(base.warnings||[]),...(Array.isArray(x.warnings)?x.warnings:[])].map(String))]});
}
async function parseRecipeWithAI(text){if(!cloud.client||!cloud.user)return null;try{const {data,error}=await cloud.client.functions.invoke('parse-recipe',{body:{text}});if(error)throw error;return data?.recipe||data}catch(e){console.warn('AI recipe import unavailable; using local parser.',e);return null}}


/* v8.3 — מנוע ייצור דינמי, זמינות, הכנות מוקדמות ותלויות */
const DAY_NAMES=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function textMinutes(text){const n=cleanIngredientName(text),hour=n.match(/(\d+(?:[.,]\d+)?)\s*(?:שעה|שעות)/),mins=n.match(/(\d+)\s*(?:דקות|דק)/);return Math.round((hour?Number(hour[1].replace(',','.'))*60:0)+(mins?Number(mins[1]):0))}
function isPassiveText(text){return /קירור|מנוחה|מצננ|התקרר|הקפא|ייבוש|מתייצב|להתקשות|מחכים|ממתינים/.test(cleanIngredientName(text))}
function isPreprepText(text){return /קליית|קולים|טופי|קרמל|מילוי|קרם|ציפוי|רוטב|הכנה מראש|שבבים|הפשר/.test(cleanIngredientName(text))}
function groupedWorkflowFromRecipe(r){
  return (r.productionTasks||[]).map((t,i)=>({...t,id:t.id||id('flow'),title:String(t.title||`משימה ${i+1}`),type:t.type||inferTaskType(t.title||''),activeMin:Math.max(5,Number(t.activeMin||20)),passiveMin:Math.max(0,Number(t.passiveMin||0)),daysBefore:Math.max(0,Math.floor(Number(t.daysBefore??t.canPrepareDays??0))),preferredTime:String(t.preferredTime||''),notes:String(t.notes||''),order:i}));
}
function dateAt(date,time){return new Date(`${date}T${time||'00:00'}:00`)}
function availabilityForDate(date){
  const d=new Date(`${date}T12:00:00`),raw=state.settings.weeklyAvailability?.[d.getDay()]||[];
  const available=raw.filter(x=>x.available!==false).map(x=>({start:dateAt(date,x.start),end:dateAt(date,x.end),label:x.label||'זמינה'})).filter(x=>x.end>x.start);
  const blocked=raw.filter(x=>x.available===false).map(x=>({start:dateAt(date,x.start),end:dateAt(date,x.end)}));
  let slots=available;
  blocked.forEach(b=>{const next=[];slots.forEach(s=>{if(b.end<=s.start||b.start>=s.end)next.push(s);else{if(b.start>s.start)next.push({...s,end:b.start});if(b.end<s.end)next.push({...s,start:b.end})}});slots=next});
  return slots.sort((a,b)=>a.start-b.start);
}
function previousAvailableSlot(cursor,durationMin,earliestDate){
  let cur=new Date(cursor),guard=0;while(guard++<60){const date=dayKey(cur),slots=availabilityForDate(date).filter(s=>s.start<cur).sort((a,b)=>b.start-a.start);for(const slot of slots){const end=new Date(Math.min(cur.getTime(),slot.end.getTime())),start=new Date(end.getTime()-durationMin*60000);if(start>=slot.start)return{start,end};}cur=dateAt(dayKey(addDays(cur,-1)),'23:59');if(earliestDate&&cur<earliestDate)break}return null;
}
function nextAvailableSlot(cursor,durationMin){let cur=new Date(cursor),guard=0;while(guard++<60){const date=dayKey(cur),slots=availabilityForDate(date);for(const slot of slots){const start=new Date(Math.max(cur.getTime(),slot.start.getTime())),end=new Date(start.getTime()+durationMin*60000);if(end<=slot.end)return{start,end};}cur=dateAt(dayKey(addDays(cur,1)),'00:00')}return{start:cur,end:new Date(cur.getTime()+durationMin*60000)}}
function scheduleOrderBackward(o,it,r){
  const workflow=groupedWorkflowFromRecipe(r),due=new Date(o.dueAt),base=`${o.id}|${r.id}`,tasks=[];
  workflow.forEach((w,i)=>{
    const date=dayKey(addDays(due,-Math.max(0,Number(w.daysBefore||0)))),slots=availabilityForDate(date),defaultTime=slots[0]?timeFromMinutes(slots[0].start.getHours()*60+slots[0].start.getMinutes()):(state.settings.workStart||'08:00'),time=w.preferredTime||defaultTime,key=`${base}|task-${w.id}`;
    tasks.push({key,date,time,text:w.title,type:w.type,duration:Math.max(5,Number(w.activeMin||20)),passiveMin:Math.max(0,Number(w.passiveMin||0)),recipe:r.name,recipeId:r.id,customer:o.customer,recipeRuns:Math.ceil(Number(it.qty||0)/recipeYieldBags(r)),qty:Number(it.qty||0),source:r.name,done:!!state.checkedTasks[key],manual:false,orderKey:base,seq:i,dependsOn:'',isPreprep:Number(w.daysBefore||0)>0,notes:w.notes||'',daysBefore:Number(w.daysBefore||0)});
  });
  return tasks;
}
function applyOverridesAndBlocks(out){out.forEach(t=>{const ov=state.planOverrides[t.key]||{};if(ov.date)t.date=ov.date;if(ov.time)t.time=ov.time;if(ov.duration)t.duration=Number(ov.duration);if(ov.passiveMin!=null)t.passiveMin=Number(ov.passiveMin);if(ov.text!=null)t.text=String(ov.text);if(ov.type&&TASK_TYPES[ov.type])t.type=ov.type;if(ov.notes!=null)t.notes=String(ov.notes);if(ov.done!=null)t.done=!!ov.done});return out}
function shiftTaskChain(key,newDate,newTime,newDuration){const tasks=generatedTasks().filter(t=>t.orderKey),target=tasks.find(t=>t.key===key);if(!target)return;const chain=tasks.filter(t=>t.orderKey===target.orderKey&&t.seq>=target.seq).sort((a,b)=>a.seq-b.seq);let cursor=dateAt(newDate,newTime);chain.forEach((t,index)=>{const duration=index===0?newDuration:Number(t.duration||20),slot=nextAvailableSlot(cursor,duration);state.planOverrides[t.key]={...(state.planOverrides[t.key]||{}),date:dayKey(slot.start),time:timeFromMinutes(slot.start.getHours()*60+slot.start.getMinutes()),duration};cursor=new Date(slot.end.getTime()+Number(t.passiveMin||0)*60000)})}
function availabilityModal(){const rows=DAY_NAMES.map((name,day)=>{const vals=state.settings.weeklyAvailability?.[day]||[];return`<div class="availability-day"><strong>${name}</strong><div id="avail-${day}">${vals.map(v=>availabilityRow(day,v)).join('')}</div><button type="button" class="btn small ghost" onclick="App.addAvailability(${day})">+ חלון</button></div>`}).join('');modal('הזמינות שלי',`<form id="availabilityForm"><div class="notice">הגדירי חלונות שבהם את זמינה לעבודה וחסימות כמו משרד, נסיעה או פגישה. התכנון ישתמש בהם אוטומטית.</div><div class="availability-grid">${rows}</div><div class="field" style="margin-top:14px"><label>מרווח ביטחון לפני משלוח (דקות)</label><input name="buffer" type="number" min="0" step="15" value="${Number(state.settings.planningBufferMin||120)}"></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה ובנייה מחדש</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('availabilityForm').onsubmit=async e=>{e.preventDefault();const form=e.target,next={};for(let day=0;day<7;day++){next[day]=[...form.querySelectorAll(`[data-day="${day}"]`)].map(row=>({start:row.querySelector('[name=start]').value,end:row.querySelector('[name=end]').value,available:row.querySelector('[name=kind]').value==='available',label:row.querySelector('[name=label]').value||''})).filter(x=>x.start&&x.end&&x.end>x.start)}state.settings.weeklyAvailability=next;state.settings.planningBufferMin=Number(new FormData(form).get('buffer')||120);state.planOverrides={};await persist();close();render()}}
function availabilityRow(day,v={start:'09:00',end:'17:00',available:true,label:'זמינה'}){return`<div class="availability-row" data-day="${day}"><input name="start" type="time" value="${esc(v.start)}"><span>–</span><input name="end" type="time" value="${esc(v.end)}"><select name="kind"><option value="available" ${v.available!==false?'selected':''}>זמינה</option><option value="blocked" ${v.available===false?'selected':''}>חסומה</option></select><input name="label" value="${esc(v.label||'')}" placeholder="משרד / נסיעה / אפייה"><button type="button" class="icon-btn" onclick="this.closest('.availability-row').remove()">×</button></div>`}
function workflowEditor(recipeId){
  const r=recipe(recipeId);if(!r)return;const tasks=groupedWorkflowFromRecipe(r);
  modal(`משימות להזמנה — ${r.name}`,`<form id="workflowForm"><div class="notice">כתבי רק את המשימות שאת באמת מבצעת. כל משימה תופיע אוטומטית כשמתכון זה נמצא בהזמנה, לפי מספר הימים לפני מועד המסירה.</div><div id="workflowRows">${tasks.map(workflowRow).join('')}</div><div class="actions"><button type="button" class="btn small secondary" onclick="App.addWorkflowTask()">+ משימה</button><button class="btn">שמירת משימות</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  document.getElementById('workflowForm').onsubmit=async e=>{e.preventDefault();r.productionTasks=[...e.target.querySelectorAll('.workflow-row')].map(row=>{const title=row.querySelector('[name=title]').value.trim();return{id:row.dataset.id||id('flow'),title,type:inferTaskType(title),activeMin:Math.max(5,Number(row.querySelector('[name=active]').value||20)),passiveMin:0,daysBefore:Math.max(0,Math.floor(Number(row.querySelector('[name=days]').value||0))),canPrepareDays:Math.max(0,Math.floor(Number(row.querySelector('[name=days]').value||0))),preferredTime:row.querySelector('[name=preferredTime]').value,notes:row.querySelector('[name=notes]').value}}).filter(t=>t.title);state.planOverrides={};state.hiddenPlanTasks={};await persist();close();render()};
}
function workflowRow(t={}){return`<div class="workflow-row recipe-order-task-row" data-id="${esc(t.id||id('flow'))}"><div class="field workflow-title"><label>המשימה שלך</label><input name="title" value="${esc(t.title||'')}" required placeholder="לדוגמה: להכין את הטופי"></div><div class="field"><label>ימים לפני המסירה</label><input name="days" type="number" min="0" step="1" value="${Number(t.daysBefore??t.canPrepareDays??0)}"></div><div class="field"><label>משך משוער בדקות</label><input name="active" type="number" min="5" step="5" value="${Number(t.activeMin||20)}"></div><div class="field"><label>שעה מועדפת</label><input name="preferredTime" type="time" value="${esc(t.preferredTime||'')}"></div><div class="field workflow-notes"><label>הערות</label><input name="notes" value="${esc(t.notes||'')}"></div><button type="button" class="icon-btn" aria-label="מחיקת משימה" onclick="this.closest('.workflow-row').remove()">×</button></div>`}
function tabVisibility(){
  const tabs=document.getElementById('tabs');
  if(!tabs)return null;
  const buttons=[...tabs.querySelectorAll('button[data-view]')];
  const box=tabs.getBoundingClientRect();
  const visible=buttons.map((button,index)=>{
    const r=button.getBoundingClientRect();
    return{button,index,visible:r.left>=box.left-2&&r.right<=box.right+2,partial:r.right>box.left+2&&r.left<box.right-2};
  });
  return{tabs,buttons,visible};
}
function updateTabScrollButtons(){
  const info=tabVisibility();
  if(!info)return;
  const shell=info.tabs.closest('.tabs-shell');
  const left=shell?.querySelector('.tabs-scroll-left');
  const right=shell?.querySelector('.tabs-scroll-right');
  const box=info.tabs.getBoundingClientRect();
  const tolerance=3;
  const hiddenLeft=info.buttons.some(button=>button.getBoundingClientRect().left<box.left-tolerance);
  const hiddenRight=info.buttons.some(button=>button.getBoundingClientRect().right>box.right+tolerance);
  if(left)left.disabled=!hiddenLeft;
  if(right)right.disabled=!hiddenRight;
}
function scrollTabs(direction){
  const info=tabVisibility();
  if(!info)return;
  const box=info.tabs.getBoundingClientRect();
  const tolerance=3;
  let candidates;
  if(direction==='left'){
    candidates=info.buttons
      .filter(button=>button.getBoundingClientRect().left<box.left-tolerance)
      .sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right);
  }else{
    candidates=info.buttons
      .filter(button=>button.getBoundingClientRect().right>box.right+tolerance)
      .sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
  }
  const target=candidates[0];
  if(target)target.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  setTimeout(updateTabScrollButtons,450);
}
function initTabOrder(){const tabs=document.getElementById('tabs'),order=state.settings.tabOrder||[];if(!tabs||!order.length)return;const map=new Map([...tabs.querySelectorAll('button[data-view]')].map(b=>[b.dataset.view,b]));order.forEach(v=>{if(map.has(v))tabs.appendChild(map.get(v))});}
function tabOrderEditor(){const tabs=[...document.querySelectorAll('#tabs button[data-view]')];modal('סידור לשוניות',`<div class="notice">גררי את השורות לסדר הרצוי. הסדר יישמר במכשיר ובענן.</div><div id="tabOrderList" class="tab-order-list">${tabs.map(b=>`<div class="tab-order-item" draggable="true" data-view="${b.dataset.view}"><span>⋮⋮</span><strong>${esc(b.textContent.trim())}</strong></div>`).join('')}</div><div class="actions"><button class="btn" onclick="App.saveTabOrder()">שמירה</button><button class="btn ghost" onclick="App.resetTabOrder()">איפוס</button></div>`);let drag=null;document.querySelectorAll('.tab-order-item').forEach(el=>{el.ondragstart=()=>drag=el;el.ondragover=e=>{e.preventDefault();const r=el.getBoundingClientRect();el.parentElement.insertBefore(drag,e.clientY<r.top+r.height/2?el:el.nextSibling)}})}

/* תכנון שבועי */
function inferTaskType(text){const n=cleanIngredientName(text);if(/קני|מלאי|הזמנת חומר/.test(n))return'shop';if(/טופי|תת מתכון|קרם|מילוי/.test(n))return'sub';if(/אופ|תנור/.test(n))return'bake';if(/אריז|שקיל|תיוג|מדבקה/.test(n))return'pack';if(/מסיר|איסוף|משלוח/.test(n))return'delivery';if(/ניקי/.test(n))return'clean';return'prep'}
function estimateDuration(text,r,sub=null){const n=cleanIngredientName(text);if(/בדיקת מלאי/.test(n))return20;if(/רשימת קניות|קניות/.test(n))return45;if(/אריז/.test(n))return45;if(/ניקי/.test(n))return25;if(/מסיר|משלוח/.test(n))return30;if(/אופ/.test(n))return Math.max(15,Number(sub?.bakeMin||r?.bakeMin||30));return Math.max(20,Math.round(Number(sub?.prepMin||r?.prepMin||40)/Math.max(1,(sub?.steps||r?.steps||[]).length||1)))}
function globalWorkflowTaskKind(task){
  if(task?.manual)return'';
  const text=cleanIngredientName(task?.text||'');
  if(/בדיקת מלאי|רשימת חוסרים/.test(text))return'inventory';
  if(/קניות|הזמנת חומרי גלם/.test(text))return'shopping';
  return'';
}
function collapseGlobalWorkflowTasks(tasks){
  const result=[],groups=new Map();
  tasks.forEach(task=>{
    const kind=globalWorkflowTaskKind(task);
    if(!kind){result.push(task);return}
    const groupKey=`global|${kind}|${task.date}`;
    let merged=groups.get(groupKey);
    if(!merged){
      merged={...task,key:groupKey,recipe:'כל המתכונים',customer:'',source:'',notes:'',recipeRuns:0,qty:0,orderKey:'',seq:-100,dependsOn:'',globalTask:true,mergedKeys:[],_customers:new Set(),_recipes:new Set(),_notes:new Set(),done:false};
      groups.set(groupKey,merged);result.push(merged);
    }
    merged.mergedKeys.push(task.key);
    if(task.customer)merged._customers.add(task.customer);
    if(task.recipe)merged._recipes.add(task.recipe);
    if(task.notes)merged._notes.add(task.notes);
    merged.recipeRuns+=Number(task.recipeRuns||0);
    merged.qty+=Number(task.qty||0);
    merged.duration=Math.max(Number(merged.duration||0),Number(task.duration||0));
    merged.passiveMin=Math.max(Number(merged.passiveMin||0),Number(task.passiveMin||0));
    if(!merged.time||(task.time&&task.time<merged.time))merged.time=task.time;
  });
  groups.forEach(merged=>{
    merged.customer=[...merged._customers].join(' · ');
    merged.source=[...merged._recipes].join(' · ');
    merged.notes=[...merged._notes].join('\n');
    const hasOwn=Object.prototype.hasOwnProperty.call(state.checkedTasks,merged.key);
    merged.done=hasOwn?!!state.checkedTasks[merged.key]:(merged.mergedKeys.length>0&&merged.mergedKeys.every(key=>!!state.checkedTasks[key]));
    delete merged._customers;delete merged._recipes;delete merged._notes;
  });
  return result;
}
function generatedTasks(){
  let out=[];
  activeOrders().forEach(o=>{
    (o.items||[]).forEach(it=>{const r=recipe(it.recipeId);if(r)out.push(...scheduleOrderBackward(o,it,r))});
    const due=new Date(o.dueAt),deliveryKey=`${o.id}|delivery`,items=(o.items||[]).map(it=>({recipe:recipe(it.recipeId),qty:Number(it.qty||0)})).filter(x=>x.recipe),totalBags=items.reduce((sum,x)=>sum+x.qty,0),names=items.map(x=>`${x.recipe.name} × ${fmt(x.qty,0)}`).join(' · ');
    out.push({key:deliveryKey,date:dayKey(due),time:String(o.dueAt||'').slice(11,16),text:`${o.delivery==='משלוח'?'משלוח':'מסירה'} ל${o.customer}`,type:'delivery',duration:30,passiveMin:0,recipe:'כל ההזמנה',customer:o.customer,recipeRuns:0,qty:totalBags,source:names,notes:names,done:!!state.checkedTasks[deliveryKey],manual:false,orderKey:`${o.id}|delivery`,seq:9999,dependsOn:''});
  });
  activeSalesEvents().forEach(event=>{
    const pseudo={id:`event_${event.id}`,dueAt:event.eventAt,customer:event.name||'אירוע מכירה'};
    (event.items||[]).forEach(item=>{const r=recipe(item.recipeId);if(!r)return;const synthetic={recipeId:item.recipeId,qty:Number(item.targetQty||0)};out.push(...scheduleOrderBackward(pseudo,synthetic,r).map(t=>({...t,eventId:event.id,customer:event.name||'אירוע מכירה',source:`אירוע מכירה · ${salesUnitLabel(r)}`})))});
    if(event.eventAt){const key=`event:${event.id}:sale`,at=new Date(event.eventAt);out.push({key,date:dayKey(at),time:String(event.eventAt).slice(11,16)||'09:00',text:`אירוע מכירה — ${event.name}`,type:'delivery',duration:60,passiveMin:0,recipe:'אירוע מכירה',customer:event.name,recipeRuns:0,qty:0,source:'אירוע מכירה',notes:event.notes||'',done:!!state.checkedTasks[key],manual:false,eventId:event.id,orderKey:`event_${event.id}|sale`,seq:9999,dependsOn:''})}
  });
  (state.manualTasks||[]).forEach(t=>out.push({...t,done:!!state.checkedTasks[t.key],manual:true,orderKey:t.orderKey||'',seq:Number(t.seq||0),passiveMin:Number(t.passiveMin||0)}));
  (state.todoItems||[]).filter(item=>item.dueDate).forEach(item=>{
    const key=`todo:${item.id}`;
    out.push({key,date:item.dueDate,time:item.plannerTime||state.settings.workStart||'08:00',text:item.text,type:TASK_TYPES[item.plannerType]?item.plannerType:'prep',duration:Math.max(5,Number(item.plannerDuration||30)),passiveMin:Math.max(0,Number(item.plannerPassiveMin||0)),recipe:'משימה אישית',customer:'',recipeRuns:0,qty:0,source:'משימות',notes:item.notes||'',done:!!item.done,manual:false,todoId:item.id,sourceType:'todo',orderKey:'',seq:0,dependsOn:''});
  });
  out=collapseGlobalWorkflowTasks(out);
  applyOverridesAndBlocks(out);
  return out.filter(t=>!state.hiddenPlanTasks[t.key]).sort((a,b)=>(a.date+(a.time||'99:99')).localeCompare(b.date+(b.time||'99:99'))||Number(a.seq||0)-Number(b.seq||0));
}
function workdayCapacity(date=dayKey(new Date())){return availabilityForDate(date).reduce((a,s)=>a+(s.end-s.start)/60000,0)}
function weekStart(value){const d=new Date(value);d.setHours(12,0,0,0);d.setDate(d.getDate()-d.getDay());return d}
function plannerSuggestions(tasks){
  const openTasks=tasks.filter(t=>!t.done),by={};openTasks.forEach(t=>(by[t.date]||(by[t.date]=[])).push(t));
  const overloaded=Object.entries(by).filter(([date,list])=>{const cap=workdayCapacity(date);if(cap<=0)return false;const inHours=list.filter(t=>isTaskWithinAvailability(date,t.time,t.duration));return inHours.reduce((a,t)=>a+Number(t.duration||0),0)>cap});
  const outside=openTasks.filter(t=>!isTaskWithinAvailability(t.date,t.time,t.duration)).length,unscheduled=openTasks.filter(t=>t.unscheduled).length,missing=activeOrders().filter(o=>new Date(o.dueAt)<new Date()).length;
  const parts=[];if(outside)parts.push(`${outside} משימות מחוץ לשעות הזמינות`);if(unscheduled)parts.push(`${unscheduled} משימות עדיין לא שובצו`);if(overloaded.length)parts.push(`${overloaded.length} ימים עמוסים מעבר לשעות העבודה שהוגדרו`);if(shopping().length)parts.push(`${shopping().length} חומרי גלם חסרים כרגע`);if(missing)parts.push(`${missing} הזמנות שמועדן עבר`);return parts.length?parts.join(' · '):'התוכנית מסודרת. אפשר לגרור כל משימה לכל שעה; שעות הזמינות משמשות כהמלצה ולא כחסימה.'
}
function go(view){if(view==='todo')view='production';currentView=view;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${view}`));document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view===view));render();const active=document.querySelector(`#tabs button[data-view="${view}"]`);active?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});window.scrollTo({top:0,behavior:'smooth'})}
function openPlanner(){plannerMode='week';plannerWeekOffset=0;go('planner')}
function modal(title,html){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=html;document.getElementById('modal').classList.add('open')}
function close(){document.getElementById('modal').classList.remove('open')}
function render(){document.getElementById('brandTitle').textContent=state.settings.businessName||'Bakery Workspace';({dashboard:renderDashboard,orders:renderOrders,invoices:renderInvoices,todo:renderProduction,planner:renderPlanner,assistant:renderAssistant,recipes:renderRecipes,recipebook:renderRecipeBook,production:renderProduction,shopping:renderShopping,inventory:renderInventory,suppliers:renderSuppliers,reports:renderReports,settings:renderSettings}[currentView]||renderDashboard)()}

function taskHtml(t){return`<div class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="App.toggleTask('${esc(t.key)}')"><div class="task-text"><strong>${esc(t.text)}</strong><div class="meta">${esc(t.recipe)} · ${t.recipeRuns||1} הכנות · ${fmt(t.qty,0)} שקיות · ${esc(t.customer)} ${t.time?'· '+esc(t.time):''}</div></div></div>`}
function managedTaskHtml(t){return`<div class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="App.toggleTask('${esc(t.key)}')"><div class="task-text" role="button" tabindex="0" onclick="App.editPlanTask('${esc(t.key)}')"><strong>${esc(t.text)}</strong><div class="meta">${esc(t.recipe)} · ${t.recipeRuns||1} הכנות · ${fmt(t.qty||0,0)} שקיות · ${esc(t.customer||'')} ${t.time?'· '+esc(t.time):''}</div></div><button class="btn small ghost" onclick="App.editPlanTask('${esc(t.key)}')">עריכה</button></div>`}
function renderDashboard(){
  const os=activeOrders(),ts=generatedTasks(),today=dayKey(new Date()),up=os.slice().sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,4),todayTasks=ts.filter(t=>t.date===today&&!t.done),bags=os.reduce((sum,o)=>sum+(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0),0),heroMessage=heroMessageForSession(),shop=shopping(),revenueExpected=os.reduce((s,o)=>s+revenue(o),0),doneToday=ts.filter(t=>t.date===today&&t.done).length,totalToday=ts.filter(t=>t.date===today).length,progress=totalToday?Math.round(doneToday/totalToday*100):0,nextOrder=up[0];
  document.getElementById('view-dashboard').innerHTML=`
  <section class="modern-home-hero">
    <div class="modern-home-copy">
      <div class="home-eyebrow"><span></span> BAKERY WORKSPACE</div>
      <div class="hero-message"><h2 id="heroTitle">${esc(heroMessage.title)}</h2><p id="heroSubtitle">${esc(heroMessage.text)}</p></div>
      <div class="home-date">${new Date().toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})}</div>
      <div class="home-actions"><button class="btn home-primary" onclick="App.openPlanner()">מה אני מכינה היום? <span>←</span></button><button class="btn home-secondary" onclick="App.newOrder()">+ הזמנה חדשה</button></div>
      <div class="home-mini-proof"><span class="proof-dots"><i></i><i></i><i></i></span><strong>${totalToday||0}</strong> משימות מתוכננות להיום · <strong>${progress}%</strong> הושלמו</div>
    </div>
    <div class="bakery-visual" aria-hidden="true">
      <div class="visual-orbit orbit-one"></div><div class="visual-orbit orbit-two"></div>
      <div class="visual-card visual-order"><span>הזמנה קרובה</span><strong>${nextOrder?esc(nextOrder.customer):'הכול רגוע'}</strong><small>${nextOrder?dateText(nextOrder.dueAt):'אין הזמנה דחופה'}</small></div>
      <div class="visual-card visual-bags"><span>שקיות פעילות</span><strong>${bags}</strong><small>מוכנות לתכנון</small></div>
      <div class="mixing-bowl"><div class="whisk"></div><div class="bowl-top"></div><div class="bowl-body"><span>✦</span></div></div>
      <div class="cookie cookie-a">✦</div><div class="cookie cookie-b">•</div><div class="cookie cookie-c">✦</div>
      <div class="visual-pill"><span class="pulse-dot"></span> העסק מסונכרן</div>
    </div>
  </section>

  <section class="home-metrics">
    <button class="home-metric metric-orders" onclick="App.go('orders')"><span class="metric-icon">◇</span><div><small>הזמנות פעילות</small><strong>${os.length}</strong><em>לצפייה בהזמנות ←</em></div></button>
    <button class="home-metric metric-tasks" onclick="App.go('production')"><span class="metric-icon">✓</span><div><small>משימות להיום</small><strong>${todayTasks.length}</strong><em>${progress}% הושלמו</em></div><span class="ring" style="--p:${progress}">${progress}%</span></button>
    <button class="home-metric metric-shopping" onclick="App.go('shopping')"><span class="metric-icon">⌑</span><div><small>חוסרים לקנייה</small><strong>${shop.length}</strong><em>${shop.length?'דורש תשומת לב':'המלאי מסודר'}</em></div></button>
    <button class="home-metric metric-income" onclick="App.go('reports')"><span class="metric-icon">↗</span><div><small>הכנסה צפויה</small><strong>${money(revenueExpected)}</strong><em>מהזמנות פעילות</em></div></button>
  </section>

  <section class="home-content-grid">
    <div class="home-panel today-panel">
      <div class="home-panel-head"><div><span class="panel-kicker">היום במטבח</span><h3>התוכנית שלך, בפשטות</h3></div><button class="text-link" onclick="App.openPlanner()">ללוח המלא ←</button></div>
      <div class="progress-track"><span style="width:${progress}%"></span></div>
      <div class="home-task-list">${todayTasks.slice(0,5).map((t,i)=>`<div class="home-task"><button class="home-check" onclick="App.toggleTask('${esc(t.key)}')"></button><span class="task-index">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(t.text)}</strong><small>${esc(t.recipe)} ${t.time?'· '+esc(t.time):''}</small></div><span class="task-type">${esc(TASK_TYPES[t.type]||'משימה')}</span></div>`).join('')||'<div class="home-empty"><span>✓</span><strong>כל המשימות להיום הושלמו</strong><small>משימות שסומנו כבוצעו מוסתרות מהמסך הראשי</small></div>'}</div>
    </div>

    <div class="home-panel order-panel">
      <div class="home-panel-head"><div><span class="panel-kicker">ההזמנה הקרובה</span><h3>${nextOrder?esc(nextOrder.customer):'אין הזמנה קרובה'}</h3></div>${nextOrder?`<span class="badge green">${esc(nextOrder.status)}</span>`:''}</div>
      ${nextOrder?`<div class="next-order-date"><span>מועד מסירה</span><strong>${dateText(nextOrder.dueAt)}</strong></div><div class="next-order-items">${(nextOrder.items||[]).slice(0,4).map(i=>`<div><span>${esc(recipe(i.recipeId)?.name||'מתכון')}</span><strong>${fmt(i.qty,0)} שקיות</strong></div>`).join('')}</div><button class="btn home-secondary full" onclick="App.editOrder('${nextOrder.id}')">פתיחת ההזמנה</button>`:'<div class="home-empty"><span>◇</span><strong>אפשר לנשום</strong><small>כשתתווסף הזמנה, היא תופיע כאן</small></div>'}
    </div>

    <div class="home-panel shopping-panel">
      <div class="home-panel-head"><div><span class="panel-kicker">קניות נדרשות</span><h3>מה חסר עכשיו</h3></div><button class="text-link" onclick="App.go('shopping')">לרשימה ←</button></div>
      <div class="shopping-chips">${shop.slice(0,6).map((i,idx)=>`<div class="shopping-chip"><span class="chip-dot dot-${idx%4}"></span><div><strong>${esc(i.name)}</strong><small>${showQty(i.need,i.unit)}</small></div></div>`).join('')||'<div class="home-empty compact"><span>✓</span><strong>אין חוסרים</strong></div>'}</div>
    </div>

    <div class="home-panel quick-panel">
      <div class="home-panel-head"><div><span class="panel-kicker">פעולות מהירות</span><h3>מה תרצי לעשות?</h3></div></div>
      <div class="quick-actions-grid"><button onclick="App.newRecipe()"><span>✎</span><strong>מתכון חדש</strong><small>הזנה ידנית</small></button><button onclick="App.importRecipe()"><span>✦</span><strong>הדבקת מתכון</strong><small>ניתוח חכם</small></button><button onclick="App.newInventory()"><span>▣</span><strong>עדכון מלאי</strong><small>כמות חדשה</small></button><button onclick="App.productionSummary()"><span>◫</span><strong>סיכום ייצור</strong><small>עדכון המלאי</small></button></div>
    </div>
  </section>`;
  revealHeroMessage();
}

function renderOrders(){
  const rows=state.orders.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),events=(state.salesEvents||[]).slice().sort((a,b)=>String(a.eventAt).localeCompare(String(b.eventAt)));
  const orderTable=rows.length?`<div class="table-wrap"><table><thead><tr><th>לקוחה</th><th>מועד</th><th>שקיות</th><th>סטטוס</th><th>תשלום</th><th>סכום</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td><strong>${esc(o.customer)}</strong>${o.recurringWeekly?'<div><span class="badge gold">הזמנה שבועית</span></div>':''}<div class="muted">${esc(o.phone||'')}</div></td><td>${dateText(o.dueAt)}<div class="muted">${esc(o.delivery)}</div></td><td>${(o.items||[]).map(i=>`${esc(recipe(i.recipeId)?.name||'מתכון נמחק')} × ${fmt(i.qty,0)} שקיות`).join('<br>')}</td><td><span class="badge">${esc(o.status)}</span></td><td>${o.paid?'<span class="badge green">שולם</span>':'<span class="badge red">לא שולם</span>'}</td><td class="money">${money(revenue(o))}</td><td><div class="actions"><button class="btn small secondary" onclick="App.repeatOrderNextWeek('${o.id}')">לשבוע הבא</button><button class="btn small secondary" onclick="App.invoiceFromOrder('${o.id}')">חשבונית</button><button class="btn small ghost" onclick="App.editOrder('${o.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteOrder('${o.id}')">מחיקה</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">עדיין אין הזמנות</div>';
  const eventCards=events.length?`<div class="sales-event-grid">${events.map(event=>{const target=(event.items||[]).reduce((s,i)=>s+Number(i.targetQty||0),0),prepared=(event.items||[]).reduce((s,i)=>s+Number(i.preparedQty||0),0),sold=(event.items||[]).reduce((s,i)=>s+Number(i.soldQty||0),0);return`<article class="sales-event-card"><div class="section-head"><div><span class="badge green">אירוע מכירה</span><h3>${esc(event.name)}</h3><div class="meta">${dateText(event.eventAt)} · ${esc(event.status)}</div></div><div class="actions"><button class="btn small ghost" onclick="App.editSalesEvent('${event.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteSalesEvent('${event.id}')">מחיקה</button></div></div><div class="event-metrics"><span><strong>${target}</strong><small>יעד</small></span><span><strong>${prepared}</strong><small>הוכן</small></span><span><strong>${sold}</strong><small>נמכר</small></span><span><strong>${money(salesEventActualRevenue(event))}</strong><small>הכנסה בפועל</small></span></div><div class="event-items">${(event.items||[]).map(item=>{const r=recipe(item.recipeId),left=Math.max(0,Number(item.preparedQty||0)-Number(item.soldQty||0));return`<div><strong>${esc(r?.name||'מתכון נמחק')}</strong><span>יעד ${fmt(item.targetQty,0)} ${esc(item.unit)} · הוכן ${fmt(item.preparedQty,0)} · נמכר ${fmt(item.soldQty,0)} · נשאר ${fmt(left,0)}</span></div>`}).join('')||'<div class="empty compact">אין מוצרים</div>'}</div><div class="event-revenue"><span>הכנסה צפויה לפי היעד</span><strong>${money(salesEventExpectedRevenue(event))}</strong></div></article>`}).join('')}</div>`:'<div class="empty">עדיין אין אירועי מכירה.</div>';
  document.getElementById('view-orders').innerHTML=`<div class="card"><div class="section-head"><div><h2>הזמנות</h2><div class="hint">הזמנה היא כמות שסוכמה מראש עם לקוחה.</div></div><button class="btn secondary" onclick="App.newOrder()">+ הזמנה חדשה</button></div>${orderTable}</div><div class="card" style="margin-top:18px"><div class="section-head"><div><h2>אירועי מכירה</h2><div class="hint">לדוכן או יום מכירה: הגדירי מה את מתכננת להכין, ואחרי האירוע עדכני כמה הוכן וכמה נמכר בפועל.</div></div><button class="btn secondary" onclick="App.newSalesEvent()">+ אירוע מכירה</button></div>${eventCards}</div>`;
}
function orderRow(i){return`<div class="repeat-row order-item-row"><div class="field"><label>מתכון</label><select class="oi-r" required><option value="">בחירה</option>${state.recipes.map(r=>`<option value="${r.id}" ${i.recipeId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>מספר שקיות</label><input class="oi-q" type="number" min="1" step="1" value="${i.qty||1}"></div><div></div><div></div><button type="button" class="btn small danger" onclick="this.closest('.order-item-row').remove()">הסר</button></div>`}
function orderForm(o={id:'',customer:'',phone:'',dueAt:'',delivery:'איסוף עצמי',status:'חדשה',paid:false,notes:'',items:[],recurringWeekly:false,seriesId:''}){modal(o.id?'עריכת הזמנה':'הזמנה חדשה',`<form id="orderForm"><input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="seriesId" value="${esc(o.seriesId||'')}"><div class="form-grid"><div class="field"><label>שם הלקוחה</label><input name="customer" required value="${esc(o.customer)}"></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(o.phone)}"></div><div class="field"><label>מועד אספקה</label><input name="dueAt" type="datetime-local" required value="${esc((o.dueAt||'').slice(0,16))}"></div><div class="field"><label>מסירה</label><select name="delivery">${['איסוף עצמי','משלוח'].map(x=>`<option ${o.delivery===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>סטטוס</label><select name="status">${STATUSES.map(x=>`<option ${o.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>תשלום</label><select name="paid"><option value="false" ${!o.paid?'selected':''}>לא שולם</option><option value="true" ${o.paid?'selected':''}>שולם</option></select></div><div class="field full"><label style="display:flex;align-items:center;gap:9px"><input type="checkbox" name="recurringWeekly" ${o.recurringWeekly?'checked':''}> הזמנה שבועית קבועה</label><div class="hint">לא נוצרת סדרה אוטומטית. בכל שבוע לוחצים „לשבוע הבא”, וכל הפרטים מועתקים; אחר כך אפשר לערוך רק את ההזמנה החדשה.</div></div><div class="field full"><label>מוצרים ומספר שקיות</label><div id="orderItems">${(o.items.length?o.items:[{recipeId:'',qty:1}]).map(orderRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addOrderItem()">+ מוצר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(o.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('orderForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.orders.find(x=>x.id===f.get('id')),items=[...document.querySelectorAll('.order-item-row')].map(r=>({recipeId:r.querySelector('.oi-r').value,qty:Math.max(1,Math.floor(Number(r.querySelector('.oi-q').value||0)))})).filter(x=>x.recipeId&&x.qty);if(!items.length)return alert('יש להוסיף מוצר');const x={id:f.get('id')||id('ord'),customer:f.get('customer'),phone:f.get('phone'),dueAt:f.get('dueAt'),delivery:f.get('delivery'),status:f.get('status'),paid:f.get('paid')==='true',notes:f.get('notes'),items,recurringWeekly:f.get('recurringWeekly')==='on',seriesId:f.get('seriesId')||ex?.seriesId||'',createdAt:ex?.createdAt||new Date().toISOString()};if(x.recurringWeekly&&!x.seriesId)x.seriesId=id('series');if(ex)Object.assign(ex,x);else state.orders.push(x);await persist();close();render()}}


function salesEventItemRow(item={}){
  const r=recipe(item.recipeId),unit=SALES_UNITS.includes(item.unit)?item.unit:(r?salesUnitLabel(r):'יחידות'),price=Number(item.unitPrice??r?.salePrice??0);
  return`<div class="repeat-row sales-event-item-row"><div class="field"><label>מוצר / מתכון</label><select class="sei-r" required onchange="App.syncSalesEventItem(this)"><option value="">בחירה</option>${state.recipes.map(x=>`<option value="${x.id}" ${item.recipeId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>יחידת מכירה</label><select class="sei-u">${SALES_UNITS.map(x=>`<option ${unit===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>כמות מתוכננת</label><input class="sei-target" type="number" min="0" step="1" value="${Math.round(Number(item.targetQty||0))}"></div><div class="field"><label>מחיר מכירה</label><input class="sei-price" type="number" min="0" step="0.01" value="${price}"></div><div class="field"><label>הוכן בפועל</label><input class="sei-prepared" type="number" min="0" step="1" value="${Math.round(Number(item.preparedQty||0))}"></div><div class="field"><label>נמכר בפועל</label><input class="sei-sold" type="number" min="0" step="1" value="${Math.round(Number(item.soldQty||0))}"></div><button type="button" class="btn small danger" onclick="this.closest('.sales-event-item-row').remove()">הסר</button></div>`
}
function syncSalesEventItem(select){const row=select.closest('.sales-event-item-row'),r=recipe(select.value);if(!row||!r)return;row.querySelector('.sei-u').value=salesUnitLabel(r);row.querySelector('.sei-price').value=Number(r.salePrice||0)}
function readSalesEventItems(){return[...document.querySelectorAll('.sales-event-item-row')].map(row=>({recipeId:row.querySelector('.sei-r').value,unit:row.querySelector('.sei-u').value,targetQty:Math.max(0,Math.round(Number(row.querySelector('.sei-target').value||0))),unitPrice:Math.max(0,Number(row.querySelector('.sei-price').value||0)),preparedQty:Math.max(0,Math.round(Number(row.querySelector('.sei-prepared').value||0))),soldQty:Math.max(0,Math.round(Number(row.querySelector('.sei-sold').value||0)))})).filter(x=>x.recipeId)}
function salesEventForm(raw={}){
  const event={id:'',name:'מכירת מאפים',eventAt:'',status:'מתוכנן',notes:'',items:[],...raw};
  modal(event.id?'עריכת אירוע מכירה':'אירוע מכירה חדש',`<form id="salesEventForm"><input type="hidden" name="id" value="${esc(event.id)}"><div class="notice">אירוע מכירה שונה מהזמנה: את מגדירה יעד ייצור מראש, ואחרי האירוע מעדכנת כמה הוכן וכמה נמכר.</div><div class="form-grid" style="margin-top:14px"><div class="field"><label>שם האירוע</label><input name="name" required value="${esc(event.name)}" placeholder="למשל: מכירת מאפים שישי"></div><div class="field"><label>מועד המכירה</label><input name="eventAt" type="datetime-local" required value="${esc(String(event.eventAt||'').slice(0,16))}"></div><div class="field"><label>סטטוס</label><select name="status">${SALES_EVENT_STATUSES.map(x=>`<option ${event.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field full"><label>מוצרים</label><div id="salesEventItems">${(event.items?.length?event.items:[{}]).map(salesEventItemRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addSalesEventItem()">+ מוצר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(event.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  document.getElementById('salesEventForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),items=readSalesEventItems();if(!items.length)return alert('יש להוסיף לפחות מוצר אחד');const existing=state.salesEvents.find(x=>x.id===f.get('id')),obj={id:f.get('id')||id('event'),name:String(f.get('name')||'אירוע מכירה').trim(),eventAt:String(f.get('eventAt')||''),status:String(f.get('status')||'מתוכנן'),notes:String(f.get('notes')||''),items,createdAt:existing?.createdAt||new Date().toISOString()};if(existing)Object.assign(existing,obj);else state.salesEvents.push(obj);await persist();close();render()}
}


function plannerDayRange(date){return{start:0,end:23*60+45}}
function isTaskWithinAvailability(date,time,duration=0){
  const slots=availabilityForDate(date);if(!slots.length)return false;
  const start=minutesFromTime(time||'00:00'),end=start+Math.max(0,Number(duration||0));
  return slots.some(slot=>{const ss=slot.start.getHours()*60+slot.start.getMinutes(),se=slot.end.getHours()*60+slot.end.getMinutes();return start>=ss&&end<=se});
}
function plannerDropTime(clientY,date,dayEl){
  const body=dayEl.querySelector('.planner-day-body')||dayEl,rect=body.getBoundingClientRect(),range=plannerDayRange(date);
  const ratio=Math.max(0,Math.min(1,(clientY-rect.top)/Math.max(1,rect.height)));
  const raw=range.start+ratio*(range.end-range.start),snap=15;
  return timeFromMinutes(Math.round(raw/snap)*snap);
}
function showPlannerDropHint(dayEl,time){
  document.querySelectorAll('.planner-day.drag-target').forEach(x=>x.classList.remove('drag-target'));
  document.querySelectorAll('.planner-drop-time').forEach(x=>x.remove());
  if(!dayEl)return;
  dayEl.classList.add('drag-target');
  const hint=document.createElement('div');hint.className='planner-drop-time';hint.textContent=`העברה ל־${time}`;
  dayEl.appendChild(hint);
}
function clearPlannerDropHint(){document.querySelectorAll('.planner-day.drag-target').forEach(x=>x.classList.remove('drag-target'));document.querySelectorAll('.planner-drop-time').forEach(x=>x.remove())}
async function movePlanTask(key,date,time){
  const t=generatedTasks().find(x=>x.key===key);if(!t)return;
  if(t.todoId){
    const item=state.todoItems.find(x=>x.id===t.todoId);if(item){item.dueDate=date;item.plannerTime=time||t.time||state.settings.workStart||'08:00'}
  }else state.planOverrides[key]={...(state.planOverrides[key]||{}),date,time:time||t.time};
  await persist();lastPlanDragEnd=Date.now();clearPlannerDropHint();render();
}
function dragOverPlanTask(e,date){e.preventDefault();const dayEl=e.currentTarget,time=plannerDropTime(e.clientY,date,dayEl);showPlannerDropHint(dayEl,time);e.dataTransfer.dropEffect='move'}
async function dropPlanTaskAt(e,date){e.preventDefault();const key=draggedTaskKey||e.dataTransfer.getData('text/plain');if(!key)return;const time=plannerDropTime(e.clientY,date,e.currentTarget);draggedTaskKey='';await movePlanTask(key,date,time)}
function startTouchPlanDrag(e,key){
  if(e.pointerType==='mouse')return;
  const card=e.currentTarget.closest('.plan-card');if(!card)return;
  clearTimeout(touchPlanDrag?.timer);
  touchPlanDrag={key,card,ghost:null,target:null,date:'',time:'',pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,active:false,timer:null};
  touchPlanDrag.timer=setTimeout(()=>{
    if(!touchPlanDrag||touchPlanDrag.key!==key)return;
    const ghost=card.cloneNode(true);ghost.classList.add('plan-drag-ghost');ghost.removeAttribute('onclick');document.body.appendChild(ghost);
    touchPlanDrag.ghost=ghost;touchPlanDrag.active=true;
    try{card.setPointerCapture(e.pointerId)}catch(_e){}
    if(navigator.vibrate)navigator.vibrate(20);
    moveTouchPlanDrag(e);
  },380);
}
function moveTouchPlanDrag(e){
  if(!touchPlanDrag)return;
  if(!touchPlanDrag.active){
    if(Math.hypot(e.clientX-touchPlanDrag.startX,e.clientY-touchPlanDrag.startY)>10){clearTimeout(touchPlanDrag.timer);touchPlanDrag=null}
    return;
  }
  e.preventDefault();
  const{ghost}=touchPlanDrag;ghost.style.left=`${e.clientX+12}px`;ghost.style.top=`${e.clientY+12}px`;
  ghost.style.display='none';const el=document.elementFromPoint(e.clientX,e.clientY);ghost.style.display='block';
  const dayEl=el?.closest?.('.planner-day');
  if(dayEl){const date=dayEl.dataset.date,time=plannerDropTime(e.clientY,date,dayEl);touchPlanDrag.target=dayEl;touchPlanDrag.date=date;touchPlanDrag.time=time;showPlannerDropHint(dayEl,time)}else{touchPlanDrag.target=null;clearPlannerDropHint()}
}
async function endTouchPlanDrag(e){
  if(!touchPlanDrag)return;
  const drag=touchPlanDrag;touchPlanDrag=null;clearTimeout(drag.timer);
  if(!drag.active)return;
  e.preventDefault();drag.ghost?.remove();
  if(drag.target&&drag.date)await movePlanTask(drag.key,drag.date,drag.time);else{clearPlannerDropHint();lastPlanDragEnd=Date.now()}
}

function renderPlanner(){
  const tasks=generatedTasks(),base=addDays(weekStart(new Date()),plannerWeekOffset*7),days=Array.from({length:7},(_,i)=>addDays(base,i)),today=dayKey(new Date());
  const controls=`<div class="planner-toolbar"><div><h2>תכנון שבועי ויומי</h2><div class="hint">גררי משימה ליום או לשעה אחרת. רק המשימה שבחרת תזוז. אפשר לערוך או למחוק ישירות מהכרטיס.</div></div><div class="actions"><button class="btn small ghost" onclick="App.plannerPrev()">‹ שבוע קודם</button><button class="btn small ghost" onclick="App.plannerToday()">השבוע</button><button class="btn small ghost" onclick="App.plannerNext()">שבוע הבא ›</button><button class="btn small secondary" onclick="App.buildPlan()">✨ בנה לי שבוע עבודה</button><button class="btn small" onclick="App.newManualTask()">+ משימה ידנית</button><button class="btn small ghost" onclick="window.print()">הדפסה</button></div></div>`;
  const toggle=`<div class="inner-tabs"><button class="${plannerMode==='week'?'active':''}" onclick="App.setPlannerMode('week')">שבוע</button><button class="${plannerMode==='day'?'active':''}" onclick="App.setPlannerMode('day')">יום</button></div>`;
  let body='';
  if(plannerMode==='week'){
    body=`<div class="planner-week">${days.map(d=>{const key=dayKey(d),list=tasks.filter(t=>t.date===key),minutes=list.reduce((a,t)=>a+Number(t.duration||0),0),within=list.filter(t=>!t.done&&isTaskWithinAvailability(key,t.time,t.duration)),availableMinutes=within.reduce((a,t)=>a+Number(t.duration||0),0),capacity=workdayCapacity(key),over=capacity>0&&availableMinutes>capacity;return`<section class="planner-day ${over?'overload':''} ${key===today?'today':''}" data-date="${key}" ondragover="App.dragOverPlanTask(event,'${key}')" ondragleave="if(!this.contains(event.relatedTarget))App.clearPlannerDropHint()" ondrop="App.dropPlanTaskAt(event,'${key}')"><div class="planner-day-head"><strong>${d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric'})}</strong><span>${Math.round(minutes/60*10)/10} שעות${over?' ⚠':''}</span></div><div class="planner-day-body">${list.map(planCardHtml).join('')||'<div class="muted" style="text-align:center;padding:20px 4px">פנוי</div>'}</div></section>`}).join('')}</div>`;
  }else{
    const list=tasks.filter(t=>t.date===plannerDay);body=`<div class="card"><div class="section-head"><div><h2>סדר היום</h2><div class="hint">${new Date(plannerDay+'T12:00').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})}</div></div><input type="date" value="${plannerDay}" onchange="App.setPlannerDay(this.value)"></div><div class="planner-day-list">${list.map(t=>`<div class="day-agenda-row"><strong>${esc(t.time)}</strong><div>${planCardHtml(t)}</div></div>`).join('')||'<div class="empty">אין משימות ביום הזה</div>'}</div></div>`;
  }
  const visibleKeys=new Set(days.map(dayKey)),visibleTasks=plannerMode==='week'?tasks.filter(t=>visibleKeys.has(t.date)):tasks.filter(t=>t.date===plannerDay),suggestion=plannerSuggestions(visibleTasks);
  document.getElementById('view-planner').innerHTML=`${controls}<div class="notice ${suggestion.includes('עמוסים')?'warning':'success'}">${esc(suggestion)}</div><div class="planner-legend"><span class="badge">קניות</span><span class="badge gold">תת־מתכון</span><span class="badge rose">אפייה ואריזה</span><span class="badge green">מסירה</span></div>${toggle}${body}`;
}
function planCardHtml(t){const outside=!isTaskWithinAvailability(t.date,t.time,t.duration);return`<article class="plan-card type-${esc(t.type)} ${t.done?'done':''} ${outside?'outside-availability':''}" draggable="true" ondragstart="App.dragPlanTask(event,'${esc(t.key)}')" onpointerdown="App.startTouchPlanDrag(event,'${esc(t.key)}')" onpointermove="App.moveTouchPlanDrag(event)" onpointerup="App.endTouchPlanDrag(event)" onpointercancel="App.endTouchPlanDrag(event)" oncontextmenu="return false" onclick="if(Date.now()-lastPlanDragEnd>500)App.editPlanTask('${esc(t.key)}')"><div class="plan-card-actions" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()"><button type="button" class="plan-card-action" draggable="false" title="עריכה" aria-label="עריכת משימה" onclick="event.stopPropagation();App.editPlanTask('${esc(t.key)}')">✎</button><button type="button" class="plan-card-action delete" draggable="false" title="מחיקה" aria-label="מחיקת משימה" onclick="event.stopPropagation();App.deletePlanTask('${esc(t.key)}')">×</button></div><div class="plan-time">${esc(t.time||'לא שובץ')} · ${fmt(t.duration,0)} דק׳ פעיל${t.passiveMin?` · ${fmt(t.passiveMin,0)} דק׳ פסיבי`:''}${outside?' · <span class="outside-label">מחוץ לזמינות</span>':''}</div><div class="plan-title">${t.isPreprep?'<span class="badge gold">הכנה מקדימה</span> ':''}${esc(t.text)}</div><div class="meta">${esc(t.recipe||'משימה אישית')}${t.customer?' · '+esc(t.customer):''}${t.source&&t.source!==t.recipe?' · '+esc(t.source):''}</div></article>`}
function editPlanTask(key){const task=generatedTasks().find(t=>t.key===key);if(!task)return;modal('עריכת משימה',`<form id="planTaskForm"><div class="form-grid"><div class="field full"><label>שם המשימה</label><input name="text" required value="${esc(task.text||'')}"></div><div class="field"><label>תאריך</label><input name="date" type="date" value="${esc(task.date)}"></div><div class="field"><label>שעה</label><input name="time" type="time" value="${esc(task.time)}"></div><div class="field"><label>זמן פעיל בדקות</label><input name="duration" type="number" min="5" step="5" value="${task.duration||30}"></div><div class="field"><label>זמן פסיבי אחריו</label><input name="passive" type="number" min="0" step="5" value="${task.passiveMin||0}"></div><div class="field"><label>סוג המשימה</label><select name="type">${Object.entries(TASK_TYPES).map(([k,v])=>`<option value="${k}" ${task.type===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>סטטוס</label><select name="done"><option value="false" ${!task.done?'selected':''}>פתוחה</option><option value="true" ${task.done?'selected':''}>בוצעה</option></select></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(task.notes||'')}</textarea></div></div><div class="notice" style="margin-top:12px">${task.todoId?'המשימה מסונכרנת עם מרכז המשימות. שינוי כאן יתעדכן גם ברשימת המשימות האישיות.':'השינויים חלים רק על המשימה הזאת.'}</div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn danger" onclick="App.deletePlanTask('${esc(task.key)}')">מחיקה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('planTaskForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),updates={text:String(f.get('text')||'').trim(),date:String(f.get('date')||task.date),time:String(f.get('time')||task.time),duration:Number(f.get('duration')||30),passiveMin:Number(f.get('passive')||0),type:String(f.get('type')||task.type),notes:String(f.get('notes')||'')};if(task.todoId){const item=state.todoItems.find(x=>x.id===task.todoId);if(item){item.text=updates.text;item.dueDate=updates.date;item.plannerTime=updates.time;item.plannerDuration=updates.duration;item.plannerPassiveMin=updates.passiveMin;item.plannerType=updates.type;item.notes=updates.notes;item.done=f.get('done')==='true'}}else if(task.manual){const manual=state.manualTasks.find(t=>t.key===key);if(manual)Object.assign(manual,updates);delete state.planOverrides[key];state.checkedTasks[key]=f.get('done')==='true'}else{state.planOverrides[key]={...(state.planOverrides[key]||{}),...updates};state.checkedTasks[key]=f.get('done')==='true'}await persist();close();render()}}
async function deletePlanTask(key){const task=generatedTasks().find(t=>t.key===key);if(!task)return;if(!confirm(`למחוק את המשימה „${task.text}”?`))return;if(task.todoId)state.todoItems=state.todoItems.filter(t=>t.id!==task.todoId);else if(task.manual)state.manualTasks=state.manualTasks.filter(t=>t.key!==key);else state.hiddenPlanTasks[key]=true;delete state.planOverrides[key];delete state.checkedTasks[key];await persist();close();render()}
function manualTaskForm(){modal('משימה ידנית חדשה',`<form id="manualTaskForm"><div class="form-grid"><div class="field full"><label>משימה</label><input name="text" required placeholder="למשל: הדפסת מדבקות"></div><div class="field"><label>תאריך</label><input name="date" type="date" required value="${plannerDay||dayKey(new Date())}"></div><div class="field"><label>שעה</label><input name="time" type="time" value="${state.settings.workStart||'08:00'}"></div><div class="field"><label>משך בדקות</label><input name="duration" type="number" min="5" step="5" value="30"></div><div class="field"><label>סוג</label><select name="type">${Object.entries(TASK_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div></div><div class="actions" style="margin-top:14px"><button class="btn">הוספה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('manualTaskForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),key=id('manual');state.manualTasks.push({key,text:f.get('text'),date:f.get('date'),time:f.get('time'),duration:Number(f.get('duration')||30),type:f.get('type'),recipe:'',customer:'',recipeRuns:0,qty:0,source:'',manual:true});await persist();close();render()}}

function renderRecipes(){
  const categories=['הכול',...new Set(state.recipes.map(r=>r.category||'אחר'))];
  document.getElementById('view-recipes').innerHTML=`<section class="recipes-showcase"><div class="recipe-page-head"><div><span class="eyebrow-dot"></span><div><h2>המתכונים שלך</h2><p>ספר עבודה חי — חיפוש מהיר, תפוקה, עלויות ומשימות להזמנה במקום אחד.</p></div></div><div class="actions"><button class="btn ghost" onclick="App.importRecipe()">✨ הדבקת מתכון</button><button class="btn secondary" onclick="App.newRecipe()">+ מתכון חדש</button></div></div><div class="recipe-live-tools"><div class="recipe-search"><span>⌕</span><input id="recipeLiveSearch" placeholder="חיפוש מתכון…" oninput="App.filterRecipeCards()"></div><div class="recipe-filter-pills">${categories.map((c,i)=>`<button class="${i===0?'active':''}" data-category="${esc(c)}" onclick="App.setRecipeCategory('${esc(c)}',this)">${esc(c)}</button>`).join('')}</div></div>${state.recipes.length?`<div class="recipe-book-grid animated-recipe-grid">${state.recipes.map((r,index)=>{const p=packageSummary(r),c=recipeCost(r),tasks=groupedWorkflowFromRecipe(r).length,unit=salesUnitLabel(r),yieldCount=recipeYieldUnits(r);return`<article class="recipe-card interactive-recipe-card" data-name="${esc(cleanIngredientName(r.name))}" data-category="${esc(r.category||'אחר')}" style="--card-index:${index}"><button class="recipe-card-main" onclick="App.editRecipe('${r.id}')"><div class="recipe-card-top"><div class="recipe-card-kicker">${r.subRecipes?.length?'מתכון מורכב':'מתכון רגיל'} · ${esc(r.category||'אחר')}</div><span class="recipe-orbit">✦</span></div><h3>${esc(r.name)}</h3><div class="recipe-visual-stats"><div><strong>${yieldCount||'—'}</strong><span>${yieldCount?esc(unit):'תפוקה לא הוגדרה'}</span></div><div><strong>${salesUnitLabel(r)==='שקיות'?fmt(p.packageWeight,0):'—'}</strong><span>${salesUnitLabel(r)==='שקיות'?'גרם לשקית':'תפוקה למתכון'}</span></div><div class="cost-stat clickable-cost" role="button" tabindex="0" title="פתיחת פירוט עלות" onclick="event.stopPropagation();App.recipeCostBreakdown('${r.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();App.recipeCostBreakdown('${r.id}')}"><strong>${c.perUnit!==null?money(c.perUnit):'לא חושב'}</strong><span>עלות ל${esc(salesUnitSingular(unit))}</span></div></div><div class="recipe-task-status ${tasks?'has-tasks':''}"><span>${tasks?'✓':'＋'}</span>${tasks?`${tasks} משימות להזמנה`:'עדיין אין משימות להזמנה'}</div></button><div class="recipe-card-actions"><button class="btn small ghost" onclick="App.editRecipe('${r.id}')">עריכה</button><button class="btn small secondary" onclick="App.weightCalc('${r.id}')">התאמת כמות</button><button class="btn small ghost" onclick="App.workflowEditor('${r.id}')">משימות</button>${(r.originalRecipeBase||Number(r.savedScaleFactor)>0)?`<button class="btn small ghost" onclick="App.resetRecipeOriginal('${r.id}')">למקור</button>`:''}<button class="btn small danger" onclick="App.deleteRecipe('${r.id}')">מחיקה</button></div></article>`}).join('')}</div>`:'<div class="empty">עדיין אין מתכונים.</div>'}</section>`;
}
function filterRecipeCards(){const q=cleanIngredientName(document.getElementById('recipeLiveSearch')?.value||''),active=document.querySelector('.recipe-filter-pills button.active')?.dataset.category||'הכול';document.querySelectorAll('.interactive-recipe-card').forEach(card=>{card.hidden=!!q&&!card.dataset.name.includes(q)||active!=='הכול'&&card.dataset.category!==active})}
function readIngredientRows(container){return[...container.querySelectorAll(':scope > .ingredient-row')].map(x=>{const unit=normalizedRecipeUnit(x.querySelector('.ri-u').value);return{name:x.querySelector('.ri-n').value.trim(),qty:roundRecipeQuantity(x.querySelector('.ri-q').value||0,unit),unit,category:x.querySelector('.ri-c').value,linkedSubRecipeId:x.querySelector('.ri-link')?.value||''}}).filter(x=>x.name&&x.qty)}
function readStepRows(container){if(!container)return[];return[...container.querySelectorAll(':scope > .step-row')].map(x=>({text:x.querySelector('.rs-t')?.value.trim()||'',daysBefore:Number(x.querySelector('.rs-d')?.value||0),time:x.querySelector('.rs-h')?.value||'',durationMin:Number(x.querySelector('.rs-m')?.value||0),passiveMin:Number(x.querySelector('.rs-p')?.value||0),ovenTemp:Number(x.querySelector('.rs-o')?.value||0),notes:x.querySelector('.rs-n')?.value||'',kind:x.querySelector('.rs-k')?.value||'הכנה'})).filter(x=>x.text)}
function readRecipeFormIngredients(){const c=document.getElementById('recipeIngredients');return c?readIngredientRows(c):[]}
function readSubRecipes(){return[...document.querySelectorAll('.subrecipe-card')].map(card=>({id:card.dataset.subId||id('sub'),name:card.querySelector('.sub-name').value.trim()||'תת־מתכון',usedQtyGrams:Math.max(0,Math.round(Number(card.querySelector('.sub-used').value||0))),evaporationPct:Number(card.querySelector('.sub-evap').value||0),prepMin:Number(card.querySelector('.sub-prep').value||0),restMin:Number(card.querySelector('.sub-rest').value||0),bakeMin:Number(card.querySelector('.sub-bake').value||0),ovenTemp:Number(card.querySelector('.sub-temp').value||0),notes:card.querySelector('.sub-notes').value,ingredients:readIngredientRows(card.querySelector('.sub-ingredients')),steps:readStepRows(card.querySelector('.sub-steps'))}))}
function updateRecipeWeightPreview(){
  const form=document.getElementById('recipeForm'),box=document.getElementById('recipeWeightPreview');if(!form||!box)return;
  const ingredients=readRecipeFormIngredients(),evaporationPct=Number(form.elements.evaporationPct?.value||0),packageWeight=Math.max(1,Math.round(Number(form.elements.packageWeight?.value||200))),w=calculateIngredientListWeight(ingredients,evaporationPct),p={fullBags:Math.floor(w.finalWeight/packageWeight),remainder:w.finalWeight%packageWeight},salesUnit=String(form.elements.salesUnit?.value||'שקיות');
  if(form.elements.packageWeight)form.elements.packageWeight.value=packageWeight;if(form.elements.unitWeight)form.elements.unitWeight.value=packageWeight;
  const yieldUnits=Math.max(0,Math.round(Number(form.elements.yieldUnits?.value||0))),yieldText=salesUnit==='שקיות'?(p.fullBags?`${p.fullBags} שקיות מלאות × ${fmt(packageWeight,0)} גרם · יתרה ${showQty(p.remainder,'גרם')}`:'עדיין אין מספיק נתונים לחישוב שקיות'):(yieldUnits?`${yieldUnits} ${esc(salesUnitLabel({salesUnit}))} למתכון`:'התפוקה עדיין לא הוגדרה');
  box.innerHTML=w.rawWeight?`<strong>משקל המתכון הראשי:</strong> לפני אפייה ${showQty(w.rawWeight,'גרם')} · אידוי משוער ${showQty(w.evaporationLoss,'גרם')} · משקל סופי ${showQty(w.finalWeight,'גרם')}<br><strong>תפוקה:</strong> ${yieldText}${w.estimatedCount?`<div class="hint">החישוב כולל ${w.estimatedCount} המרות ביתיות משוערות.</div>`:''}${w.excluded.length?`<div class="hint">לא נמצאה המרה עבור: ${w.excluded.map(esc).join(', ')}.</div>`:''}`:'הוסיפי רכיבים וכמויות כדי לחשב משקל ותפוקה.';
  document.querySelectorAll('.subrecipe-card').forEach(card=>{const sub={ingredients:readIngredientRows(card.querySelector('.sub-ingredients')),evaporationPct:Number(card.querySelector('.sub-evap').value||0)},sw=calculateSubRecipeWeight(sub),used=Number(card.querySelector('.sub-used').value||0),left=Math.max(0,sw.finalWeight-used);card.querySelector('.sub-weight-preview').innerHTML=sw.rawWeight?`תפוקת תת־המתכון: <strong>${showQty(sw.finalWeight,'גרם')}</strong>. נדרש במתכון הראשי: <strong>${showQty(used,'גרם')}</strong>${used?` · יתרה משוערת: <strong>${showQty(Math.max(0,left),'גרם')}</strong>`:''}${sw.excluded.length?`<div class="hint">לא חושבו: ${sw.excluded.map(esc).join(', ')}</div>`:''}`:'הוסיפי מצרכים לתת־המתכון.'});
  updateRecipeEditorSummary();
}
function recipeEditorVisibleSteps(){return[1,2,3,4]}
function showRecipeEditorStep(step){
  const form=document.getElementById('recipeForm');if(!form)return;
  const visible=recipeEditorVisibleSteps();step=Number(step||visible[0]);if(!visible.includes(step))step=visible[0];window.__recipeEditorStep=step;
  form.querySelectorAll('.recipe-editor-step').forEach(section=>section.classList.toggle('active',Number(section.dataset.recipeStep)===step));
  form.querySelectorAll('.recipe-editor-nav button').forEach(button=>{const n=Number(button.dataset.recipeStep);button.hidden=!visible.includes(n);button.classList.toggle('active',n===step)});
  const index=visible.indexOf(step),prev=form.querySelector('#recipeEditorPrev'),next=form.querySelector('#recipeEditorNext'),progress=form.querySelector('#recipeEditorProgress');
  if(prev)prev.hidden=index<=0;
  if(next){next.hidden=index===visible.length-1;next.textContent=index===visible.length-2?'לתפוקה':'הבא'}
  if(progress)progress.style.width=`${((index+1)/visible.length)*100}%`;
  form.querySelector('.recipe-editor-step.active')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function setRecipeEditMode(mode,button){
  window.__recipeEditorMode=mode==='full'?'full':'quick';
  const form=document.getElementById('recipeForm');if(!form)return;
  form.dataset.editorMode=window.__recipeEditorMode;
  form.querySelectorAll('.recipe-mode-switch button').forEach(b=>b.classList.toggle('active',b===button||b.dataset.mode===window.__recipeEditorMode));
  if(window.__recipeEditorMode==='quick'&&window.__recipeEditorStep===3)window.__recipeEditorStep=4;
  showRecipeEditorStep(window.__recipeEditorStep||1);
}
function moveRecipeEditor(direction){
  const form=document.getElementById('recipeForm');if(!form)return;const visible=recipeEditorVisibleSteps(),current=window.__recipeEditorStep||visible[0],index=visible.indexOf(current),nextIndex=Math.max(0,Math.min(visible.length-1,index+Number(direction||0)));
  if(direction>0){const section=form.querySelector(`.recipe-editor-step[data-recipe-step="${current}"]`),invalid=section?.querySelector(':invalid');if(invalid){invalid.reportValidity();invalid.focus();return}}
  showRecipeEditorStep(visible[nextIndex]);
}
function updateRecipeEditorSummary(){
  const form=document.getElementById('recipeForm'),box=document.getElementById('recipeEditorLiveSummary');if(!form||!box)return;
  const ingredients=readRecipeFormIngredients(),subs=document.querySelectorAll('.subrecipe-card').length,steps=readStepRows(document.getElementById('recipeSteps')).length+readStepRows(document.getElementById('recipeBakingSteps')).length,weight=calculateIngredientListWeight(ingredients,Number(form.elements.evaporationPct?.value||0)).finalWeight,packageWeight=Math.max(1,Number(form.elements.packageWeight?.value||200)),bags=Math.floor(weight/packageWeight);
  box.innerHTML=`<span><strong>${ingredients.length}</strong> רכיבים</span><span><strong>${subs}</strong> תתי־מתכונים</span><span><strong>${steps}</strong> שלבים</span><span><strong>${bags}</strong> שקיות</span><span><strong>${showQty(weight,'גרם')}</strong> סופי</span>`;
}


function setRecipeCategory(category,button){document.querySelectorAll('.recipe-filter-pills button').forEach(b=>b.classList.toggle('active',b===button));filterRecipeCards()}

function ingredientRow(i={},isSub=false){
  const unit=normalizedRecipeUnit(i.unit||'גרם'),qty=roundRecipeQuantity(i.qty||0,unit),step=unit==='גרם'?'1':'0.01';
  return `<div class="ingredient-row"><div class="field"><label>רכיב</label><input class="ri-n" value="${esc(i.name||'')}" placeholder="שם הרכיב"></div><div class="field"><label>כמות</label><input class="ri-q" type="number" min="0" step="${step}" value="${qty}" onblur="App.roundIngredientInput(this)"></div><div class="field"><label>יחידה</label><select class="ri-u" onchange="App.syncIngredientUnit(this)">${['גרם','ק"ג','מ"ל','ליטר','כפית','כף','כוס','יחידה'].map(u=>`<option value="${u}" ${unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>קטגוריה</label><select class="ri-c">${['יבשים','רטובים','שומנים','תוספות','אחר'].map(c=>`<option value="${c}" ${(i.category||'אחר')===c?'selected':''}>${c}</option>`).join('')}</select></div><input class="ri-link" type="hidden" value="${esc(i.linkedSubRecipeId||'')}"><button type="button" class="btn small danger" onclick="this.closest('.ingredient-row').remove();App.updateRecipeWeightPreview()">הסרה</button></div>`;
}
function stepRow(s={},isSub=false){
  return `<div class="step-row">
    <div class="field"><label>שלב</label><input class="rs-t" value="${esc(s.text||'')}" placeholder="מה עושים?"></div>
    <div class="field"><label>ימים לפני מסירה</label><input class="rs-d" type="number" min="0" step="1" value="${Number(s.daysBefore||0)}"></div>
    <div class="field"><label>שעה מועדפת</label><input class="rs-h" type="time" value="${esc(s.time||'')}"></div>
    <div class="field"><label>משך בדקות</label><input class="rs-m" type="number" min="0" step="5" value="${Number(s.durationMin||0)}"></div>
    <input class="rs-p" type="hidden" value="${Number(s.passiveMin||0)}"><input class="rs-o" type="hidden" value="${Number(s.ovenTemp||0)}"><input class="rs-n" type="hidden" value="${esc(s.notes||'')}"><input class="rs-k" type="hidden" value="${esc(s.kind|| (isSub?'הכנה':'הכנה'))}">
    <button type="button" class="btn small danger" onclick="this.closest('.step-row').remove();App.refreshRecipeEditorSteps()">הסרה</button>
  </div>`;
}
function recipeOrderTaskRow(t={}){
  return `<div class="recipe-order-task-row step-row">
    <div class="field"><label>משימה</label><input class="rot-title" value="${esc(t.title||t.text||'')}" placeholder="למשל: להכין בצק"></div>
    <div class="field"><label>ימים לפני המסירה</label><input class="rot-days" type="number" min="0" step="1" value="${Number(t.daysBefore||0)}"></div>
    <div class="field"><label>משך פעיל בדקות</label><input class="rot-min" type="number" min="0" step="5" value="${Number(t.activeMin||t.durationMin||20)}"></div>
    <div class="field"><label>שעה מועדפת</label><input class="rot-time" type="time" value="${esc(t.preferredTime||t.time||'')}"></div>
    <div class="field"><label>הערות</label><input class="rot-notes" value="${esc(t.notes||'')}"></div>
    <button type="button" class="btn small danger" onclick="this.closest('.recipe-order-task-row').remove()">הסרה</button>
  </div>`;
}
function readRecipeOrderTasks(){
  const box=document.getElementById('recipeOrderTasks');
  if(!box)return[];
  return [...box.querySelectorAll('.recipe-order-task-row')].map(row=>({
    title:row.querySelector('.rot-title')?.value.trim()||'',
    daysBefore:Math.max(0,Math.round(Number(row.querySelector('.rot-days')?.value||0))),
    activeMin:Math.max(0,Math.round(Number(row.querySelector('.rot-min')?.value||0))),
    preferredTime:row.querySelector('.rot-time')?.value||'',
    notes:row.querySelector('.rot-notes')?.value.trim()||''
  })).filter(t=>t.title);
}
function subRecipeCard(sub={}){
  const sid=sub.id||id('sub');
  const ingredients=(sub.ingredients?.length?sub.ingredients:[{name:'',qty:'',unit:'גרם',category:'אחר'}]).map(i=>ingredientRow(i,true)).join('');
  const steps=(sub.steps?.length?sub.steps:[{text:'',daysBefore:0,time:'',durationMin:0}]).map(s=>stepRow(s,true)).join('');
  return `<div class="subrecipe-card" data-sub-id="${esc(sid)}">
    <div class="section-head"><h3>תת־מתכון</h3><button type="button" class="btn small danger" onclick="this.closest('.subrecipe-card').remove();App.updateRecipeWeightPreview()">הסרת תת־מתכון</button></div>
    <div class="form-grid three">
      <div class="field"><label>שם</label><input class="sub-name" value="${esc(sub.name||'')}"></div>
      <div class="field"><label>כמות שנכנסת למתכון הראשי — גרם</label><input class="sub-used" type="number" min="0" step="1" value="${Math.round(Number(sub.usedQtyGrams||0))}"></div>
      <div class="field"><label>אחוז אידוי</label><input class="sub-evap" type="number" min="0" max="100" step="0.1" value="${Number(sub.evaporationPct||0)}"></div>
      <div class="field"><label>זמן הכנה פעיל</label><input class="sub-prep" type="number" min="0" value="${Number(sub.prepMin||0)}"></div>
      <div class="field"><label>מנוחה</label><input class="sub-rest" type="number" min="0" value="${Number(sub.restMin||0)}"></div>
      <div class="field"><label>אפייה</label><input class="sub-bake" type="number" min="0" value="${Number(sub.bakeMin||0)}"></div>
      <div class="field"><label>טמפרטורה</label><input class="sub-temp" type="number" value="${Number(sub.ovenTemp||0)}"></div>
      <div class="field full"><label>הערות</label><textarea class="sub-notes">${esc(sub.notes||'')}</textarea></div>
    </div>
    <div class="recipe-subsection"><div class="section-head"><h4>רכיבים</h4><button type="button" class="btn small secondary" onclick="App.addSubIngredient(this)">+ רכיב</button></div><div class="sub-ingredients">${ingredients}</div></div>
    <div class="recipe-subsection"><div class="section-head"><h4>שלבים</h4><button type="button" class="btn small secondary" onclick="App.addSubStep(this)">+ שלב</button></div><div class="sub-steps">${steps}</div></div>
    <div class="sub-weight-preview notice"></div>
  </div>`;
}

function recipeEditorStepRefs(){
  const refs=[];
  document.querySelectorAll('#subRecipes .subrecipe-card').forEach((card,si)=>card.querySelectorAll('.sub-steps > .step-row').forEach((row,i)=>refs.push({row,scope:'sub',subIndex:si,index:i,label:card.querySelector('.sub-name')?.value||'תת־מתכון'})));
  document.querySelectorAll('#recipeSteps > .step-row').forEach((row,i)=>refs.push({row,scope:'main',subIndex:-1,index:i,label:'מתכון ראשי'}));
  document.querySelectorAll('#recipeBakingSteps > .step-row').forEach((row,i)=>refs.push({row,scope:'baking',subIndex:-1,index:i,label:'אפייה'}));
  return refs.filter(x=>x.row.querySelector('.rs-t')?.value.trim());
}
function refreshRecipeEditorSteps(){
  const box=document.getElementById('recipeEditorStepsPreview');if(!box)return;const refs=recipeEditorStepRefs();
  box.innerHTML=refs.length?`<ol class="steps-list interactive">${refs.map((ref,n)=>`<li><button type="button" class="recipe-step-button" onclick="App.editRecipeEditorStep('${ref.scope}',${ref.index},${ref.subIndex})"><span class="step-number">${n+1}</span><span class="step-copy"><strong>${esc(ref.row.querySelector('.rs-t')?.value||'')}</strong><small>${esc(ref.label)}</small></span><span class="step-edit">עריכה</span></button></li>`).join('')}</ol>`:'<div class="empty compact">עדיין אין שלבי הכנה. הוסיפי שלב ראשון.</div>';
}
function editRecipeEditorStep(scope,index,subIndex=-1){
  let row;if(scope==='sub')row=document.querySelectorAll('#subRecipes .subrecipe-card')[subIndex]?.querySelectorAll('.sub-steps > .step-row')[index];else row=document.querySelectorAll(scope==='baking'?'#recipeBakingSteps > .step-row':'#recipeSteps > .step-row')[index];if(!row)return;
  document.getElementById('recipeStepInlineEditor')?.remove();
  const val=sel=>row.querySelector(sel)?.value||'',kind=val('.rs-k')||(scope==='baking'?'אפייה':'הכנה'),overlay=document.createElement('div');overlay.id='recipeStepInlineEditor';overlay.className='step-editor-overlay';
  overlay.innerHTML=`<div class="step-editor-panel"><div class="modal-head"><h3>עריכת שלב</h3><button type="button" class="icon-btn step-editor-close">✕</button></div><form id="recipeEditorSingleStep"><div class="field full"><label>מה עושים?</label><textarea name="text" required>${esc(val('.rs-t'))}</textarea></div><div class="form-grid three" style="margin-top:12px"><div class="field"><label>סוג השלב</label><select name="kind">${['הכנה','אפייה','קירור','מנוחה','התפחה','הרכבה'].map(k=>`<option ${kind===k?'selected':''}>${k}</option>`).join('')}</select></div><div class="field"><label>זמן פעיל בדקות</label><input name="durationMin" type="number" min="0" step="5" value="${Number(val('.rs-m')||0)}"></div><div class="field"><label>זמן פסיבי בדקות</label><input name="passiveMin" type="number" min="0" step="5" value="${Number(val('.rs-p')||0)}"></div><div class="field"><label>כמה ימים לפני</label><input name="daysBefore" type="number" min="0" step="1" value="${Number(val('.rs-d')||0)}"></div><div class="field"><label>שעה מועדפת</label><input name="time" type="time" value="${esc(val('.rs-h'))}"></div><div class="field"><label>טמפרטורה</label><input name="ovenTemp" type="number" value="${Number(val('.rs-o')||0)||''}" placeholder="לא חובה"></div><div class="field full"><label>הערות פנימיות</label><textarea name="notes">${esc(val('.rs-n'))}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירת שלב</button><button type="button" class="btn danger" id="deleteEditorStep">מחיקת שלב</button><button type="button" class="btn ghost step-editor-close">ביטול</button></div></form></div>`;
  document.querySelector('.modal-card')?.appendChild(overlay);
  overlay.querySelectorAll('.step-editor-close').forEach(b=>b.onclick=()=>overlay.remove());
  const form=overlay.querySelector('#recipeEditorSingleStep');form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),set=(sel,v)=>{const el=row.querySelector(sel);if(el)el.value=v};set('.rs-t',String(f.get('text')||'').trim());set('.rs-k',f.get('kind'));set('.rs-m',f.get('durationMin'));set('.rs-p',f.get('passiveMin'));set('.rs-d',f.get('daysBefore'));set('.rs-h',f.get('time'));set('.rs-o',f.get('ovenTemp'));set('.rs-n',f.get('notes'));overlay.remove();refreshRecipeEditorSteps();updateRecipeWeightPreview()};overlay.querySelector('#deleteEditorStep').onclick=()=>{row.remove();overlay.remove();refreshRecipeEditorSteps()};
}
function recipeForm(raw={}){
  const r=migrateRecipe({id:'',name:'',category:'אחר',categoryManual:false,salesUnit:'שקיות',yieldUnits:0,packageWeight:200,unitWeight:200,prepMin:30,restMin:60,bakeMin:12,ovenTemp:175,traysPerBatch:1,unitsPerTray:12,shelfLifeDays:4,wastePct:5,evaporationPct:12,salePrice:12,allergens:'',notes:'',ingredients:[],steps:[],bakingSteps:[],subRecipes:[],warnings:[],...raw});
  modal(r.id?'עריכת מתכון':'מתכון חדש',`<form id="recipeForm" class="recipe-editor" data-editor-mode="quick" novalidate><input type="hidden" name="id" value="${esc(r.id)}">
  <div class="recipe-editor-top"><div><div class="recipe-card-kicker">עריכה פשוטה ומסודרת</div><div class="recipe-mode-switch"><button type="button" class="active" data-mode="quick" onclick="App.setRecipeEditMode('quick',this)">עריכה מהירה</button><button type="button" data-mode="full" onclick="App.setRecipeEditMode('full',this)">עריכה מלאה</button></div></div><div id="recipeEditorLiveSummary" class="recipe-live-summary"></div></div>
  <div class="recipe-editor-progress"><span id="recipeEditorProgress"></span></div>
  <nav class="recipe-editor-nav" aria-label="שלבי עריכת מתכון"><button type="button" class="active" data-recipe-step="1" onclick="App.showRecipeEditorStep(1)"><span>1</span>פרטים</button><button type="button" data-recipe-step="2" onclick="App.showRecipeEditorStep(2)"><span>2</span>רכיבים</button><button type="button" data-recipe-step="3" onclick="App.showRecipeEditorStep(3)"><span>3</span>הכנה ואפייה</button><button type="button" data-recipe-step="4" onclick="App.showRecipeEditorStep(4)"><span>4</span>תפוקה</button></nav>
  <section class="recipe-editor-step active" data-recipe-step="1"><div class="recipe-step-heading"><span>שלב 1</span><div><h3>פרטים בסיסיים</h3><p>המידע שאת צריכה לזהות את המתכון ולמכור אותו.</p></div></div><div class="form-grid"><div class="field"><label>שם המתכון</label><input name="name" required value="${esc(r.name)}" placeholder="לדוגמה: טופי בייטס" oninput="App.autoSuggestRecipeCategory()"></div><div class="field"><label>סיווג</label><select name="category" data-manual="${r.categoryManual?'true':'false'}" onchange="App.markRecipeCategoryManual(this)">${recipeCategoryOptions(r.category).map(c=>`<option value="${esc(c)}" ${r.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select><div class="hint">המערכת מסווגת אוטומטית לפי שם ותוכן המתכון. בחירה ידנית נשמרת ולא תוחלף.</div></div><div class="field"><label>מחיר מכירה לשקית</label><input name="salePrice" type="number" step=".01" min="0" value="${r.salePrice||0}"></div><div class="field"><label>אלרגנים</label><input name="allergens" value="${esc(r.allergens)}" placeholder="גלוטן, שקדים..."></div>${r.warnings?.length?`<div class="field full"><div class="notice warning"><strong>נקודות לבדיקה מהייבוא:</strong><ul class="warning-list">${r.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div></div>`:''}</div></section>
  <section class="recipe-editor-step" data-recipe-step="2"><div class="recipe-step-heading"><span>שלב 2</span><div><h3>רכיבים</h3><p>רכיבי המתכון הראשי ותתי־מתכונים. אפשר להוסיף, למחוק ולשנות סדר בהמשך.</p></div></div><div class="field full"><div id="recipeIngredients">${(r.ingredients.length?r.ingredients:[{name:'',qty:'',unit:'גרם',category:'יבשים'}]).map(i=>ingredientRow(i,false)).join('')}</div><button type="button" class="btn small secondary" onclick="App.addIngredient()">+ הוספת רכיב</button></div><div class="field full"><div id="recipeWeightPreview" class="notice"></div></div><div class="recipe-subsection"><div class="section-head"><div><h3>תתי־מתכונים</h3><div class="hint">קרם, טופי, בצק או מילוי שמכינים בנפרד.</div></div><button type="button" class="btn small secondary" onclick="App.addSubRecipe()">+ תת־מתכון</button></div><div id="subRecipes">${(r.subRecipes||[]).map(subRecipeCard).join('')}</div>${!(r.subRecipes||[]).length?'<div class="empty compact">אין תתי־מתכונים. אפשר להמשיך לשלב הבא.</div>':''}</div></section>
  <section class="recipe-editor-step" data-recipe-step="3"><div class="recipe-step-heading"><span>שלב 3</span><div><h3>אופן ההכנה</h3><p>כל שלבי העבודה מופיעים יחד וברצף. לחצי על שלב רק כשצריך לערוך אותו.</p></div></div><div id="recipeEditorStepsPreview" class="recipe-editor-steps-preview"></div><div class="actions" style="margin-top:12px"><button type="button" class="btn small secondary" onclick="App.addStep();App.refreshRecipeEditorSteps()">+ שלב הכנה</button><button type="button" class="btn small ghost" onclick="App.addBakingStep();App.refreshRecipeEditorSteps()">+ שלב אפייה</button></div><div class="recipe-step-storage" hidden><div id="recipeSteps">${(r.steps.length?r.steps:[]).map(s=>stepRow(s,false)).join('')}</div><div id="recipeBakingSteps">${(r.bakingSteps.length?r.bakingSteps:[]).map(s=>stepRow({...s,kind:s.kind||'אפייה'},false)).join('')}</div></div><details class="recipe-backend" style="margin-top:16px"><summary>משימות להזמנה</summary><div class="recipe-order-tasks-section"><div class="section-head"><div><div class="hint">רק משימות שצריכות להיכנס אוטומטית לתכנון כשיש הזמנה.</div></div><button type="button" class="btn small secondary" onclick="App.addRecipeOrderTask()">+ משימה</button></div><div id="recipeOrderTasks">${(r.productionTasks||[]).map(recipeOrderTaskRow).join('')}</div>${!(r.productionTasks||[]).length?'<div class="empty compact recipe-task-empty">לא הוגדרו משימות להזמנה.</div>':''}</div></details><details class="recipe-backend"><summary>הגדרות טכניות</summary><div class="field full"><label>הערות</label><textarea name="notes" placeholder="טיפים, סימני מוכנות או דברים שחשוב לזכור">${esc(r.notes)}</textarea></div><div class="form-grid three recipe-timing-grid"><div class="field"><label>זמן הכנה פעיל</label><input name="prepMin" type="number" min="0" value="${r.prepMin||0}"></div><div class="field"><label>מנוחה/קירור</label><input name="restMin" type="number" min="0" value="${r.restMin||0}"></div><div class="field"><label>זמן אפייה</label><input name="bakeMin" type="number" min="0" value="${r.bakeMin||0}"></div><div class="field"><label>טמפרטורה</label><input name="ovenTemp" type="number" value="${r.ovenTemp||0}"></div></div></details></section>
  <section class="recipe-editor-step" data-recipe-step="4"><div class="recipe-step-heading"><span>שלב 4</span><div><h3>תפוקה והתאמת כמויות</h3><p>בחרי איך המוצר נמכר. בשקיות התפוקה מחושבת מהמשקל; בעוגות, יחידות, מגשים או מארזים אפשר להזין תפוקה ידנית.</p></div></div><div class="form-grid three recipe-yield-grid"><div class="field"><label>יחידת מכירה</label><select name="salesUnit" onchange="App.updateRecipeWeightPreview()">${SALES_UNITS.map(x=>`<option ${salesUnitLabel(r)===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>משקל יעד לשקית — גרם</label><input name="packageWeight" type="number" min="1" step="1" value="${Math.round(r.packageWeight)}"></div><div class="field"><label>כמה יחידות יוצאות מהמתכון?</label><input name="yieldUnits" type="number" min="0" step="1" value="${r.yieldUnits?Math.round(r.yieldUnits):''}" placeholder="לא הוגדר"><div class="hint">לא חובה. אפשר לשמור עכשיו ולהשלים אחרי אפייה אמיתית. בשקיות יוצג גם חישוב משוער לפי המשקל.</div></div><div class="field"><label>משקל שקית — מחושב</label><input name="unitWeight" type="number" readonly value="${Math.round(r.packageWeight)}"></div></div><details class="recipe-advanced"><summary>הגדרות מתקדמות</summary><div class="form-grid three"><div class="field"><label>אחוז אידוי מהמים באפייה</label><input name="evaporationPct" type="number" min="0" max="100" step=".1" value="${r.evaporationPct}"><div class="hint">חל רק על מים שזוהו ברכיבים.</div></div><div class="field"><label>אחוז פחת</label><input name="wastePct" type="number" min="0" value="${r.wastePct||0}"></div><div class="field"><label>חיי מדף בימים</label><input name="shelfLifeDays" type="number" min="0" value="${r.shelfLifeDays||0}"></div><div class="field"><label>מגשים במחזור אפייה</label><input name="traysPerBatch" type="number" min="1" value="${r.traysPerBatch||1}"></div><div class="field"><label>יחידות במגש</label><input name="unitsPerTray" type="number" min="1" value="${r.unitsPerTray||1}"></div></div></details></section>
  <div class="recipe-editor-footer"><button type="button" id="recipeEditorPrev" class="btn ghost" onclick="App.moveRecipeEditor(-1)">חזרה</button><div class="recipe-editor-footer-main"><button type="button" class="btn ghost" onclick="App.close()">ביטול</button><button type="submit" class="btn">שמירת מתכון</button><button type="button" id="recipeEditorNext" class="btn secondary" onclick="App.moveRecipeEditor(1)">הבא</button></div></div></form>`);
  window.__recipeEditorMode='quick';window.__recipeEditorStep=1;
  const form=document.getElementById('recipeForm');form.addEventListener('input',updateRecipeWeightPreview);form.addEventListener('change',updateRecipeWeightPreview);updateRecipeWeightPreview();refreshRecipeEditorSteps();showRecipeEditorStep(1);
  form.onsubmit=async e=>{e.preventDefault();if(!form.checkValidity()){const invalid=form.querySelector(':invalid'),section=invalid?.closest('.recipe-editor-step');if(section)showRecipeEditorStep(Number(section.dataset.recipeStep));invalid?.reportValidity();invalid?.focus();return}const f=new FormData(form),ex=state.recipes.find(x=>x.id===f.get('id')),ingredients=readRecipeFormIngredients(),steps=readStepRows(document.getElementById('recipeSteps')),bakingSteps=readStepRows(document.getElementById('recipeBakingSteps')),subRecipes=readSubRecipes(),productionTasks=readRecipeOrderTasks(),packageWeight=Math.max(1,Math.round(Number(f.get('packageWeight')||200))),salesUnit=SALES_UNITS.includes(String(f.get('salesUnit')))?String(f.get('salesUnit')):'שקיות';subRecipes.forEach(sub=>{const mainIngredient=ingredients.find(i=>i.linkedSubRecipeId===sub.id||ingredientNamesMatch(i.name,sub.name));if(mainIngredient){mainIngredient.linkedSubRecipeId=sub.id;sub.usedQtyGrams=ingredientWeightData(mainIngredient).grams||sub.usedQtyGrams}else if(sub.usedQtyGrams>0){ingredients.push({name:sub.name,qty:sub.usedQtyGrams,unit:'גרם',category:'תוספות',linkedSubRecipeId:sub.id})}});const weight=calculateIngredientListWeight(ingredients,Number(f.get('evaporationPct')||0)),fullBags=Math.floor(weight.finalWeight/packageWeight),yieldUnits=Math.max(0,Math.round(Number(f.get('yieldUnits')||0)));const categorySelect=form.elements.category,categoryManual=categorySelect?.dataset.manual==='true',category=categoryManual?String(f.get('category')||'אחר'):recipeCategoryFromText(`${f.get('name')||''} ${ingredients.map(i=>i.name).join(' ')}`);const obj=migrateRecipe({id:f.get('id')||id('rec'),name:f.get('name'),category:category==='אחר'&&f.get('category')?f.get('category'):category,categoryManual,salesUnit,packageWeight,yieldUnits,unitWeight:packageWeight,evaporationPct:Number(f.get('evaporationPct')||0),prepMin:Number(f.get('prepMin')||0),restMin:Number(f.get('restMin')||0),bakeMin:Number(f.get('bakeMin')||0),ovenTemp:Number(f.get('ovenTemp')||0),traysPerBatch:Number(f.get('traysPerBatch')||1),unitsPerTray:Number(f.get('unitsPerTray')||1),shelfLifeDays:Number(f.get('shelfLifeDays')||0),wastePct:Number(f.get('wastePct')||0),salePrice:Number(f.get('salePrice')||0),allergens:f.get('allergens'),notes:f.get('notes'),ingredients,steps,bakingSteps,subRecipes,productionTasks,warnings:[]});if(ex)Object.assign(ex,obj);else state.recipes.push(obj);await persist();close();render()};
}
function normalizedRecipeUnit(unit=''){const clean=String(unit||'').trim().replace(/״/g,'"');if(clean==='קג'||clean==='קילו')return'ק"ג';if(clean==='מל')return'מ"ל';return UNITS.includes(clean)?clean:'גרם'}
function roundRecipeQuantity(value,unit=''){
  const n=Number(value||0);
  if(!Number.isFinite(n))return 0;
  const u=normalizedRecipeUnit(unit);
  if(['גרם','יחידה','חבילה','קורט'].includes(u))return Math.round(n);
  if(['כפית','כף','כוס'].includes(u))return Math.round((n+Number.EPSILON)*4)/4;
  return Math.round((n+Number.EPSILON)*100)/100;
}
function normalizeRecipeIngredient(i={}){const unit=normalizedRecipeUnit(i.unit);return{...i,name:String(i.name||'').trim(),qty:Math.max(0,roundRecipeQuantity(i.qty,unit)),unit,category:CATS.includes(i.category)?i.category:ingredientCategory(i.name)}}
function roundIngredientInput(input){if(!input)return;const row=input.closest('.ingredient-row'),unit=normalizedRecipeUnit(row?.querySelector('.ri-u')?.value);if(input.value!=='')input.value=roundRecipeQuantity(input.value,unit);input.setCustomValidity('');updateRecipeWeightPreview()}
function syncIngredientUnit(select){if(!select)return;const input=select.closest('.ingredient-row')?.querySelector('.ri-q'),unit=normalizedRecipeUnit(select.value);if(input){input.step=unit==='גרם'?'1':'0.01';if(input.value!=='')input.value=roundRecipeQuantity(input.value,unit)}updateRecipeWeightPreview()}
function scaledNumber(value,factor,unit=''){return roundRecipeQuantity(Number(value||0)*factor,unit)}
function cloneRecipeBase(r){
  return{
    ingredients:JSON.parse(JSON.stringify(r.ingredients||[])),
    subRecipes:JSON.parse(JSON.stringify(r.subRecipes||[])),
    packageWeight:Number(r.packageWeight||r.unitWeight||200),
    unitWeight:Number(r.unitWeight||r.packageWeight||200),
    yieldUnits:Number(r.yieldUnits||1),
    capturedAt:new Date().toISOString()
  }
}
async function resetRecipeToOriginal(recipeId){
  const r=recipe(recipeId);if(!r)return;
  if(!r.originalRecipeBase&&Number(r.savedScaleFactor)>0){const reverse=1/Number(r.savedScaleFactor);r.originalRecipeBase={ingredients:(r.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,reverse,i.unit)})),subRecipes:(r.subRecipes||[]).map(s=>({...s,usedQtyGrams:Math.round(Number(s.usedQtyGrams||0)*reverse),ingredients:(s.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,reverse,i.unit)}))})),packageWeight:Number(r.packageWeight||200),unitWeight:Number(r.unitWeight||r.packageWeight||200),yieldUnits:Math.max(1,Math.round(Number(r.yieldUnits||1)*reverse)),capturedAt:new Date().toISOString(),reconstructed:true};}
  if(!r.originalRecipeBase)return alert('לא נשמרו כמויות מקוריות למתכון הזה.');
  if(!confirm('להחזיר את המתכון לכמויות המקוריות? הכמויות המותאמות הנוכחיות יוחלפו.'))return;
  const base=r.originalRecipeBase;
  r.ingredients=JSON.parse(JSON.stringify(base.ingredients||[]));
  r.subRecipes=JSON.parse(JSON.stringify(base.subRecipes||[]));
  r.packageWeight=Math.max(1,Number(base.packageWeight||200));
  r.unitWeight=Math.max(1,Number(base.unitWeight||base.packageWeight||200));
  r.yieldUnits=Math.max(1,Number(base.yieldUnits||1));
  delete r.savedScaleAt;delete r.savedScaleFactor;
  await persist();close();render();setStatus('✓ המתכון הוחזר לכמויות המקוריות');setTimeout(()=>setStatus(''),1800)
}
async function saveScaledRecipe(recipeId){
  const r=recipe(recipeId),plan=window.__scalePlan;if(!r||!plan||!Number.isFinite(plan.factor)||plan.factor<=0)return alert('לא נמצאה התאמה לשמירה.');
  if(!confirm(`לשמור את ${plan.bags} השקיות כמתכון הנוכחי? הכמויות הקיימות יוחלפו בכמויות המותאמות.`))return;
  if(!r.originalRecipeBase)r.originalRecipeBase=cloneRecipeBase(r);
  r.ingredients=(r.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,plan.factor,i.unit)}));
  r.subRecipes=(r.subRecipes||[]).map(s=>({...s,usedQtyGrams:Math.round(Number(s.usedQtyGrams||0)*plan.factor),ingredients:(s.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,plan.factor,i.unit)}))}));
  r.packageWeight=plan.pkg;r.unitWeight=plan.pkg;r.yieldUnits=Math.max(1,plan.bags);r.savedScaleAt=new Date().toISOString();r.savedScaleFactor=plan.factor;
  await persist();close();render();setStatus('✓ כמות השקיות נשמרה במתכון');setTimeout(()=>setStatus(''),1800)
}
function weightCalculator(r){
  if(!r)return;const base=calculateRecipeWeight(r);if(!base.finalWeight)return alert('לא ניתן לחשב משקל סופי לפני הזנת מצרכים ניתנים להמרה.');const p=packageSummary(r);
  modal(`התאמת ${r.name}`,`<div class="inner-tabs"><button class="active" onclick="App.scaleMode('weight',this)">לפי משקל סופי</button><button onclick="App.scaleMode('bags',this)">לפי מספר שקיות</button></div><div class="form-grid"><div class="field" id="scaleWeightField"><label>משקל סופי רצוי בק״ג</label><input id="targetWeightValue" type="number" min=".01" step=".01" value="${Math.round(base.finalWeight/10)/100}"></div><div class="field" id="scaleBagsField" hidden><label>מספר שקיות רצוי</label><input id="targetBagsValue" type="number" min="1" step="1" value="${Math.max(1,p.fullBags)}"></div><div class="field"><label>משקל לשקית</label><input id="targetPackageWeight" type="number" min="1" value="${p.packageWeight}"></div></div><div id="weightScaleSummary" class="notice" style="margin-top:12px"></div><div id="weightScaleResults" style="margin-top:12px"></div><div class="notice success" style="margin-top:12px">לחיצה על <strong>שמירת הכמות במתכון</strong> תהפוך את הכמויות המותאמות לבסיס הקבוע החדש. בפעם הראשונה נשמר גם עותק של הכמויות המקוריות.</div><div class="actions" style="margin-top:14px"><button class="btn" id="saveScaledRecipe" type="button">שמירת הכמות במתכון</button><button class="btn secondary" id="copyWeightPlan" type="button">העתקת רשימת מצרכים</button>${(r.originalRecipeBase||Number(r.savedScaleFactor)>0)?`<button class="btn ghost" type="button" onclick="App.resetRecipeOriginal('${r.id}')">החזרה לכמויות המקוריות</button>`:''}<button class="btn ghost" type="button" onclick="App.close()">סגירה</button></div>`);
  window.__scaleMode='weight';
  const update=()=>{const mode=window.__scaleMode||'weight',pkg=Math.max(1,Number(document.getElementById('targetPackageWeight').value||r.packageWeight||200)),targetGrams=mode==='bags'?Math.max(1,Number(document.getElementById('targetBagsValue').value||1))*pkg:Math.max(0,Number(document.getElementById('targetWeightValue').value||0))*1000,factor=targetGrams/base.finalWeight,rows=expandedIngredients(r).map(i=>({...i,scaledQty:roundRecipeQuantity(Number(i.qty||0)*factor,i.unit)})),bags=Math.floor(targetGrams/pkg),rem=targetGrams-bags*pkg;window.__scalePlan={factor,targetGrams,pkg,bags,rem};document.getElementById('weightScaleSummary').innerHTML=`המתכון הנוכחי נותן <strong>${showQty(base.finalWeight,'גרם')}</strong>. יעד: <strong>${showQty(targetGrams,'גרם')}</strong> · מקדם <strong>${fmt(factor,3)}</strong> · ${bags} שקיות מלאות · יתרה ${showQty(rem,'גרם')}.`;document.getElementById('weightScaleResults').innerHTML=`<div class="table-wrap"><table><thead><tr><th>רכיב</th><th>כמות חדשה</th><th>מקור</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.name)}</td><td><strong>${fmtQty(i.scaledQty,i.unit,2)} ${esc(normalizedRecipeUnit(i.unit))}</strong></td><td>${esc(i.sourceSubRecipe||'מתכון ראשי')}</td></tr>`).join('')}</tbody></table></div>`;window.__scaleCopy=`${r.name}\nמשקל סופי רצוי: ${showQty(targetGrams,'גרם')}\n${bags} שקיות × ${pkg} גרם\nמקדם: ${fmt(factor,3)}\n\n`+rows.map(i=>`${i.name}: ${fmtQty(i.scaledQty,i.unit,2)} ${normalizedRecipeUnit(i.unit)}${i.sourceSubRecipe?' ('+i.sourceSubRecipe+')':''}`).join('\n')};
  ['targetWeightValue','targetBagsValue','targetPackageWeight'].forEach(x=>document.getElementById(x).addEventListener('input',update));document.getElementById('copyWeightPlan').onclick=async()=>{try{await navigator.clipboard.writeText(window.__scaleCopy);document.getElementById('copyWeightPlan').textContent='✓ הועתק'}catch(e){alert(window.__scaleCopy)}};document.getElementById('saveScaledRecipe').onclick=()=>saveScaledRecipe(r.id);window.__updateScale=update;update()
}

function importRecipeModal(){modal('הדבקת מתכון חכמה',`<div class="field"><label>הדביקי את המתכון המלא</label><textarea id="recipeImportText" class="recipe-import-text" placeholder="שם המתכון\n\nתת־מתכון: טופי בייטס\n115 גרם חמאה...\n\nלעוגיות\n220 גרם קמח...\n\nאופן הכנה:\n..."></textarea><div class="hint">המערכת מפרידה בין מצרכים, פעולות, טיפים ותתי־מתכונים. היא מציגה סתירות וחוסרים לבדיקה ולא שומרת אוטומטית.</div></div><div id="recipeImportStatus"></div><div class="actions" style="margin-top:14px"><button class="btn secondary" type="button" onclick="App.analyzeRecipeImport()">ניתוח והצגת מסך בדיקה</button><button class="btn ghost" type="button" onclick="App.close()">ביטול</button></div>`);setTimeout(()=>document.getElementById('recipeImportText')?.focus(),50)}
async function analyzeRecipeImport(){const text=document.getElementById('recipeImportText')?.value.trim(),status=document.getElementById('recipeImportStatus');if(!text)return alert('יש להדביק מתכון');if(status)status.innerHTML='<div class="notice" style="margin-top:12px">מנתחת מקומית מצרכים, שלבים, חלופות ותתי־מתכונים…</div>';pendingImport=sanitizeImportedRecipe(localParseRecipe(text),text);reviewImportedRecipe(pendingImport)}
function reviewImportedRecipe(r){
  const allIngredients=[...(r.ingredients||[]),...(r.subRecipes||[]).flatMap(s=>(s.ingredients||[]).map(i=>({...i,source:s.name})))],allSteps=combinedRecipeSteps({...r,id:'pending'});
  modal('בדיקת המתכון',`${r.warnings?.length?`<div class="notice warning"><strong>כדאי לבדוק:</strong><ul class="warning-list">${r.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:'<div class="notice success">המתכון נקרא בהצלחה.</div>'}<div class="import-clean-preview"><h3>${esc(r.name)}</h3><div class="import-preview-columns"><div class="card"><h3>רכיבים</h3><ul class="ingredient-list">${allIngredients.map(i=>`<li><strong>${i.asNeeded?'לפי הצורך':`${fmtQty(i.qty,i.unit)} ${esc(normalizedRecipeUnit(i.unit))}`}</strong> ${esc(i.name)}${i.source?` <small>· ${esc(i.source)}</small>`:''}${i.alternatives?.length?`<div class="meta">או: ${i.alternatives.map(a=>a?.name?`${fmtQty(a.qty,a.unit)} ${esc(normalizedRecipeUnit(a.unit))} ${esc(a.name)}`:esc(a?.text||'')).join(' / ')}</div>`:''}</li>`).join('')||'<li>לא זוהו רכיבים</li>'}</ul></div><div class="card"><h3>אופן ההכנה</h3><ol class="steps-list">${allSteps.map(s=>`<li>${esc(s.text)}</li>`).join('')||'<li>לא זוהו שלבים</li>'}</ol></div></div></div><div class="actions" style="margin-top:14px"><button class="btn secondary" onclick="App.openPendingRecipe()">פתיחה לעריכה ושמירה</button><button class="btn ghost" onclick="App.close()">ביטול</button></div>`)
}
function recipeBookCard(r,index=0){const p=packageSummary(r),minutes=Number(r.prepMin||0)+Number(r.bakeMin||0),tasks=groupedWorkflowFromRecipe(r).length,unit=salesUnitLabel(r),cost=recipeCost(r);return`<article class="recipe-book-card" data-search="${esc((r.name+' '+r.category).toLowerCase())}" data-category="${esc(r.category||'אחר')}" style="--book-index:${index}"><button class="recipe-book-cover" onclick="App.openBookRecipe('${r.id}')"><span class="recipe-book-glow"></span><div class="recipe-book-cover-top"><span class="recipe-book-category">${esc(r.category||'מתכון')}${r.subRecipes?.length?' · מורכב':''}</span><span class="recipe-book-symbol">✦</span></div><div class="recipe-book-title"><h3>${esc(r.name)}</h3><p>${r.subRecipes?.length?`${r.subRecipes.length} תתי־מתכונים`:'מתכון רגיל'}${tasks?` · ${tasks} משימות להזמנה`:''}</p></div><div class="recipe-book-metrics"><span><strong>${fmt(minutes,0)}</strong><small>דקות</small></span><span><strong>${recipeYieldUnits(r)}</strong><small>${esc(unit)}</small></span><span class="clickable-cost" role="button" tabindex="0" title="פתיחת פירוט עלות" onclick="event.stopPropagation();App.recipeCostBreakdown('${r.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();App.recipeCostBreakdown('${r.id}')}"><strong>${cost.perUnit!==null?money(cost.perUnit):'לא חושב'}</strong><small>עלות ל${esc(salesUnitSingular(unit))}</small></span></div><div class="recipe-book-open">פתיחת המתכון <span>←</span></div></button><div class="recipe-book-actions"><button class="btn small secondary" onclick="App.openBookRecipe('${r.id}')">פתיחה</button><button class="btn small ghost" onclick="App.weightCalc('${r.id}')">התאמת כמות</button><button class="btn small ghost" onclick="App.editRecipe('${r.id}')">עריכה</button></div></article>`}
function renderRecipeBook(){const cats=[...new Set(state.recipes.map(r=>r.category||'אחר'))].sort((a,b)=>a.localeCompare(b,'he')),totalBags=state.recipes.reduce((sum,r)=>sum+packageSummary(r).fullBags,0),complex=state.recipes.filter(r=>r.subRecipes?.length).length;document.getElementById('view-recipebook').innerHTML=`<section class="recipe-library"><div class="recipe-library-hero"><div class="recipe-library-copy"><span class="recipe-library-eyebrow">ספר העבודה שלך</span><h2>כל המתכונים, במקום אחד שנעים לעבוד בו</h2><p>חיפוש מהיר, פתיחה חלקה ונתוני תפוקה ברורים — בלי עומס ובלי טבלאות צפופות.</p><div class="recipe-library-actions"><button class="btn secondary" onclick="App.importRecipe()">✨ הדבקת מתכון</button><button class="btn ghost" onclick="App.newRecipe()">+ מתכון חדש</button></div></div><div class="recipe-library-summary"><div><strong>${state.recipes.length}</strong><span>מתכונים</span></div><div><strong>${complex}</strong><span>מורכבים</span></div><div><strong>${totalBags}</strong><span>שקיות בתפוקה</span></div><span class="recipe-library-orbit one"></span><span class="recipe-library-orbit two"></span></div></div><div class="recipe-book-toolbar premium"><label class="recipe-book-search"><span>⌕</span><input id="recipeBookSearch" type="search" placeholder="חיפוש לפי שם או קטגוריה…" oninput="App.filterRecipeBook()"></label><label class="recipe-book-select"><span>קטגוריה</span><select id="recipeBookCategory" onchange="App.filterRecipeBook()"><option value="">הכול</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label></div><div id="recipeBookGrid" class="recipe-book-grid premium-grid">${state.recipes.map((r,i)=>recipeBookCard(r,i)).join('')||'<div class="empty">עדיין אין מתכונים בספר.</div>'}</div></section>`}
function filterRecipeBook(){const q=String(document.getElementById('recipeBookSearch')?.value||'').toLowerCase().trim(),cat=document.getElementById('recipeBookCategory')?.value||'';document.querySelectorAll('#recipeBookGrid .recipe-card').forEach(card=>{card.hidden=!((!q||card.dataset.search.includes(q))&&(!cat||card.dataset.category===cat))})}
function ingredientDisplay(i,linkMap={}){
  const link=i.linkedSubRecipeId&&linkMap[i.linkedSubRecipeId],qty=i.asNeeded?'לפי הצורך':`${fmtQty(i.qty,i.unit)} ${esc(normalizedRecipeUnit(i.unit))}`,alts=(i.alternatives||[]).map(a=>a?.name?`${fmtQty(a.qty,a.unit)} ${normalizedRecipeUnit(a.unit)} ${a.name}`:String(a?.text||'')).filter(Boolean);
  return`<li><strong>${qty}</strong> ${link?`<button type="button" class="ingredient-link" onclick="App.openSubRecipeFromIngredient('${esc(link.pane)}')">${esc(i.name)} <span aria-hidden="true">↗</span></button>`:esc(i.name)}${alts.length?`<div class="meta">או: ${alts.map(esc).join(' / ')}</div>`:''}</li>`;
}
function stepsBlock(title,steps){return`<div class="card"><h3>${esc(title)}</h3><ol class="steps-list">${(steps||[]).map(s=>`<li>${esc(s.text)}</li>`).join('')||'<li>לא הוזנו שלבים</li>'}</ol></div>`}
function combinedRecipeSteps(r){
  const out=[];
  (r.subRecipes||[]).forEach((sub,si)=>(sub.steps||[]).forEach((s,i)=>out.push({...s,scope:'sub',subIndex:si,index:i,label:sub.name,kind:s.kind||'הכנה'})));
  (r.steps||[]).forEach((s,i)=>out.push({...s,scope:'main',index:i,label:r.name,kind:s.kind||'הכנה'}));
  (r.bakingSteps||[]).forEach((s,i)=>out.push({...s,scope:'baking',index:i,label:r.name,kind:s.kind||'אפייה'}));
  return out;
}
function unifiedStepsBlock(r){
  const steps=combinedRecipeSteps(r);
  return`<div class="card recipe-unified-steps"><div class="section-head"><div><h3>אופן ההכנה</h3><div class="hint">כל השלבים לפי סדר העבודה. לחיצה על שלב פותחת עריכה ואפשרויות מתקדמות.</div></div></div><ol class="steps-list interactive">${steps.map((s,n)=>`<li><button type="button" class="recipe-step-button" onclick="App.editRecipeStep('${r.id}','${s.scope}',${s.index},${s.subIndex??-1})"><span class="step-number">${n+1}</span><span class="step-copy"><strong>${esc(s.text)}</strong><small>${esc(s.kind)}${s.label?` · ${esc(s.label)}`:''}</small></span><span class="step-edit">עריכה</span></button></li>`).join('')||'<li>לא הוזנו שלבים</li>'}</ol></div>`;
}
function editRecipeStep(recipeId,scope,index,subIndex=-1){
  const r=recipe(recipeId);if(!r)return;
  const list=scope==='sub'?r.subRecipes?.[subIndex]?.steps:scope==='baking'?r.bakingSteps:r.steps;const step=list?.[index];if(!step)return;
  modal('עריכת שלב',`<form id="singleRecipeStepForm"><div class="field full"><label>מה עושים בשלב הזה?</label><textarea name="text" required>${esc(step.text||'')}</textarea></div><div class="form-grid three" style="margin-top:12px"><div class="field"><label>סוג השלב</label><select name="kind">${['הכנה','אפייה','קירור','מנוחה','התפחה','הרכבה'].map(k=>`<option ${String(step.kind|| (scope==='baking'?'אפייה':'הכנה'))===k?'selected':''}>${k}</option>`).join('')}</select></div><div class="field"><label>זמן פעיל בדקות</label><input name="durationMin" type="number" min="0" step="5" value="${Number(step.durationMin||0)}"></div><div class="field"><label>זמן פסיבי בדקות</label><input name="passiveMin" type="number" min="0" step="5" value="${Number(step.passiveMin||0)}"></div><div class="field"><label>כמה ימים לפני</label><input name="daysBefore" type="number" min="0" step="1" value="${Number(step.daysBefore||0)}"></div><div class="field"><label>שעה מועדפת</label><input name="time" type="time" value="${esc(step.time||'')}"></div><div class="field"><label>טמפרטורה</label><input name="ovenTemp" type="number" value="${Number(step.ovenTemp||0)||''}" placeholder="לא חובה"></div><div class="field full"><label>הערות פנימיות</label><textarea name="notes">${esc(step.notes||'')}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  document.getElementById('singleRecipeStepForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);Object.assign(step,{text:String(f.get('text')||'').trim(),durationMin:Math.max(0,Number(f.get('durationMin')||0)),passiveMin:Math.max(0,Number(f.get('passiveMin')||0)),daysBefore:Math.max(0,Number(f.get('daysBefore')||0)),time:String(f.get('time')||''),ovenTemp:Math.max(0,Number(f.get('ovenTemp')||0)),notes:String(f.get('notes')||''),kind:String(f.get('kind')||'הכנה')});await persist();close();openBookRecipe(r.id)}
}
function sectionHtml(title,ingredients,steps,bakingSteps=[],notes='',linkMap={}){
  return`<div class="recipe-stage"><div class="recipe-detail-grid"><div class="card"><h3>מצרכים</h3><ul class="ingredient-list">${(ingredients||[]).map(i=>ingredientDisplay(i,linkMap)).join('')||'<li>אין מצרכים</li>'}</ul></div>${stepsBlock('אופן ההכנה',steps)}</div>${bakingSteps?.length?`<div style="margin-top:14px">${stepsBlock('אפייה',bakingSteps)}</div>`:''}<div class="card" style="margin-top:14px"><h3>הערות</h3>${notes?`<div class="notice">${esc(notes).replace(/\n/g,'<br>')}</div>`:'<div class="muted">אין הערות</div>'}</div></div>`;
}
function openBookRecipe(recipeId){
  const r=recipe(recipeId);if(!r)return;const p=packageSummary(r),cost=recipeCost(r),unit=salesUnitLabel(r),yieldCount=recipeYieldUnits(r);
  const ingredientGroups=[{title:'רכיבי המתכון',items:r.ingredients||[]},...(r.subRecipes||[]).map(s=>({title:s.name,items:s.ingredients||[]}))];
  modal(r.name,`<div class="recipe-detail-hero"><div class="recipe-card-kicker">${esc(r.category||'מתכון')} ${r.subRecipes?.length?'· מתכון מורכב':''}</div><h3>${esc(r.name)}</h3><div class="recipe-card-meta" style="color:#f0dfd0;margin-top:12px"><span>${yieldCount?`${yieldCount} ${esc(unit)}`:'תפוקה לא הוגדרה'}${unit==='שקיות'?` · ${fmt(p.packageWeight,0)} גרם לשקית`:''}</span><span>${cost.perUnit!==null?`עלות ל${esc(salesUnitSingular(unit))} ${money(cost.perUnit)}`:'עלות ליחידה טרם חושבה'}</span><span>משקל סופי ${showQty(p.finalWeight,'גרם')}</span></div></div><div class="recipe-clean-view"><div class="card"><h3>רכיבים</h3>${ingredientGroups.map(g=>`<div class="ingredient-group"><h4>${esc(g.title)}</h4><ul class="ingredient-list">${g.items.map(i=>ingredientDisplay(i,{})).join('')||'<li>אין רכיבים</li>'}</ul></div>`).join('')}</div>${unifiedStepsBlock(r)}${r.notes?`<div class="card"><h3>הערות</h3><div class="notice">${esc(r.notes).replace(/\n/g,'<br>')}</div></div>`:''}</div><details class="recipe-backend"><summary>פרטים טכניים וניהול</summary><div class="notice">כאן נשמרים הנתונים הטכניים של המתכון. הם מוסתרים מהקריאה היומיומית.</div><div class="actions" style="margin-top:12px"><button class="btn ghost" onclick="App.editRecipe('${r.id}')">עריכת המתכון המלא</button><button class="btn ghost" onclick="App.recipeCostBreakdown('${r.id}')">פירוט עלות</button><button class="btn ghost" onclick="App.weightCalc('${r.id}')">התאמת כמות</button>${(r.originalRecipeBase||Number(r.savedScaleFactor)>0)?`<button class="btn ghost" onclick="App.resetRecipeOriginal('${r.id}')">חזרה לכמויות המקוריות</button>`:''}</div></details><div class="actions" style="margin-top:16px"><button class="btn secondary" onclick="App.copyRecipe('${r.id}')">העתקה</button><button class="btn ghost" onclick="window.print()">הדפסה</button></div>`)
}
function openSubRecipeFromIngredient(pane){
  document.querySelectorAll('.book-pane').forEach(x=>x.classList.toggle('active',x.id===`book-${pane}`));
  document.querySelectorAll('.inner-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.pane===pane));
  document.getElementById(`book-${pane}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function recipePlainText(r){const p=packageSummary(r);return`${r.name}\n${r.category||''}\n\nתפוקה: ${p.fullBags} שקיות × ${p.packageWeight} גרם\nמשקל סופי משוער: ${showQty(p.finalWeight,'גרם')}\nיתרה: ${showQty(p.remainder,'גרם')}\n\n${(r.subRecipes||[]).map((s,i)=>`שלב ${i+1} — תת־מתכון: ${s.name}\nמצרכים:\n${s.ingredients.map(x=>`• ${fmtQty(x.qty,x.unit)} ${normalizedRecipeUnit(x.unit)} ${x.name}`).join('\n')}\n\nאופן ההכנה:\n${s.steps.map((x,j)=>`${j+1}. ${x.text}`).join('\n')}\n\nהערות:\n${s.notes||'אין'}`).join('\n\n')}\n\nשלב ${(r.subRecipes||[]).length+1} — מתכון ראשי: ${r.name}\nמצרכים:\n${(r.ingredients||[]).map(i=>`• ${fmtQty(i.qty,i.unit)} ${normalizedRecipeUnit(i.unit)} ${i.name}${i.linkedSubRecipeId?' ↗ תת־מתכון':''}`).join('\n')}\n\nאופן ההכנה:\n${(r.steps||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n')}\n\nאפייה:\n${(r.bakingSteps||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n')}\n\nהערות:\n${r.notes||'אין'}`}


function inventoryCandidatesForIngredient(name,unit){const req=canonicalAmount(name,1,unit);return state.inventory.filter(i=>ingredientNamesEquivalent(i.name,name)&&canonicalAmount(i.name,1,inventoryUnit(i)).unit===req.unit).sort((a,b)=>String(a.expiry||'9999-12-31').localeCompare(String(b.expiry||'9999-12-31')))}
function productionConsumption(recipeObj,recipeRuns){return expandedIngredients(recipeObj).filter(i=>!isWaterIngredient(i.name)).map(i=>{const x=canonicalAmount(i.name,Number(i.qty||0)*recipeRuns,i.unit);return{name:i.name,qty:x.qty,unit:x.unit}}).reduce((arr,item)=>{const found=arr.find(x=>ingredientNamesEquivalent(x.name,item.name)&&x.unit===item.unit);if(found)found.qty+=item.qty;else arr.push(item);return arr},[])}
function productionShortages(consumption){return consumption.map(c=>({...c,available:invAmount(c.name,c.unit),missing:Math.max(0,c.qty-invAmount(c.name,c.unit))})).filter(x=>x.missing>0)}
function deductProductionConsumption(consumption){const deductions=[],shortages=[];consumption.forEach(c=>{let remaining=c.qty;const candidates=inventoryCandidatesForIngredient(c.name,c.unit);candidates.forEach(item=>{if(remaining<=0)return;const currentCanonical=canonicalAmount(item.name,inventoryTotal(item),inventoryUnit(item)),take=Math.min(remaining,currentCanonical.qty),oneCanonical=canonicalAmount(item.name,1,inventoryUnit(item));if(!oneCanonical.qty)return;const itemQty=take/oneCanonical.qty;item.stockQty=Math.max(0,inventoryTotal(item)-itemQty);deductions.push({inventoryId:item.id,name:item.name,qty:itemQty,unit:inventoryUnit(item),canonicalQty:take,canonicalUnit:c.unit});remaining-=take});if(remaining>0)shortages.push({name:c.name,qty:remaining,unit:c.unit})});return{deductions,shortages}}
function productionSummaryForm(){
  if(!state.recipes.length)return alert('יש להוסיף מתכון לפני דיווח ייצור.');const today=dayKey(new Date());
  modal('סיכום ייצור יומי',`<form id="productionSummaryForm"><div class="notice">בחרי מה הכנת וכמה פעמים הכנת את המתכון. חומרי הגלם יופחתו לפי כמויות המתכון. הכמות שיצאה בפועל נשמרת ביומן הייצור.</div><div class="form-grid"><div class="field"><label>תאריך</label><input name="date" type="date" required value="${today}"></div><div class="field"><label>מה אפית?</label><select name="recipeId" required>${state.recipes.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>כמה פעמים הוכן המתכון</label><input name="recipeRuns" type="number" min=".01" step=".01" required value="1"></div><div class="field"><label>כמות שיצאה בפועל</label><input name="outputQty" type="number" min="0" step=".01" required value="0"></div><div class="field"><label>יחידת תפוקה</label><select name="outputUnit"><option>שקיות</option><option>גרם</option><option>יחידות</option></select></div><div class="field"><label>פחת / פסילות</label><input name="wasteQty" type="number" min="0" step=".01" value="0"></div><div class="field full"><label>הערות</label><textarea name="notes" placeholder="לדוגמה: יצאו 2 שקיות פחות בגלל שברים"></textarea></div><div class="field full"><div id="productionConsumptionPreview" class="notice"></div></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה ועדכון המלאי</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  const form=document.getElementById('productionSummaryForm'),preview=document.getElementById('productionConsumptionPreview');const update=()=>{const r=recipe(form.elements.recipeId.value),b=Math.max(0,Number(form.elements.recipeRuns.value)||0),cons=r?productionConsumption(r,b):[],short=productionShortages(cons);preview.innerHTML=`<strong>יירד מהמלאי:</strong>${cons.length?`<ul>${cons.map(c=>`<li>${esc(c.name)} — ${showQty(c.qty,c.unit)}</li>`).join('')}</ul>`:' אין רכיבים לחישוב'}${short.length?`<div class="production-shortage"><strong>חסר כרגע:</strong> ${short.map(x=>`${esc(x.name)} ${showQty(x.missing,x.unit)}`).join(' · ')}</div>`:''}`};form.addEventListener('input',update);form.addEventListener('change',update);update();
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),r=recipe(f.get('recipeId')),recipeRuns=Math.max(0,Number(f.get('recipeRuns')||0));if(!r||!recipeRuns)return;const consumption=productionConsumption(r,recipeRuns),short=productionShortages(consumption);if(short.length&&!confirm(`אין מספיק מלאי עבור: ${short.map(x=>`${x.name} (${showQty(x.missing,x.unit)} חסר)`).join(', ')}. להמשיך ולעדכן את הקיים ל־0?`))return;const result=deductProductionConsumption(consumption),log={id:id('prodlog'),date:String(f.get('date')||today),recipeId:r.id,recipeName:r.name,recipeRuns,outputQty:Math.max(0,Number(f.get('outputQty')||0)),outputUnit:String(f.get('outputUnit')||'שקיות'),wasteQty:Math.max(0,Number(f.get('wasteQty')||0)),notes:String(f.get('notes')||''),deductions:result.deductions,shortages:result.shortages,createdAt:new Date().toISOString()};state.productionLogs.unshift(log);await persist();close();render();setStatus('✓ סיכום הייצור נשמר והמלאי עודכן')};
}
async function undoProductionLog(logId){const log=state.productionLogs.find(x=>x.id===logId);if(!log||!confirm(`לבטל את דיווח הייצור של ${log.recipeName}? חומרי הגלם שנגרעו יוחזרו למלאי.`))return;(log.deductions||[]).forEach(d=>{const item=state.inventory.find(i=>i.id===d.inventoryId);if(!item)return;item.stockQty=inventoryTotal(item)+Math.max(0,Number(d.qty||0));});state.productionLogs=state.productionLogs.filter(x=>x.id!==logId);await persist();render()}
function taskCenterItemHtml(item){
  const isPersonal=item.kind==='personal',done=!!item.done;
  const toggle=isPersonal?`App.toggleTodo('${esc(item.id)}')`:`App.toggleTask('${esc(item.planKey)}')`;
  const edit=isPersonal?`App.editTodo('${esc(item.id)}')`:`App.editPlanTask('${esc(item.planKey)}')`;
  const remove=isPersonal?`<button class="icon-btn" aria-label="מחיקת משימה" onclick="App.deleteTodo('${esc(item.id)}')">✕</button>`:'';
  const badge=isPersonal?'<span class="badge blue">אישי</span>':`<span class="badge green">${item.type==='delivery'?'מסירה':'ייצור'}</span>`;
  const when=item.dueDate?`${dateText(item.dueDate)}${item.time?' · '+esc(item.time):''}`:'ללא תאריך';
  return `<div class="task-center-item ${done?'done':''}"><label class="todo-check"><input type="checkbox" ${done?'checked':''} onchange="${toggle}"><span></span></label><button class="task-center-main" onclick="${edit}"><strong>${esc(item.text)}</strong><div class="meta">${when}${item.context?` · ${esc(item.context)}`:''}</div></button>${badge}<button class="btn small ghost" onclick="${edit}">עריכה</button>${remove}</div>`;
}
function setTaskCenterFilter(filter){taskCenterFilter=['all','production','personal','completed'].includes(filter)?filter:'all';renderProduction()}
function renderProduction(){
  const generated=generatedTasks().filter(t=>t.sourceType!=='todo');
  const production=generated.map(t=>({kind:'production',planKey:t.key,text:t.text,done:!!t.done,dueDate:t.date,time:t.time||'',type:t.type||'prep',context:[t.recipe,t.customer].filter(Boolean).join(' · ')}));
  const personal=todoSort(state.todoItems||[]).map(t=>({kind:'personal',id:t.id,text:t.text,done:!!t.done,dueDate:t.dueDate,time:t.plannerTime||'',priority:t.priority,context:t.notes||''}));
  const all=[...production,...personal].sort((a,b)=>Number(a.done)-Number(b.done)||(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')||(a.time||'99:99').localeCompare(b.time||'99:99'));
  const open=all.filter(x=>!x.done),done=all.filter(x=>x.done),today=dayKey(new Date());
  const visible=taskCenterFilter==='production'?production.filter(x=>!x.done):taskCenterFilter==='personal'?personal.filter(x=>!x.done):taskCenterFilter==='completed'?done:open;
  const labels={all:'הכול',production:'ייצור',personal:'אישי',completed:'הושלמו'};
  const tabs=['all','production','personal','completed'].map(key=>`<button class="task-filter ${taskCenterFilter===key?'active':''}" onclick="App.setTaskCenterFilter('${key}')">${labels[key]} <span>${key==='all'?open.length:key==='production'?production.filter(x=>!x.done).length:key==='personal'?personal.filter(x=>!x.done).length:done.length}</span></button>`).join('');
  const d=demand().byRecipe,logs=(state.productionLogs||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  document.getElementById('view-production').innerHTML=`<div class="section-head task-center-head"><div><h2>משימות</h2><div class="hint">כל משימות הייצור והמשימות האישיות במקום אחד. משימה עם תאריך מופיעה גם בתכנון השבועי.</div></div><div class="actions"><button class="btn secondary" onclick="App.newTodo()">+ משימה אישית</button><button class="btn ghost" onclick="App.productionSummary()">+ סיכום ייצור יומי</button></div></div><div class="grid three todo-summary"><div class="metric"><div class="label">פתוחות</div><div class="value">${open.length}</div></div><div class="metric"><div class="label">להיום</div><div class="value">${open.filter(x=>x.dueDate===today).length}</div></div><div class="metric"><div class="label">הושלמו</div><div class="value">${done.length}</div></div></div><div class="task-filter-bar">${tabs}</div><div class="card task-center-list">${visible.length?visible.map(taskCenterItemHtml).join(''):`<div class="empty">${taskCenterFilter==='completed'?'אין עדיין משימות שהושלמו':'אין משימות בקטגוריה הזאת 🎉'}</div>`}</div>${taskCenterFilter==='production'?`<div class="grid two task-production-extras"><div class="card"><h2>תכנון כמויות להזמנות</h2>${Object.entries(d).map(([rid,q])=>{const r=recipe(rid),yieldBags=recipeYieldBags(r),b=Math.ceil(q/yieldBags),left=b*yieldBags-q;return`<div class="kpi-line"><span>${esc(r?.name||'מתכון')}</span><strong>${fmt(q,0)} שקיות · ${b} הכנות · עודף ${fmt(left,0)} שקיות</strong></div>`}).join('')||'<div class="empty">אין הזמנות פעילות</div>'}</div><div class="card"><h2>יומן ייצור אחרון</h2>${logs.length?logs.slice(0,8).map(log=>`<div class="production-log-row"><div><strong>${esc(log.recipeName)}</strong><div class="meta">${dateText(log.date)} · ${fmt(log.recipeRuns,0)} הכנות · יצאו ${fmt(log.outputQty,2)} ${esc(log.outputUnit)}</div></div><button class="btn small danger" onclick="App.undoProductionLog('${log.id}')">ביטול דיווח</button></div>`).join(''):'<div class="empty">עדיין אין דיווחי ייצור</div>'}</div></div>`:''}`;
}

function renderShopping(){const items=shopping(),g={},opts=supplierOptions(),best=opts[0];items.forEach(i=>(g[i.category]||(g[i.category]=[])).push(i));document.getElementById('view-shopping').innerHTML=`<div class="grid two shopping-layout"><div class="card shopping-list-card"><div class="section-head shopping-head"><h2>רשימת קניות מאוחדת</h2><button class="btn small ghost" onclick="window.print()">הדפסה</button></div>${items.length?Object.entries(g).map(([cat,a])=>`<section class="shopping-group"><h3>${esc(cat)}</h3>${a.map(i=>`<label class="task shopping-item ${i.checked?'done':''}"><input type="checkbox" ${i.checked?'checked':''} onchange="App.toggleShopping('${esc(i.key)}')"><div class="task-text"><strong>${esc(i.name)}</strong><div class="meta shopping-amounts"><span>דרוש ${showShoppingQty(i.required,i.unit)}</span><span>במלאי ${showShoppingQty(i.available,i.unit)}</span><span>לקנייה ${showShoppingQty(i.need,i.unit)}</span></div></div></label>`).join('')}</section>`).join(''):'<div class="empty">אין חוסרים</div>'}</div><div class="card shopping-summary-card"><h2>המלצת סל</h2>${best?`<div class="notice shopping-summary"><strong>${esc(best.supplier.name)}</strong><div class="shopping-summary-lines"><span>פריטים ${money(best.itemsCost)}</span><span>משלוח ${money(best.delivery)}</span><span>נסיעה ${money(best.distanceCost)}</span></div><strong>סה"כ ${money(best.total)}</strong></div><div class="hint" style="margin-top:10px">מבוסס על המחירים שהוזנו או יובאו ועל המרחקים שהגדרת.</div>`:'<div class="empty">הוסיפי ספקים ומחירים</div>'}${opts.length?`<div class="table-wrap shopping-supplier-table" style="margin-top:12px"><table><thead><tr><th>ספק</th><th>כיסוי</th><th>סה"כ</th></tr></thead><tbody>${opts.map(o=>`<tr><td>${esc(o.supplier.name)}</td><td>${o.covered}/${items.length}</td><td class="money">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`:''}</div></div>`}

function renderInventory(){
  const soon=addDays(new Date(),7);
  document.getElementById('view-inventory').innerHTML=`<div class="card"><div class="section-head"><div><h2>מלאי</h2><div class="hint">הכמות בפועל נשמרת בדיוק, גם לאחר שימוש בחלק מאריזה. הספק, משקל האריזה והיחידה נשאבים מעמוד ספקים ומחירים.</div></div><div class="actions"><button class="btn ghost" onclick="App.productionSummary()">+ סיכום ייצור</button><button class="btn secondary" onclick="App.newInventory()">+ פריט מלאי</button></div></div>${state.inventory.length?`<div class="table-wrap"><table><thead><tr><th>רכיב</th><th>יחידות</th><th>בכל אריזה</th><th>כמות בפועל</th><th>ספק</th><th>תפוגה</th><th>מיקום</th><th></th></tr></thead><tbody>${state.inventory.map(i=>{const count=inventoryPackageCount(i),per=inventoryAmountPerPackage(i),unit=inventoryUnit(i),total=inventoryTotal(i),supplier=inventorySupplier(i),linked=inventoryLinkedPrice(i),exp=i.expiry&&new Date(i.expiry)<=soon;return`<tr><td><strong>${esc(i.name)}</strong></td><td><div class="inventory-stepper"><button type="button" aria-label="הפחתת אריזה" onclick="App.adjustInventory('${i.id}',-1)">−</button><input type="number" min="0" step="1" value="${Math.round(count)}" aria-label="מספר יחידות" onchange="App.setInventoryCount('${i.id}',this.value)"><button type="button" aria-label="הוספת אריזה" onclick="App.adjustInventory('${i.id}',1)">+</button></div></td><td>${showQty(per,unit)}</td><td><strong>${showQty(Math.round(total),'גרם')}</strong></td><td>${supplier?`<strong>${esc(supplier.name)}</strong><div class="meta">${esc(linked?.ingredient||'')}</div>`:'<span class="muted">לא נמצא מחיר תואם</span>'}</td><td>${i.expiry?dateText(i.expiry):'—'} ${exp?'<span class="badge gold">קרוב</span>':''}</td><td>${esc(i.location||'')}</td><td><div class="actions"><button class="btn small ghost" onclick="App.editInventory('${i.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteInventory('${i.id}')">מחיקה</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">אין פריטי מלאי</div>'}</div>`;
}
function recipeIngredientCatalog(){
  const byName=new Map();
  state.recipes.forEach(r=>{const add=(ingredient,source)=>{const name=String(ingredient?.name||'').trim(),key=cleanIngredientName(name);if(!name||!key)return;if(!byName.has(key))byName.set(key,{name,sources:new Set()});if(source)byName.get(key).sources.add(source)};(r.ingredients||[]).forEach(i=>add(i,r.name));(r.subRecipes||[]).forEach(sub=>(sub.ingredients||[]).forEach(i=>add(i,`${r.name} · ${sub.name}`)))});
  return [...byName.values()].filter(item=>!isWaterIngredient(item.name)).map(item=>({name:item.name,sources:[...item.sources]})).sort((a,b)=>a.name.localeCompare(b.name,'he'));
}
async function adjustInventory(idValue,delta){const item=state.inventory.find(i=>i.id===idValue);if(!item)return;const per=inventoryAmountPerPackage(item);item.stockQty=Math.max(0,inventoryTotal(item)+Number(delta||0)*per);item.packageCount=Math.max(0,Math.round(Number(item.packageCount||0)+Number(delta||0)));await persist();renderInventory()}
async function setInventoryCount(idValue,value){const item=state.inventory.find(i=>i.id===idValue);if(!item)return;const count=Math.max(0,Math.round(Number(value)||0)),per=inventoryAmountPerPackage(item);item.packageCount=count;if(per)item.stockQty=count*per;await persist();renderInventory()}

function inventoryForm(i={id:'',name:'',packageCount:0,stockQty:0,amountPerPackage:0,unit:'גרם',expiry:'',location:'',supplierId:'',supplierPriceId:''}){
  const packageCount=inventoryPackageCount(i),ingredientCatalog=recipeIngredientCatalog(),linked=inventoryLinkedPrice(i),linkedPack=linked?canonicalAmount(linked.ingredient,linked.packQty,linked.unit):null,initialPer=Math.round(linkedPack?.unit==='גרם'?linkedPack.qty:inventoryAmountPerPackage(i)),initialUnit='גרם',initialStock=Number.isFinite(Number(i.stockQty))?Number(i.stockQty):packageCount*initialPer;
  modal(i.id?'עריכת מלאי':'פריט מלאי חדש',`<form id="invForm"><input type="hidden" name="id" value="${esc(i.id)}"><div class="form-grid"><div class="field inventory-ingredient-field"><label>רכיב</label><div class="ingredient-picker"><input id="inventoryIngredientInput" name="name" required autocomplete="off" aria-autocomplete="list" aria-controls="inventoryIngredientSuggestions" aria-expanded="false" placeholder="לחצי לבחירה או הקלידי רכיב" value="${esc(i.name)}"><div id="inventoryIngredientSuggestions" class="ingredient-suggestions" role="listbox" hidden></div></div><div class="hint">הרשימה כוללת את כל הרכיבים מהמתכונים ומתתי־המתכונים.</div></div><div class="field"><label>יחידות</label><input name="packageCount" type="number" step="1" min="0" value="${Math.round(packageCount)}"></div><div class="field"><label>ספק ומוצר תואם</label><select name="supplierPriceId" id="inventorySupplierSelect"></select><div class="hint">כשיש כמה התאמות, בחרי את הנכונה פעם אחת והיא תישמר.</div></div><div class="field"><label>כמות בכל אריזה</label><input name="amountPerPackage" type="number" step="1" min="0" value="${Math.round(initialPer)}"></div><div class="field"><label>יחידת מלאי</label><input name="unit" value="גרם" readonly></div><div class="field"><label>כמות בפועל במלאי (גרם)</label><input name="stockQty" type="number" step="1" min="0" value="${Math.round(initialStock)}"><div class="hint">אפשר לעדכן ידנית; סיכום ייצור יפחית מכאן אוטומטית.</div></div><div class="field"><label>תפוגה</label><input name="expiry" type="date" value="${esc(i.expiry)}"></div><div class="field"><label>מיקום אחסון</label><input name="location" value="${esc(i.location)}"></div><div class="field full"><div id="inventorySourceNote" class="hint"></div><div id="inventoryTotalPreview" class="notice"></div></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  const form=document.getElementById('invForm'),ingredientInput=document.getElementById('inventoryIngredientInput'),suggestionsBox=document.getElementById('inventoryIngredientSuggestions'),supplierSelect=document.getElementById('inventorySupplierSelect'),sourceNote=document.getElementById('inventorySourceNote');let stockManuallyEdited=!!i.id;
  const renderIngredientSuggestions=()=>{const query=cleanIngredientName(ingredientInput.value),matches=ingredientCatalog.filter(item=>!query||cleanIngredientName(item.name).includes(query)).sort((a,b)=>{const an=cleanIngredientName(a.name),bn=cleanIngredientName(b.name),as=an.startsWith(query)?0:1,bs=bn.startsWith(query)?0:1;return as-bs||a.name.localeCompare(b.name,'he')});suggestionsBox.innerHTML=matches.length?matches.map(item=>`<button type="button" class="ingredient-suggestion" role="option" data-value="${esc(item.name)}"><strong>${esc(item.name)}</strong>${item.sources.length?`<small>${esc(item.sources.slice(0,3).join(' · '))}${item.sources.length>3?' ועוד':''}</small>`:''}</button>`).join(''):`<div class="ingredient-suggestions-empty">לא נמצא רכיב מתאים. אפשר להמשיך להקליד ולשמור כרכיב חדש.</div>`;suggestionsBox.hidden=false;ingredientInput.setAttribute('aria-expanded','true')};
  const hideIngredientSuggestions=()=>{suggestionsBox.hidden=true;ingredientInput.setAttribute('aria-expanded','false')};
  const update=()=>{const count=Math.max(0,Math.round(Number(form.elements.packageCount.value)||0)),per=Math.max(0,Number(form.elements.amountPerPackage.value)||0),stock=Math.max(0,Math.round(Number(form.elements.stockQty.value)||0)),unit='גרם';document.getElementById('inventoryTotalPreview').innerHTML=`כמות בפועל: <strong>${showQty(stock,unit)}</strong> · ${count} יחידות של ${showQty(per,unit)}`};
  const applyPrice=option=>{if(!option)return;const pack=canonicalAmount(option.ingredient,option.packQty,option.unit),grams=Math.round(pack.unit==='גרם'?pack.qty:Number(option.packQty||0));form.elements.amountPerPackage.value=grams;form.elements.unit.value='גרם';if(!stockManuallyEdited)form.elements.stockQty.value=Math.round(Math.max(0,Number(form.elements.packageCount.value)||0)*grams);sourceNote.innerHTML=`המשקל נקרא מתוך <strong>${esc(option.supplierName)}</strong>: ${esc(option.ingredient)} · ${showQty(grams,'גרם')} באריזה.`};
  const syncSupplierOptions=(preferred=i.supplierPriceId||'')=>{const options=supplierPriceMatches(ingredientInput.value);supplierSelect.innerHTML=options.length?options.map(o=>`<option value="${esc(o.priceId)}" data-supplier="${esc(o.supplierId)}" ${o.priceId===preferred?'selected':''}>${esc(o.supplierName)} · ${esc(o.ingredient)} · ${showQty(o.packQty,o.unit)} · ${money(o.packPrice)} (${o.matchScore}%)</option>`).join(''):'<option value="">לא נמצא מחיר תואם</option>';const chosen=options.find(o=>o.priceId===supplierSelect.value)||options[0];if(chosen){supplierSelect.value=chosen.priceId;applyPrice(chosen)}else sourceNote.textContent='לא נמצאה התאמה בטוחה. אפשר להזין משקל ויחידה ידנית או להוסיף מחיר בעמוד ספקים.';update()};
  ingredientInput.addEventListener('focus',renderIngredientSuggestions);ingredientInput.addEventListener('click',renderIngredientSuggestions);ingredientInput.addEventListener('input',()=>{renderIngredientSuggestions();syncSupplierOptions('')});ingredientInput.addEventListener('keydown',e=>{if(e.key==='Escape')hideIngredientSuggestions()});ingredientInput.addEventListener('blur',()=>setTimeout(hideIngredientSuggestions,140));
  suggestionsBox.addEventListener('pointerdown',e=>{const option=e.target.closest('.ingredient-suggestion');if(!option)return;e.preventDefault();ingredientInput.value=option.dataset.value||'';hideIngredientSuggestions();syncSupplierOptions('');ingredientInput.focus()});
  supplierSelect.addEventListener('change',()=>{const option=supplierPriceMatches(ingredientInput.value).find(o=>o.priceId===supplierSelect.value);applyPrice(option);update()});form.elements.packageCount.addEventListener('input',()=>{if(!stockManuallyEdited)form.elements.stockQty.value=Math.max(0,Number(form.elements.packageCount.value)||0)*Math.max(0,Number(form.elements.amountPerPackage.value)||0);update()});form.elements.amountPerPackage.addEventListener('input',()=>{if(!stockManuallyEdited)form.elements.stockQty.value=Math.max(0,Number(form.elements.packageCount.value)||0)*Math.max(0,Number(form.elements.amountPerPackage.value)||0);update()});form.elements.stockQty.addEventListener('input',()=>{stockManuallyEdited=true;update()});form.addEventListener('change',update);syncSupplierOptions(i.supplierPriceId||'');update();
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),ex=state.inventory.find(x=>x.id===f.get('id')),price=supplierPriceMatches(f.get('name')).find(o=>o.priceId===f.get('supplierPriceId')),obj={id:f.get('id')||id('inv'),name:String(f.get('name')||'').trim(),packageCount:Math.max(0,Math.round(Number(f.get('packageCount')||0))),stockQty:Math.max(0,Math.round(Number(f.get('stockQty')||0))),amountPerPackage:Math.max(0,Math.round(Number(f.get('amountPerPackage')||0))),unit:'גרם',expiry:f.get('expiry'),location:f.get('location'),supplierId:price?.supplierId||'',supplierPriceId:String(f.get('supplierPriceId')||'')};if(ex)Object.assign(ex,obj);else state.inventory.push(obj);await persist();close();render()};
}
function xmlText(node,tag){return node.querySelector(tag)?.textContent?.trim()||''}
function normalizeCatalogText(value){
  return String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0591-\u05c7]/g,'')
    .replace(/ק[״"']?ג/g,' קילוגרם ').replace(/מ[״"']?ל/g,' מיליליטר ')
    .replace(/[ך]/g,'כ').replace(/[ם]/g,'מ').replace(/[ן]/g,'נ').replace(/[ף]/g,'פ').replace(/[ץ]/g,'צ')
    .replace(/[^\u0590-\u05ffa-z0-9.\s]/g,' ').replace(/\s+/g,' ').trim();
}
const PRICE_SEARCH_STOP_WORDS=new Set(['של','עם','את','על','או','ו','ה','ל','מוצר','מוצרים','אריזה','מותג']);
const PRICE_QUERY_ALIASES={
  'רגיל':['לבן','בהיר','חיטה'],'לבן':['בהיר'],'בהיר':['לבן'],'מנופה':['נפה'],
  'אפיה':['אפייה'],'אפייה':['אפיה'],'קורנפלור':['עמילן','תירס'],'עמילן':['קורנפלור'],
  'גלוקוזה':['גלוקוז','סירופ','תירס'],'גלוקוז':['גלוקוזה','סירופ'],'וניל':['תמצית'],
  'ציפס':['שבבים','נטיפי'],'שבבים':['ציפס'],'חמאה':['חמאה'],'שמנת':['הקצפה','מתוקה'],
  'אבקה':['אבקת'],'ביצה':['ביצים'],'ביצים':['ביצה'],'קילו':['קילוגרם'],'קילוגרם':['קילו']
};
const PRIVATE_BRAND_LABEL='רמי לוי / שיווק השקמה';
function catalogTokens(value){return normalizeCatalogText(value).split(' ').filter(Boolean)}
function isUnknownBrand(value){const n=normalizeCatalogText(value);return!n||n==='לא ידוע'||n==='לא ידועה'||n==='unknown'}
function isRamiPrivateLabel(item){const t=normalizeCatalogText(`${item?.name||''} ${item?.manufacturer||''} ${item?.description||''}`);return/(?:רמי\s*לוי|רמילוי|רמי\s+לו\b|(?:^|\s)רמי$)/.test(t)||normalizeCatalogText(item?.manufacturer)==='רמי לוי'}
function catalogBrand(item){if(isRamiPrivateLabel(item))return PRIVATE_BRAND_LABEL;return isUnknownBrand(item?.manufacturer)?'לא ידוע':String(item.manufacturer).trim()}
function privateBrandQuery(value){return/(?:רמי\s*לוי|רמילוי|רמי\s+לו\b|שיווק\s*השקמה|מותג\s*פרטי)/.test(normalizeCatalogText(value))}
function inferPackFromName(name){
  const raw=String(name||'').replace(/,/g,'.');
  const matches=[...raw.matchAll(/(\d+(?:\.\d+)?)\s*(ק[״"']?ג|קג|קילו(?:גרם)?|גרם|גר\b|ג\b|ליטר|ל\b|מ[״"']?ל|מל\b|מיליליטר)/gi)];
  if(!matches.length)return null;
  const m=matches[matches.length-1],qty=Number(m[1]),u=normalizeCatalogText(m[2]);
  if(!qty)return null;
  if(/קילוגרם|קילו|קג/.test(u))return{qty,unit:'ק"ג'};
  if(/גרם|^גר$|^ג$/.test(u))return{qty,unit:'גרם'};
  if(/מיליליטר|^מל$/.test(u))return{qty,unit:'מ"ל'};
  if(/ליטר|^ל$/.test(u))return{qty,unit:'ליטר'};
  return null;
}
function mapPriceUnit(unitQty,quantity,itemName=''){const u=normalizeCatalogText(unitQty);let unit='יחידה',qty=Number(quantity||1);if(/קילוגרם|קג/.test(u))unit='ק"ג';else if(/גרם/.test(u))unit='גרם';else if(/ליטר/.test(u)&&!/מילי/.test(u))unit='ליטר';else if(/מיליליטר|מל/.test(u))unit='מ"ל';else if(/יחידה/.test(u))unit='יחידה';const inferred=inferPackFromName(itemName);if(inferred&&(isUnknownBrand(unitQty)||unit==='יחידה'&&qty<=1||!qty))return inferred;return{unit,qty:qty||1}}
function effectiveCatalogPack(item){const inferred=inferPackFromName(item?.name);if(inferred&&(item?.unit==='יחידה'&&Number(item?.packQty||0)<=1||!item?.packQty))return inferred;return{qty:Number(item?.packQty||1),unit:item?.unit||'יחידה'}}
function effectiveCatalogPrice(item){return Number(item?.salePrice||item?.price||0)}
function comparableUnitPrice(item){
  const price=effectiveCatalogPrice(item),pack=effectiveCatalogPack(item),qty=Number(pack.qty||0);
  if(!price||!qty)return{value:Infinity,label:'—'};
  if(pack.unit==='גרם')return{value:price/qty*1000,label:`${money(price/qty*1000)} לק״ג`};
  if(pack.unit==='ק"ג')return{value:price/qty,label:`${money(price/qty)} לק״ג`};
  if(pack.unit==='מ"ל')return{value:price/qty*1000,label:`${money(price/qty*1000)} לליטר`};
  if(pack.unit==='ליטר')return{value:price/qty,label:`${money(price/qty)} לליטר`};
  return{value:price/qty,label:`${money(price/qty)} ליחידה`};
}
function editDistanceLimited(a,b,max=2){
  if(a===b)return 0;if(Math.abs(a.length-b.length)>max)return max+1;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const cur=[i];let rowMin=cur[0];for(let j=1;j<=b.length;j++){cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));rowMin=Math.min(rowMin,cur[j])}if(rowMin>max)return max+1;prev=cur}return prev[b.length]
}
function tokenAlternatives(token){return[token,...(PRICE_QUERY_ALIASES[token]||[])]}
function bestCatalogTokenScore(token,data,allowFuzzy=true){
  let best=0;
  for(const alt of tokenAlternatives(token)){
    if(data.nameTokens.includes(alt))best=Math.max(best,38);
    if(data.brandTokens.includes(alt))best=Math.max(best,31);
    if(data.descriptionTokens.includes(alt))best=Math.max(best,17);
    if(alt.length>=3&&data.nameTokens.some(w=>w.startsWith(alt)||alt.startsWith(w)&&w.length>=4))best=Math.max(best,22);
    if(alt.length>=3&&data.brandTokens.some(w=>w.startsWith(alt)||alt.startsWith(w)&&w.length>=4))best=Math.max(best,18);
    if(allowFuzzy&&alt.length>=3){
      for(const w of data.nameTokens){const max=alt.length>=7?2:1,d=editDistanceLimited(alt,w,max);if(d<=max){best=Math.max(best,d===1?14:8);break}}
      for(const w of data.brandTokens){const max=alt.length>=7?2:1,d=editDistanceLimited(alt,w,max);if(d<=max){best=Math.max(best,d===1?11:6);break}}
    }
  }
  return best;
}
function catalogSearchData(item){
  let data=priceCatalogSearchCache.get(item);if(data)return data;
  const brand=catalogBrand(item),name=normalizeCatalogText(item.name),description=normalizeCatalogText(item.description||''),brandNorm=normalizeCatalogText(brand);
  data={name,description,brand,brandNorm,nameTokens:catalogTokens(name),descriptionTokens:catalogTokens(description),brandTokens:catalogTokens(brandNorm),barcode:String(item.barcode||'')};
  priceCatalogSearchCache.set(item,data);return data;
}
function buildCatalogQuery(value){
  const raw=normalizeCatalogText(value),privateBrand=privateBrandQuery(raw);
  let productRaw=raw.replace(/(?:רמי\s*לוי|רמילוי|רמי\s+לו\b|שיווק\s*השקמה|מותג\s*פרטי)/g,' ');
  const tokens=catalogTokens(productRaw).filter(t=>!PRICE_SEARCH_STOP_WORDS.has(t));
  return{raw,productRaw:normalizeCatalogText(productRaw),tokens,privateBrand,barcode:/^\d{5,}$/.test(raw)?raw:''};
}
function prepareCatalogQuery(query,items){
  query.exactTokens=new Set();
  for(const token of query.tokens){
    const alternatives=tokenAlternatives(token);
    const exists=items.some(item=>{const data=catalogSearchData(item);return alternatives.some(alt=>data.nameTokens.includes(alt)||data.brandTokens.includes(alt)||data.descriptionTokens.includes(alt))});
    if(exists)query.exactTokens.add(token);
  }
  return query;
}
function scoreCatalogItem(item,query){
  const data=catalogSearchData(item);
  if(query.privateBrand&&!isRamiPrivateLabel(item))return-Infinity;
  if(query.barcode)return data.barcode.includes(query.barcode)?1000: -Infinity;
  if(!query.tokens.length)return query.privateBrand?120:0;
  let score=0;
  if(query.productRaw&&data.name.includes(query.productRaw))score+=115;
  if(query.productRaw&&data.brandNorm.includes(query.productRaw))score+=90;
  for(const token of query.tokens){const s=bestCatalogTokenScore(token,data,!query.exactTokens?.has(token));if(!s)return-Infinity;score+=s}
  const primary=query.tokens[0];if(data.nameTokens[0]===primary)score+=55;else if(data.nameTokens.includes(primary))score+=28;
  if(isRamiPrivateLabel(item))score+=query.privateBrand?35:0;
  if(data.name.startsWith(query.productRaw))score+=40;
  return score;
}
function parseRamiXML(text,fileName=''){
  const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('קובץ XML לא תקין');
  const storeId=xmlText(doc,'StoreID'),chainId=xmlText(doc,'ChainID'),subChainId=xmlText(doc,'SubChainID'),items=[...doc.querySelectorAll('Items > Item')].map(node=>{
    const name=xmlText(node,'ItemName')||xmlText(node,'ManufactureItemDescription'),pack=mapPriceUnit(xmlText(node,'UnitQty'),xmlText(node,'Quantity'),name),price=Number(xmlText(node,'ItemPrice')||0),sale=Number(xmlText(node,'DiscountedPrice')||xmlText(node,'PromoPrice')||xmlText(node,'ItemPriceWithDiscount')||0);
    return{barcode:xmlText(node,'ItemCode'),name,manufacturer:xmlText(node,'ManufactureName'),packQty:pack.qty,unit:pack.unit,price,salePrice:sale&&sale<price?sale:null}
  }).filter(i=>i.name&&i.price);
  const branch=storeId==='055'?{name:'רמת החייל',address:'דבורה הנביאה 127'}:{name:`סניף ${storeId}`,address:''};return{id:id('price'),source:'רמי לוי',fileName,chainId,subChainId,storeId,branchName:branch.name,address:branch.address,importedAt:new Date().toISOString(),items}
}
async function importRamiFile(file){try{setStatus('פותחת קובץ מחירים…');const text=await readMaybeGzip(file),data=parseRamiXML(text,file.name);state.priceImports=state.priceImports.filter(x=>!(x.source==='רמי לוי'&&x.storeId===data.storeId));state.priceImports.unshift(data);priceCatalogSearchCache.clear?.();await persist();alert(`יובאו ${data.items.length} מוצרים מסניף ${data.storeId} — ${data.branchName}.`);go('suppliers')}catch(e){console.error(e);alert(`לא ניתן לייבא את הקובץ: ${e.message}`)}}
function currentPriceImport(){return state.priceImports[0]||null}
function catalogBrands(imp){
  const counts=new Map();for(const item of imp?.items||[]){const b=catalogBrand(item);if(b==='לא ידוע')continue;counts.set(b,(counts.get(b)||0)+1)}
  return[...counts.entries()].sort((a,b)=>a[0]===PRIVATE_BRAND_LABEL?-1:b[0]===PRIVATE_BRAND_LABEL?1:b[1]-a[1]||a[0].localeCompare(b[0],'he')).map(([name,count])=>({name,count}))
}
function renderPriceCatalog(){
  const imp=currentPriceImport();if(!imp)return'<div class="empty">עדיין לא יובא קובץ מחירים.</div>';
  const brands=catalogBrands(imp);
  return`<div class="import-summary"><div><strong>${esc(imp.storeId)}</strong><div class="muted">מספר סניף</div></div><div><strong>${esc(imp.branchName)}</strong><div class="muted">${esc(imp.address)}</div></div><div><strong>${imp.items.length.toLocaleString('he-IL')}</strong><div class="muted">מוצרים בקובץ</div></div><div><strong>${dateText(imp.importedAt)}</strong><div class="muted">מועד ייבוא</div></div></div>
  <div class="notice smart-search-note"><strong>חיפוש חכם:</strong> אפשר לחפש מוצר, מותג או ברקוד. החיפוש מזהה שגיאות כתיב קטנות, מילים דומות ושמות מותג חלופיים. חיפוש “שיווק השקמה” מזהה את המותג הפרטי של רמי לוי.</div>
  <div class="catalog-filter-grid">
    <div class="field catalog-query"><label>מוצר, מותג או ברקוד</label><input id="priceCatalogSearch" placeholder="לדוגמה: קמח לבן מנופה, רמי לוי, 729…" oninput="App.schedulePriceCatalogFilter()"></div>
    <div class="field"><label>מותג</label><input id="priceCatalogBrand" list="priceCatalogBrands" placeholder="כל המותגים" oninput="App.schedulePriceCatalogFilter()"><datalist id="priceCatalogBrands">${brands.map(b=>`<option value="${esc(b.name)}">${b.count} מוצרים</option>`).join('')}</datalist></div>
    <div class="field"><label>מיון לפי מחיר</label><select id="priceCatalogSort" onchange="App.filterPriceCatalog()"><option value="price-asc">מהנמוך לגבוה</option><option value="price-desc">מהגבוה לנמוך</option></select></div>
    <div class="field"><label>מילים שלא להציג</label><input id="priceCatalogExclude" placeholder="למשל: ללא גלוטן, כוסמין" oninput="App.schedulePriceCatalogFilter()"></div>
    <div class="field"><label>מספר תוצאות</label><select id="priceCatalogLimit" onchange="App.filterPriceCatalog()"><option value="40">40 תוצאות</option><option value="100">100 תוצאות</option><option value="250">250 תוצאות</option><option value="500">500 תוצאות</option></select></div>
  </div>
  <div class="catalog-quick-actions"><button type="button" class="btn small secondary" onclick="App.setPrivateBrandFilter()">מותג פרטי רמי לוי / שיווק השקמה</button><button type="button" class="btn small ghost" onclick="App.clearPriceCatalogFilters()">ניקוי סינון</button></div>
  <div id="priceCatalogRows"></div>`
}
function schedulePriceCatalogFilter(){clearTimeout(priceCatalogFilterTimer);priceCatalogFilterTimer=setTimeout(filterPriceCatalog,170)}
function setPrivateBrandFilter(){const el=document.getElementById('priceCatalogBrand');if(el)el.value=PRIVATE_BRAND_LABEL;filterPriceCatalog()}
function clearPriceCatalogFilters(){for(const id of ['priceCatalogSearch','priceCatalogBrand','priceCatalogExclude']){const el=document.getElementById(id);if(el)el.value=''}const sort=document.getElementById('priceCatalogSort');if(sort)sort.value='price-asc';filterPriceCatalog()}
function filterPriceCatalog(){
  const imp=currentPriceImport(),box=document.getElementById('priceCatalogRows');if(!imp||!box)return;
  const query=prepareCatalogQuery(buildCatalogQuery(document.getElementById('priceCatalogSearch')?.value||''),imp.items),brandValue=document.getElementById('priceCatalogBrand')?.value||'',brandPrivate=privateBrandQuery(brandValue)||normalizeCatalogText(brandValue)===normalizeCatalogText(PRIVATE_BRAND_LABEL),brandNorm=normalizeCatalogText(brandValue),sort=document.getElementById('priceCatalogSort')?.value||'price-asc',excludeTokens=catalogTokens(document.getElementById('priceCatalogExclude')?.value||'').filter(t=>!PRICE_SEARCH_STOP_WORDS.has(t)),limit=Number(document.getElementById('priceCatalogLimit')?.value||40);
  let results=[];
  for(const item of imp.items){
    const price=effectiveCatalogPrice(item);
    if(brandValue){if(brandPrivate&&!isRamiPrivateLabel(item))continue;if(!brandPrivate&&!normalizeCatalogText(catalogBrand(item)).includes(brandNorm))continue}
    const data=catalogSearchData(item);if(excludeTokens.some(t=>data.nameTokens.includes(t)||data.brandTokens.includes(t)||data.descriptionTokens.includes(t)))continue;
    const score=scoreCatalogItem(item,query);if(score===-Infinity)continue;results.push({item,score,unitPrice:comparableUnitPrice(item).value})
  }
  const nameCmp=(a,b)=>String(a.item.name).localeCompare(String(b.item.name),'he');
  if(sort==='price-asc')results.sort((a,b)=>effectiveCatalogPrice(a.item)-effectiveCatalogPrice(b.item)||b.score-a.score||nameCmp(a,b));
  else if(sort==='price-desc')results.sort((a,b)=>effectiveCatalogPrice(b.item)-effectiveCatalogPrice(a.item)||b.score-a.score||nameCmp(a,b));
  else if(sort==='unit-asc')results.sort((a,b)=>a.unitPrice-b.unitPrice||effectiveCatalogPrice(a.item)-effectiveCatalogPrice(b.item)||nameCmp(a,b));
  else if(sort==='unit-desc')results.sort((a,b)=>(Number.isFinite(b.unitPrice)?b.unitPrice:-1)-(Number.isFinite(a.unitPrice)?a.unitPrice:-1)||nameCmp(a,b));
  else if(sort==='name')results.sort(nameCmp);
  else results.sort((a,b)=>b.score-a.score||effectiveCatalogPrice(a.item)-effectiveCatalogPrice(b.item)||nameCmp(a,b));
  const total=results.length,rows=results.slice(0,limit);
  box.innerHTML=`<div class="catalog-result-summary"><strong>${total.toLocaleString('he-IL')} תוצאות</strong>${total>limit?`<span>מוצגות ${limit.toLocaleString('he-IL')} הראשונות</span>`:''}${query.privateBrand||brandPrivate?'<span class="badge gold">מותג פרטי רמי לוי</span>':''}</div>`+(rows.length?`<div class="table-wrap"><table><thead><tr><th>מוצר ומותג</th><th>ברקוד</th><th>אריזה</th><th>מחיר אריזה</th><th>מחיר השוואתי</th><th></th></tr></thead><tbody>${rows.map(({item:i})=>{const pack=effectiveCatalogPack(i),brand=catalogBrand(i),unitPrice=comparableUnitPrice(i);return`<tr><td><strong>${esc(i.name)}</strong><div class="muted">${esc(brand)}</div>${isRamiPrivateLabel(i)?'<span class="badge gold">מותג פרטי</span>':''}</td><td dir="ltr">${esc(i.barcode)}</td><td>${showQty(pack.qty,pack.unit)}</td><td class="money">${money(effectiveCatalogPrice(i))}${i.salePrice?`<div class="muted"><s>${money(i.price)}</s></div>`:''}</td><td>${unitPrice.label}</td><td><button class="btn small secondary" onclick="App.linkCatalogProduct('${esc(i.barcode)}')">קישור לרכיב</button></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">לא נמצאו מוצרים. נסי מילה קצרה יותר, מותג אחר או ניקוי של מילות ההחרגה.</div>')
}
function linkCatalogProduct(barcode){const imp=currentPriceImport(),item=imp?.items.find(i=>i.barcode===barcode);if(!item)return;const pack=effectiveCatalogPack(item),suggestions=[...new Set(state.recipes.flatMap(r=>expandedIngredients(r).map(i=>i.name)))].sort((a,b)=>a.localeCompare(b,'he'));modal('קישור מוצר למחיר ספק',`<form id="linkProductForm"><div class="notice"><strong>${esc(item.name)}</strong><br>${esc(catalogBrand(item))} · ${showQty(pack.qty,pack.unit)} · ${money(effectiveCatalogPrice(item))} · ברקוד ${esc(item.barcode)}</div><div class="form-grid" style="margin-top:12px"><div class="field full"><label>שם הרכיב במתכונים</label><input name="ingredient" list="ingredientNames" required value="${esc(suggestions.find(x=>cleanIngredientName(item.name).includes(cleanIngredientName(x)))||'')}"><datalist id="ingredientNames">${suggestions.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field"><label>כמות בחבילה</label><input name="packQty" type="number" step=".01" value="${pack.qty}"></div><div class="field"><label>יחידה</label><select name="unit">${UNITS.map(u=>`<option ${u===pack.unit?'selected':''}>${u}</option>`).join('')}</select></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה במחירי רמי לוי</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('linkProductForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);let supplier=state.suppliers.find(s=>s.source==='rami-levy'&&s.storeId===imp.storeId);if(!supplier){supplier={id:id('sup'),name:`רמי לוי — ${imp.branchName}`,address:imp.address,distanceKm:0,deliveryCost:0,notes:`מחירים שיובאו מקובץ שקיפות מחירים, סניף ${imp.storeId}.`,source:'rami-levy',storeId:imp.storeId,prices:[]};state.suppliers.push(supplier)}const ingredient=f.get('ingredient'),existing=supplier.prices.find(p=>cleanIngredientName(p.ingredient)===cleanIngredientName(ingredient));const price={ingredient,packQty:Number(f.get('packQty')||pack.qty),unit:f.get('unit'),packPrice:effectiveCatalogPrice(item),barcode:item.barcode,productName:item.name,brand:catalogBrand(item),updatedAt:item.updatedAt||imp.importedAt};if(existing)Object.assign(existing,price);else supplier.prices.push(price);await persist();close();render()}}

function renderSuppliers(){const opts=supplierOptions(),imp=currentPriceImport();document.getElementById('view-suppliers').innerHTML=`<div class="grid two"><div class="card"><div class="section-head"><div><h2>ספקים וחנויות</h2><div class="hint">מחיר, מרחק ומשלוח לחישוב עלות אמיתית.</div></div><button class="btn secondary" onclick="App.newSupplier()">+ ספק</button></div>${state.suppliers.length?`<div class="list">${state.suppliers.map(s=>`<div class="list-item"><div class="item-row"><div><div class="title">${esc(s.name)}</div><div class="meta">${fmt(s.distanceKm)} ק"מ · משלוח ${money(s.deliveryCost)} · ${(s.prices||[]).length} מחירים</div></div><div class="actions"><button class="btn small ghost" onclick="App.editSupplier('${s.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteSupplier('${s.id}')">מחיקה</button></div></div></div>`).join('')}</div>`:'<div class="empty">אין ספקים</div>'}</div><div class="card"><h2>השוואת סל נוכחי</h2>${opts.length?`<div class="table-wrap"><table><thead><tr><th>ספק</th><th>כיסוי</th><th>פריטים</th><th>משלוח</th><th>נסיעה</th><th>סה"כ</th></tr></thead><tbody>${opts.map(o=>`<tr><td>${esc(o.supplier.name)}</td><td>${o.covered}</td><td>${money(o.itemsCost)}</td><td>${money(o.delivery)}</td><td>${money(o.distanceCost)}</td><td class="money">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">אין מספיק נתונים</div>'}</div></div><div class="card" style="margin-top:16px"><div class="section-head"><div><h2>ייבוא מחירי רמי לוי</h2><div class="hint">מעלה קובץ Price מסוג GZ או XML ממערכת שקיפות המחירים.</div></div><div class="actions"><button class="btn secondary" onclick="document.getElementById('ramiImportFile').click()">ייבוא קובץ</button>${imp?`<button class="btn small danger" onclick="App.deletePriceImport('${imp.id}')">מחיקת הייבוא</button>`:''}</div></div>${renderPriceCatalog()}</div>`;setTimeout(filterPriceCatalog,0)}
function priceRow(p={}){const current=String(p.ingredient||'').trim(),unit=p.unit||'ק"ג',packQty=normalizedRecipeUnit(unit)==='גרם'?Math.round(Number(p.packQty||0)):Number(p.packQty||0);return`<div class="repeat-row price-row" data-price-id="${esc(p.id||id('price'))}"><div class="field"><label>מוצר / רכיב</label><input class="sp-i" list="supplierIngredientCatalog" value="${esc(current)}" placeholder="בחירה מהרשימה או הקלדה חופשית"></div><div class="field"><label>כמות בחבילה</label><input class="sp-q" type="number" min="0" step="${normalizedRecipeUnit(unit)==='גרם'?'1':'.01'}" value="${packQty}"></div><div class="field"><label>יחידה</label><select class="sp-u" onchange="App.syncSupplierPriceUnit(this)">${UNITS.map(u=>`<option ${unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>מחיר חבילה</label><input class="sp-p" type="number" min="0" step=".01" value="${p.packPrice||0}"></div><button type="button" class="btn small danger" onclick="this.closest('.price-row').remove()">הסר</button></div>`}
function syncSupplierPriceUnit(select){const row=select.closest('.price-row'),input=row?.querySelector('.sp-q');if(!input)return;const grams=normalizedRecipeUnit(select.value)==='גרם';input.step=grams?'1':'.01';if(grams)input.value=Math.round(Number(input.value||0))}
function supplierForm(s={id:'',name:'',address:'',distanceKm:0,deliveryCost:0,notes:'',prices:[]}){modal(s.id?'עריכת ספק':'ספק חדש',`<form id="supForm"><input type="hidden" name="id" value="${esc(s.id)}"><div class="form-grid"><div class="field"><label>שם ספק/חנות</label><input name="name" required value="${esc(s.name)}"></div><div class="field"><label>כתובת</label><input name="address" value="${esc(s.address)}"></div><div class="field"><label>מרחק בק״מ</label><input name="distanceKm" type="number" step=".1" min="0" value="${s.distanceKm}"></div><div class="field"><label>עלות משלוח</label><input name="deliveryCost" type="number" step=".01" min="0" value="${s.deliveryCost}"></div><div class="field full"><label>מחירי מוצרים וחומרי גלם</label><div class="notice">אפשר לבחור רכיב מהמתכונים או להקליד כל מוצר אחר באופן חופשי. המערכת תנסה לקשר וריאציות של אותו מוצר בלי לבלבל בין מוצרים שונים.</div><datalist id="supplierIngredientCatalog">${recipeIngredientCatalog().map(x=>`<option value="${esc(x.name)}"></option>`).join('')}</datalist><div id="supplierPrices">${(s.prices.length?s.prices:[{ingredient:'',packQty:1,unit:'ק"ג',packPrice:0}]).map(priceRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addPrice()">+ מחיר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(s.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('supForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.suppliers.find(x=>x.id===f.get('id')),prices=[...document.querySelectorAll('.price-row')].map(r=>({id:r.dataset.priceId||id('price'),ingredient:r.querySelector('.sp-i').value.trim(),packQty:normalizedRecipeUnit(r.querySelector('.sp-u').value)==='גרם'?Math.round(Number(r.querySelector('.sp-q').value||0)):Number(r.querySelector('.sp-q').value||0),unit:r.querySelector('.sp-u').value,packPrice:Number(r.querySelector('.sp-p').value||0),updatedAt:new Date().toISOString()})).filter(x=>x.ingredient&&x.packQty),obj={id:f.get('id')||id('sup'),name:f.get('name'),address:f.get('address'),distanceKm:Number(f.get('distanceKm')||0),deliveryCost:Number(f.get('deliveryCost')||0),notes:f.get('notes'),prices};if(ex)Object.assign(ex,obj);else state.suppliers.push(obj);await persist();close();render()}}


/* חשבוניות ומסמכי B2B */
function invoiceNumberPreview(){const y=new Date().getFullYear();return`BW-${y}-${String(Math.max(1,Number(state.invoiceSequence||1))).padStart(4,'0')}`}
function invoiceTotals(inv){const subtotal=(inv.items||[]).reduce((s,i)=>s+Number(i.qty||0)*Number(i.unitPrice||0),0),vatRate=inv.vatEnabled===false?0:Math.max(0,Number(inv.vatRate||0)),vat=subtotal*vatRate/100;return{subtotal,vat,total:subtotal+vat,vatRate}}
function invoiceItemRow(i={description:'',qty:1,unit:'שקית',unitPrice:0}){return`<div class="invoice-item-row"><div class="field"><label>תיאור</label><input class="ii-d" required value="${esc(i.description)}"></div><div class="field"><label>כמות</label><input class="ii-q" type="number" min="0" step=".01" value="${Number(i.qty||0)}"></div><div class="field"><label>יחידה</label><input class="ii-u" value="${esc(i.unit||'שקית')}"></div><div class="field"><label>מחיר ליחידה</label><input class="ii-p" type="number" min="0" step=".01" value="${Number(i.unitPrice||0)}"></div><button type="button" class="btn small danger" onclick="this.closest('.invoice-item-row').remove();App.updateInvoicePreview()">הסר</button></div>`}
function readInvoiceItems(){return[...document.querySelectorAll('.invoice-item-row')].map(r=>({description:r.querySelector('.ii-d').value.trim(),qty:Number(r.querySelector('.ii-q').value||0),unit:r.querySelector('.ii-u').value.trim()||'יחידה',unitPrice:Number(r.querySelector('.ii-p').value||0)})).filter(i=>i.description&&i.qty>0)}
function updateInvoicePreview(){const form=document.getElementById('invoiceForm'),box=document.getElementById('invoiceTotalPreview');if(!form||!box)return;const inv={items:readInvoiceItems(),vatEnabled:form.elements.vatEnabled.value==='true',vatRate:Number(form.elements.vatRate.value||0)},t=invoiceTotals(inv);box.innerHTML=`סכום לפני מע״מ: <strong>${money(t.subtotal)}</strong> · מע״מ ${fmt(t.vatRate,1)}%: <strong>${money(t.vat)}</strong> · סה״כ לתשלום: <strong>${money(t.total)}</strong>`}
function invoiceForm(raw={}){
  const profile={...state.invoiceProfile,...(raw.seller||{})},today=dayKey(new Date()),inv={id:'',number:invoiceNumberPreview(),documentType:'חשבונית עסקה / פרופורמה',status:'טיוטה',issueDate:today,dueDate:dayKey(addDays(new Date(),30)),clientName:'',clientBusinessId:'',clientContact:'',clientEmail:'',clientPhone:'',clientAddress:'',orderId:'',vatEnabled:true,vatRate:Number(profile.vatRate||18),allocationNumber:'',paymentTerms:profile.paymentTerms||'שוטף + 30',notes:'',items:[],seller:profile,...raw};
  modal(inv.id?'עריכת מסמך B2B':'מסמך B2B חדש',`<form id="invoiceForm"><input type="hidden" name="id" value="${esc(inv.id)}"><input type="hidden" name="orderId" value="${esc(inv.orderId||'')}"><div class="notice warning"><strong>חשוב:</strong> המערכת מעצבת ושומרת דרישת תשלום, פרופורמה או הצעת מחיר. היא אינה תוכנת הנהלת חשבונות רשומה ואינה מפיקה חשבונית מס או קבלה רשמית.</div><div class="invoice-form-section"><h3>פרטי המסמך</h3><div class="form-grid three"><div class="field"><label>סוג מסמך</label><select name="documentType">${INVOICE_TYPES.map(x=>`<option ${inv.documentType===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>מספר מסמך פנימי</label><input name="number" required value="${esc(inv.number)}"></div><div class="field"><label>סטטוס</label><select name="status">${INVOICE_STATUSES.map(x=>`<option ${inv.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>תאריך הפקה</label><input name="issueDate" type="date" required value="${esc(inv.issueDate)}"></div><div class="field"><label>מועד תשלום</label><input name="dueDate" type="date" value="${esc(inv.dueDate)}"></div><div class="field"><label>מספר הקצאה / אישור (אופציונלי)</label><input name="allocationNumber" value="${esc(inv.allocationNumber||'')}"></div></div></div><div class="invoice-form-section"><h3>העסק שלך — נשמר אוטומטית למסמך הבא</h3><div class="form-grid three"><div class="field"><label>שם משפטי / שם העסק</label><input name="legalName" required value="${esc(profile.legalName||state.settings.businessName)}"></div><div class="field"><label>ח.פ / ע.מ</label><input name="businessId" value="${esc(profile.businessId)}"></div><div class="field"><label>טלפון</label><input name="sellerPhone" value="${esc(profile.phone)}"></div><div class="field"><label>אימייל</label><input name="sellerEmail" type="email" value="${esc(profile.email)}"></div><div class="field full"><label>כתובת</label><input name="sellerAddress" value="${esc(profile.address)}"></div></div></div><div class="invoice-form-section"><h3>פרטי העסק הלקוח</h3><div class="form-grid three"><div class="field"><label>שם העסק</label><input name="clientName" required value="${esc(inv.clientName)}"></div><div class="field"><label>ח.פ / ע.מ לקוח</label><input name="clientBusinessId" value="${esc(inv.clientBusinessId)}"></div><div class="field"><label>אשת/איש קשר</label><input name="clientContact" value="${esc(inv.clientContact)}"></div><div class="field"><label>אימייל</label><input name="clientEmail" type="email" value="${esc(inv.clientEmail)}"></div><div class="field"><label>טלפון</label><input name="clientPhone" value="${esc(inv.clientPhone)}"></div><div class="field"><label>כתובת</label><input name="clientAddress" value="${esc(inv.clientAddress)}"></div></div></div><div class="invoice-form-section"><div class="section-head"><h3>פריטים</h3><button type="button" class="btn small secondary" onclick="App.addInvoiceItem()">+ שורה</button></div><div id="invoiceItems">${(inv.items.length?inv.items:[{description:'',qty:1,unit:'שקית',unitPrice:0}]).map(invoiceItemRow).join('')}</div><div class="form-grid three" style="margin-top:12px"><div class="field"><label>הוספת מע״מ</label><select name="vatEnabled"><option value="true" ${inv.vatEnabled!==false?'selected':''}>כן</option><option value="false" ${inv.vatEnabled===false?'selected':''}>לא</option></select></div><div class="field"><label>שיעור מע״מ</label><input name="vatRate" type="number" min="0" max="100" step=".1" value="${Number(inv.vatRate||18)}"></div><div class="field"><label>תנאי תשלום</label><input name="paymentTerms" value="${esc(inv.paymentTerms||profile.paymentTerms)}"></div></div><div id="invoiceTotalPreview" class="notice success" style="margin-top:12px"></div></div><div class="invoice-form-section"><h3>פרטי תשלום והערות</h3><div class="form-grid three"><div class="field"><label>בנק</label><input name="bankName" value="${esc(profile.bankName)}"></div><div class="field"><label>סניף</label><input name="bankBranch" value="${esc(profile.bankBranch)}"></div><div class="field"><label>חשבון</label><input name="bankAccount" value="${esc(profile.bankAccount)}"></div><div class="field full"><label>הערות ללקוח</label><textarea name="notes">${esc(inv.notes)}</textarea></div></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  const form=document.getElementById('invoiceForm');form.addEventListener('input',updateInvoicePreview);form.addEventListener('change',updateInvoicePreview);updateInvoicePreview();form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),existing=state.invoices.find(x=>x.id===f.get('id')),seller={legalName:f.get('legalName'),businessId:f.get('businessId'),address:f.get('sellerAddress'),email:f.get('sellerEmail'),phone:f.get('sellerPhone'),bankName:f.get('bankName'),bankBranch:f.get('bankBranch'),bankAccount:f.get('bankAccount'),paymentTerms:f.get('paymentTerms'),vatRate:Number(f.get('vatRate')||0)},obj={id:f.get('id')||id('inv'),number:f.get('number'),documentType:f.get('documentType'),status:f.get('status'),issueDate:f.get('issueDate'),dueDate:f.get('dueDate'),clientName:f.get('clientName'),clientBusinessId:f.get('clientBusinessId'),clientContact:f.get('clientContact'),clientEmail:f.get('clientEmail'),clientPhone:f.get('clientPhone'),clientAddress:f.get('clientAddress'),orderId:f.get('orderId'),vatEnabled:f.get('vatEnabled')==='true',vatRate:Number(f.get('vatRate')||0),allocationNumber:f.get('allocationNumber'),paymentTerms:f.get('paymentTerms'),notes:f.get('notes'),items:readInvoiceItems(),seller,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};state.invoiceProfile={...state.invoiceProfile,...seller};if(existing)Object.assign(existing,obj);else{state.invoices.push(obj);state.invoiceSequence=Math.max(1,Number(state.invoiceSequence||1))+1}await persist();close();render()}
}
async function repeatOrderNextWeek(orderId){const source=state.orders.find(x=>x.id===orderId);if(!source)return;const nextDue=addDays(new Date(source.dueAt),7);const exists=state.orders.some(o=>o.id!==source.id&&o.seriesId&&source.seriesId&&o.seriesId===source.seriesId&&Math.abs(new Date(o.dueAt)-nextDue)<60000);if(exists&&!confirm('כבר קיימת הזמנה בסדרה הזאת לשבוע הבא. ליצור עותק נוסף?'))return;const copy={...JSON.parse(JSON.stringify(source)),id:id('ord'),dueAt:new Date(nextDue).toISOString().slice(0,16),status:'חדשה',paid:false,createdAt:new Date().toISOString(),recurringWeekly:true,seriesId:source.seriesId||id('series')};source.recurringWeekly=true;source.seriesId=copy.seriesId;state.orders.push(copy);await persist();render();orderForm(copy)}

function invoiceFromOrder(orderId){const o=state.orders.find(x=>x.id===orderId);if(!o)return;invoiceForm({orderId:o.id,clientName:o.customer||'',clientContact:o.customer||'',clientPhone:o.phone||'',dueDate:o.dueAt?dayKey(o.dueAt):dayKey(addDays(new Date(),30)),items:(o.items||[]).map(i=>{const r=recipe(i.recipeId);return{description:r?.name||'מוצר',qty:Number(i.qty||0),unit:'שקית',unitPrice:Number(r?.salePrice||0)}}),notes:o.notes||''})}
function renderInvoices(){const rows=state.invoices.slice().sort((a,b)=>String(b.issueDate||b.createdAt).localeCompare(String(a.issueDate||a.createdAt)));document.getElementById('view-invoices').innerHTML=`<div class="card"><div class="section-head"><div><h2>חשבוניות ומסמכי B2B</h2><div class="hint">יצירת דרישות תשלום, פרופורמה והצעות מחיר מעוצבות, עם שמירה בענן והדפסה ל־PDF.</div></div><button class="btn secondary" onclick="App.newInvoice()">+ מסמך חדש</button></div><div class="notice warning" style="margin-bottom:14px">המסמכים כאן הם מסמכים מסחריים/טיוטות. להפקת חשבונית מס או קבלה רשמית יש להשתמש במערכת הנהלת חשבונות רשומה ובהתאם לדרישות רשות המסים.</div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>מספר</th><th>סוג</th><th>עסק לקוח</th><th>תאריך</th><th>מועד תשלום</th><th>סטטוס</th><th>סה״כ</th><th></th></tr></thead><tbody>${rows.map(inv=>{const t=invoiceTotals(inv);return`<tr><td><strong>${esc(inv.number)}</strong></td><td>${esc(inv.documentType)}</td><td><strong>${esc(inv.clientName)}</strong><div class="muted">${esc(inv.clientBusinessId||inv.clientEmail||'')}</div></td><td>${dateText(inv.issueDate)}</td><td>${dateText(inv.dueDate)}</td><td><span class="badge ${inv.status==='שולמה'?'green':inv.status==='בוטלה'?'red':'gold'}">${esc(inv.status)}</span></td><td class="money">${money(t.total)}</td><td><div class="actions"><button class="btn small secondary" onclick="App.printInvoice('${inv.id}')">PDF / הדפסה</button><button class="btn small ghost" onclick="App.editInvoice('${inv.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteInvoice('${inv.id}')">מחיקה</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">עדיין אין מסמכי B2B. אפשר ליצור מסמך ידני או לפתוח חשבונית מתוך הזמנה.</div>'}</div>`}
function invoiceDocumentHtml(inv){const t=invoiceTotals(inv),seller=inv.seller||state.invoiceProfile,rows=(inv.items||[]).map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.description)}</td><td>${fmt(i.qty)}</td><td>${esc(i.unit)}</td><td>${money(i.unitPrice)}</td><td>${money(Number(i.qty||0)*Number(i.unitPrice||0))}</td></tr>`).join('');return`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.documentType)} ${esc(inv.number)}</title><style>body{font-family:Tahoma,Arial,sans-serif;color:#2d1b17;margin:0;background:#f5efe7}.sheet{width:190mm;min-height:267mm;margin:10mm auto;background:white;padding:18mm;box-sizing:border-box}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #2b1712;padding-bottom:18px}.brand h1{margin:0;font-size:28px}.doc{text-align:left}.doc h2{margin:0 0 8px;font-size:24px}.meta{color:#74645e;font-size:13px;line-height:1.7}.parties{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.box{border:1px solid #ddd0c2;border-radius:12px;padding:14px}.box h3{margin:0 0 8px;font-size:14px;color:#8b5f3c}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px;border-bottom:1px solid #e7ddd3;text-align:right}th{background:#f6eee5;font-size:12px}.totals{margin-right:auto;width:320px}.line{display:flex;justify-content:space-between;padding:7px 0}.total{font-size:20px;font-weight:bold;border-top:2px solid #2b1712;margin-top:5px;padding-top:10px}.footer{margin-top:28px;border-top:1px solid #ddd0c2;padding-top:16px;line-height:1.7}.draft{margin-top:20px;padding:10px;border:1px solid #d8b06d;background:#fff8e8;border-radius:8px;font-size:12px}@media print{body{background:white}.sheet{margin:0;width:auto;min-height:auto;box-shadow:none}}</style></head><body><div class="sheet"><div class="top"><div class="brand"><h1>${esc(seller.legalName||state.settings.businessName)}</h1><div class="meta">${seller.businessId?`ח.פ / ע.מ: ${esc(seller.businessId)}<br>`:''}${esc(seller.address||'')}<br>${esc(seller.phone||'')} ${seller.email?`· ${esc(seller.email)}`:''}</div></div><div class="doc"><h2>${esc(inv.documentType)}</h2><strong>${esc(inv.number)}</strong><div class="meta">תאריך: ${dateText(inv.issueDate)}<br>לתשלום עד: ${dateText(inv.dueDate)}${inv.allocationNumber?`<br>מספר הקצאה/אישור: ${esc(inv.allocationNumber)}`:''}</div></div></div><div class="parties"><div class="box"><h3>מאת</h3><strong>${esc(seller.legalName||state.settings.businessName)}</strong><div class="meta">${esc(seller.address||'')}<br>${esc(seller.phone||'')} · ${esc(seller.email||'')}</div></div><div class="box"><h3>לכבוד</h3><strong>${esc(inv.clientName)}</strong><div class="meta">${inv.clientBusinessId?`ח.פ / ע.מ: ${esc(inv.clientBusinessId)}<br>`:''}${esc(inv.clientContact||'')}<br>${esc(inv.clientAddress||'')}<br>${esc(inv.clientPhone||'')} ${inv.clientEmail?`· ${esc(inv.clientEmail)}`:''}</div></div></div><table><thead><tr><th>#</th><th>תיאור</th><th>כמות</th><th>יחידה</th><th>מחיר יחידה</th><th>סה״כ</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="line"><span>סכום לפני מע״מ</span><strong>${money(t.subtotal)}</strong></div>${inv.vatEnabled!==false?`<div class="line"><span>מע״מ ${fmt(t.vatRate,1)}%</span><strong>${money(t.vat)}</strong></div>`:''}<div class="line total"><span>סה״כ לתשלום</span><span>${money(t.total)}</span></div></div><div class="footer"><strong>תנאי תשלום:</strong> ${esc(inv.paymentTerms||'')}<br>${seller.bankName||seller.bankBranch||seller.bankAccount?`<strong>פרטי העברה:</strong> ${esc([seller.bankName,seller.bankBranch&&'סניף '+seller.bankBranch,seller.bankAccount&&'חשבון '+seller.bankAccount].filter(Boolean).join(' · '))}<br>`:''}${inv.notes?`<strong>הערות:</strong> ${esc(inv.notes).replace(/\n/g,'<br>')}`:''}<div class="draft">מסמך מסחרי זה אינו חשבונית מס או קבלה רשמית.</div></div></div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`}
function printInvoice(id){const inv=state.invoices.find(x=>x.id===id);if(!inv)return;const w=window.open('','_blank');if(!w)return alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר.');w.document.open();w.document.write(invoiceDocumentHtml(inv));w.document.close()}
function todoSort(items){return items.slice().sort((a,b)=>Number(a.done)-Number(b.done)||({'גבוהה':0,'רגילה':1,'נמוכה':2}[a.priority]??1)-({'גבוהה':0,'רגילה':1,'נמוכה':2}[b.priority]??1)||(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')||String(a.createdAt||'').localeCompare(String(b.createdAt||'')))}
function todoBadge(priority){return priority==='גבוהה'?'red':priority==='נמוכה'?'blue':'gold'}
function renderTodo(){
  const personal=todoSort(state.todoItems||[]).map(item=>({...item,sourceType:'personal'}));
  const orderTasks=generatedTasks().map(t=>({id:`plan:${t.key}`,planKey:t.key,text:t.text,done:!!t.done,priority:t.type==='delivery'?'גבוהה':'רגילה',dueDate:t.date,notes:[t.recipe,t.customer,t.time].filter(Boolean).join(' · '),sourceType:'plan'}));
  const items=[...orderTasks,...personal].sort((a,b)=>Number(a.done)-Number(b.done)||(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31'));
  const open=items.filter(x=>!x.done),done=items.filter(x=>x.done),today=dayKey(new Date());
  const itemHtml=item=>`<div class="todo-item ${item.done?'done':''} ${item.sourceType==='plan'?'from-order':''}"><label class="todo-check"><input type="checkbox" ${item.done?'checked':''} onchange="${item.sourceType==='plan'?`App.toggleTask('${esc(item.planKey)}')`:`App.toggleTodo('${item.id}')`}"><span></span></label><button class="todo-main" onclick="${item.sourceType==='plan'?`App.editPlanTask('${esc(item.planKey)}')`:`App.editTodo('${item.id}')`}"><strong>${esc(item.text)}</strong><div class="meta">${item.dueDate?`לביצוע עד ${dateText(item.dueDate)}`:'ללא תאריך'}${item.notes?` · ${esc(item.notes)}`:''}</div></button><span class="badge ${item.sourceType==='plan'?'green':todoBadge(item.priority)}">${item.sourceType==='plan'?'מהזמנה':esc(item.priority)}</span>${item.sourceType==='personal'?`<button class="icon-btn" aria-label="מחיקת משימה" onclick="App.deleteTodo('${item.id}')">✕</button>`:''}</div>`;
  document.getElementById('view-todo').innerHTML=`<div class="section-head"><div><h2>To Do List</h2><div class="hint">משימות שהגדרת במתכונים מופיעות כאן ובתכנון הלו״ז כאותה משימה מסונכרנת.</div></div><button class="btn secondary" onclick="App.newTodo()">+ משימה אישית</button></div><div class="grid three todo-summary"><div class="metric"><div class="label">משימות פתוחות</div><div class="value">${open.length}</div></div><div class="metric"><div class="label">להיום</div><div class="value">${open.filter(x=>x.dueDate===today).length}</div></div><div class="metric"><div class="label">הושלמו</div><div class="value">${done.length}</div></div></div><div class="card" style="margin-top:16px"><div class="section-head"><h2>לביצוע</h2></div><div class="todo-list">${open.map(itemHtml).join('')||'<div class="empty">אין משימות פתוחות 🎉</div>'}</div>${done.length?`<details class="todo-completed"><summary>הושלמו (${done.length})</summary><div class="todo-list">${done.map(itemHtml).join('')}</div></details>`:''}</div>`;
}
function todoForm(item={}){
  modal(item.id?'עריכת משימה':'משימה חדשה',`<form id="todoForm"><div class="form-grid"><div class="field full"><label>מה צריך לעשות?</label><input name="text" required maxlength="180" value="${esc(item.text||'')}" placeholder="לדוגמה: להזמין שקיות אריזה"></div><div class="field"><label>עדיפות</label><select name="priority">${['נמוכה','רגילה','גבוהה'].map(v=>`<option ${v===(item.priority||'רגילה')?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>תאריך יעד</label><input name="dueDate" type="date" value="${esc(item.dueDate||'')}"><div class="hint">משימה עם תאריך יעד תופיע אוטומטית גם בתכנון השבועי.</div></div><div class="field full"><label>הערות</label><textarea name="notes" rows="3" placeholder="פרטים נוספים, טלפון, כמות או כל דבר שחשוב לזכור">${esc(item.notes||'')}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  document.getElementById('todoForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),text=String(f.get('text')||'').trim();if(!text)return;const next={id:item.id||id('todo'),text,priority:String(f.get('priority')||'רגילה'),dueDate:String(f.get('dueDate')||''),notes:String(f.get('notes')||'').trim(),done:!!item.done,plannerTime:String(item.plannerTime||''),plannerDuration:Math.max(5,Number(item.plannerDuration||30)),plannerPassiveMin:Math.max(0,Number(item.plannerPassiveMin||0)),plannerType:TASK_TYPES[item.plannerType]?item.plannerType:'prep',createdAt:item.createdAt||new Date().toISOString()};if(item.id)state.todoItems=state.todoItems.map(x=>x.id===item.id?next:x);else state.todoItems.push(next);await persist();close();render()};
}
function renderReports(){
  const os=state.orders.filter(o=>o.status!=='בוטלה'),events=(state.salesEvents||[]).filter(e=>e.status!=='בוטל'),orderRev=os.reduce((s,o)=>s+revenue(o),0),eventRev=events.reduce((s,e)=>s+salesEventActualRevenue(e),0),rev=orderRev+eventRev;let cost=0,by={};
  os.forEach(o=>(o.items||[]).forEach(i=>{const r=recipe(i.recipeId);if(r)cost+=recipeCost(r).perUnit*Number(i.qty);by[i.recipeId]=(by[i.recipeId]||0)+Number(i.qty)}));
  events.forEach(e=>(e.items||[]).forEach(i=>{const r=recipe(i.recipeId);if(!r)return;const produced=Number(i.preparedQty||0);cost+=recipeCost(r).perUnit*produced;by[i.recipeId]=(by[i.recipeId]||0)+Number(i.soldQty||0)}));
  const profit=rev-cost;document.getElementById('view-reports').innerHTML=`<div class="grid four"><div class="metric"><div class="label">הכנסות</div><div class="value">${money(rev)}</div><div class="meta">הזמנות ${money(orderRev)} · אירועי מכירה ${money(eventRev)}</div></div><div class="metric"><div class="label">עלות חומרי גלם</div><div class="value">${money(cost)}</div></div><div class="metric"><div class="label">רווח גולמי</div><div class="value">${money(profit)}</div></div><div class="metric"><div class="label">שיעור רווח</div><div class="value">${rev?fmt(profit/rev*100,1):0}%</div></div></div><div class="grid two" style="margin-top:14px"><div class="card"><h2>מוצרים שנמכרו</h2>${Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([rid,q])=>{const r=recipe(rid);return`<div class="kpi-line"><span>${esc(r?.name||'מתכון')}</span><strong>${fmt(q,0)} ${esc(salesUnitLabel(r))}</strong></div>`}).join('')||'<div class="empty">אין נתונים</div>'}</div><div class="card"><h2>רווחיות מתכונים</h2>${state.recipes.map(r=>{const c=recipeCost(r);return`<div class="kpi-line"><span>${esc(r.name)}</span><strong>${money(Number(r.salePrice)-c.perUnit)} ל${esc(salesUnitSingular(salesUnitLabel(r)))}</strong></div>`}).join('')||'<div class="empty">אין מתכונים</div>'}</div></div><div class="card" style="margin-top:14px"><div class="notice">זהו אומדן של חומרי גלם ופחת שהוגדר במתכונים. שכר עבודה, עלות אריזה, שכירות, מסים, עמלות והוצאות קבועות אינם נכללים.</div></div>`
}
function assistantContext(){
  const tasks=generatedTasks().filter(t=>!t.done).slice(0,80).map(t=>({key:t.key,text:t.text,date:t.date,time:t.time,duration:t.duration,recipe:t.recipe,customer:t.customer,type:t.type}));
  return {
    now:new Date().toISOString(),
    business:{name:state.settings.businessName,currency:state.settings.currency,workStart:state.settings.workStart,workEnd:state.settings.workEnd,planningBufferMin:state.settings.planningBufferMin,weeklyAvailability:state.settings.weeklyAvailability},
    orders:state.orders.slice(-40).map(o=>({id:o.id,customer:o.customer,dueAt:o.dueAt,status:o.status,delivery:o.delivery,items:(o.items||[]).map(i=>({recipeId:i.recipeId,recipe:recipe(i.recipeId)?.name||'',qty:Number(i.qty||0),unitPrice:Number(i.unitPrice||0)}))})),
    recipes:state.recipes.slice(0,80).map(r=>({id:r.id,name:r.name,packageWeight:r.packageWeight,yieldUnits:r.yieldUnits,finalWeight:recipeWeight(r).finalWeight,warnings:r.warnings,subRecipes:(r.subRecipes||[]).map(x=>({id:x.id,name:x.name,usedQtyGrams:x.usedQtyGrams})),productionTasks:(r.productionTasks||[]).map(x=>({title:x.title,type:x.type,activeMin:x.activeMin,daysBefore:x.daysBefore,preferredTime:x.preferredTime}))})),
    inventory:state.inventory.slice(0,120).map(i=>({id:i.id,name:i.name,total:inventoryTotal(i),unit:inventoryUnit(i),supplier:inventorySupplier(i)?.name||''})),
    shopping:shopping().slice(0,100).map(i=>({name:i.name,need:i.need,unit:i.unit})),
    todo:state.todoItems.filter(x=>!x.done).slice(0,80).map(x=>({id:x.id,text:x.text,priority:x.priority,dueDate:x.dueDate,notes:x.notes})),
    tasks
  };
}
function assistantQuickQuestion(text){const input=document.getElementById('assistantInput');if(input){input.value=text;sendAssistantMessage()}}
function assistantMessageHtml(m){
  const action=m.action&&m.role==='assistant'?`<div class="ai-action-card"><strong>${esc(m.action.label||'פעולה מוצעת')}</strong>${m.action.summary?`<div class="meta">${esc(m.action.summary)}</div>`:''}<div class="actions"><button class="btn small" onclick="App.confirmAIAction('${esc(m.id)}')">אישור וביצוע</button><button class="btn small ghost" onclick="App.dismissAIAction('${esc(m.id)}')">ביטול</button></div></div>`:'';
  return `<div class="ai-message ${m.role}"><div class="ai-bubble">${esc(m.text).replace(/\n/g,'<br>')}</div>${action}</div>`;
}
function renderAssistant(){
  const connected=!!(cloud.client&&cloud.user),messages=state.aiMessages||[];
  document.getElementById('view-assistant').innerHTML=`<div class="ai-shell"><div class="card ai-head"><div><div class="recipe-card-kicker">Bakery Workspace Assistant</div><h2>עוזרת AI</h2><p class="muted">שאלי על הזמנות, מתכונים, מלאי, קניות, תכנון שבועי, חשבוניות וניסוח הודעות.</p></div><div class="badge ${connected?'green':'red'}">${connected?'מחוברת לענן':'נדרש חיבור לענן'}</div></div>
  ${connected?'':`<div class="notice warning">כדי להשתמש בעוזרת, התחברי ל־Supabase בהגדרות והעלי את פונקציית <strong>bakery-assistant</strong>.</div>`}
  <div class="ai-quick-actions"><button onclick="App.askAI('מה אני צריכה להכין היום?')">מה להכין היום?</button><button onclick="App.askAI('האם אספיק את ההזמנות הקרובות בזמן?')">האם אספיק בזמן?</button><button onclick="App.askAI('אילו חומרי גלם חסרים לי?')">מה חסר במלאי?</button><button onclick="App.askAI('סדרי לי מחדש את היום לפי הזמינות שלי')">סידור היום</button></div>
  <div id="assistantMessages" class="ai-messages">${messages.length?messages.map(assistantMessageHtml).join(''):'<div class="empty">עדיין אין שיחה. אפשר להתחיל מאחת השאלות למעלה.</div>'}</div>
  <form id="assistantForm" class="ai-composer"><textarea id="assistantInput" placeholder="כתבי כאן שאלה…" ${connected?'':'disabled'}></textarea><button class="btn" ${connected?'':'disabled'}>שליחה</button></form>
  <div class="hint">העוזרת לא משנה נתונים בלי שתאשרי פעולה. תשובות המבוססות על נתונים חסרים יסומנו כהערכה.</div></div>`;
  const form=document.getElementById('assistantForm');if(form)form.onsubmit=e=>{e.preventDefault();sendAssistantMessage()};
  requestAnimationFrame(()=>{const box=document.getElementById('assistantMessages');if(box)box.scrollTop=box.scrollHeight});
}
async function sendAssistantMessage(){
  const input=document.getElementById('assistantInput'),text=String(input?.value||'').trim();if(!text||!cloud.client||!cloud.user)return;
  input.value='';state.aiMessages.push({id:id('aimsg'),role:'user',text,createdAt:new Date().toISOString()});state.aiMessages=state.aiMessages.slice(-40);await persist(false);renderAssistant();
  const box=document.getElementById('assistantMessages');if(box)box.insertAdjacentHTML('beforeend','<div class="ai-message assistant"><div class="ai-bubble ai-thinking">חושבת…</div></div>');
  try{
    const history=state.aiMessages.slice(-12).map(m=>({role:m.role,content:m.text}));
    const {data,error}=await cloud.client.functions.invoke('bakery-assistant',{body:{message:text,history,context:assistantContext()}});if(error)throw error;
    const reply=String(data?.reply||data?.text||'לא התקבלה תשובה.'),action=data?.action&&typeof data.action==='object'?data.action:null;
    state.aiMessages.push({id:id('aimsg'),role:'assistant',text:reply,action,createdAt:new Date().toISOString()});state.aiMessages=state.aiMessages.slice(-40);await persist();renderAssistant();
  }catch(error){console.error(error);state.aiMessages.push({id:id('aimsg'),role:'assistant',text:'לא הצלחתי להתחבר לעוזרת כרגע. בדקי שפונקציית bakery-assistant הועלתה ל־Supabase ושמפתח OPENAI_API_KEY הוגדר.',createdAt:new Date().toISOString()});await persist(false);renderAssistant()}
}
async function confirmAIAction(messageId){
  const message=state.aiMessages.find(m=>m.id===messageId),a=message?.action;if(!a)return;
  try{
    if(a.type==='add_todo'){state.todoItems.push({id:id('todo'),text:String(a.text||a.label||'משימה'),priority:['נמוכה','רגילה','גבוהה'].includes(a.priority)?a.priority:'רגילה',dueDate:String(a.dueDate||''),notes:String(a.notes||''),done:false,createdAt:new Date().toISOString()})}
    else if(a.type==='add_manual_task'){state.manualTasks.push({key:id('manual'),text:String(a.text||a.label||'משימה'),date:String(a.date||dayKey(new Date())),time:String(a.time||state.settings.workStart||'08:00'),duration:Math.max(5,Number(a.duration||30)),type:TASK_TYPES[a.taskType]?a.taskType:'prep',recipe:String(a.recipe||''),customer:String(a.customer||''),recipeRuns:0,qty:0,source:'AI',manual:true})}
    else if(a.type==='reschedule_task'){const key=String(a.taskKey||''),target=generatedTasks().find(t=>t.key===key);if(!target)throw new Error('המשימה לא נמצאה');state.planOverrides[key]={...(state.planOverrides[key]||{}),date:String(a.date||target.date),time:String(a.time||target.time)};}
    else if(a.type==='navigate'){go(String(a.view||'dashboard'));}
    else throw new Error('סוג הפעולה אינו נתמך');
    message.action=null;message.text+=`\n\n✓ הפעולה בוצעה.`;await persist();render();if(currentView==='assistant')renderAssistant();
  }catch(error){alert(`לא ניתן לבצע את הפעולה: ${error.message||error}`)}
}
async function dismissAIAction(messageId){const m=state.aiMessages.find(x=>x.id===messageId);if(m){m.action=null;m.text+='\n\nהפעולה בוטלה.';await persist();renderAssistant()}}
async function clearAIChat(){if(!confirm('למחוק את היסטוריית השיחה עם העוזרת?'))return;state.aiMessages=[];await persist();renderAssistant()}

function renderSettings(){const c=getCloud()||{};document.getElementById('view-settings').innerHTML=`<div class="grid two"><div class="card"><h2>הגדרות העסק</h2><form id="settingsForm"><div class="form-grid"><div class="field"><label>שם העסק</label><input name="businessName" value="${esc(state.settings.businessName||'Bakery Workspace')}"></div><div class="field"><label>מטבע</label><input name="currency" value="${esc(state.settings.currency||'₪')}"></div><div class="field"><label>עלות נסיעה לק״מ</label><input name="distanceCostPerKm" type="number" min="0" step=".01" value="${Number(state.settings.distanceCostPerKm||0)}"></div><div class="field"><label>מספר תנורים</label><input name="ovens" type="number" min="1" step="1" value="${Number(state.settings.ovens||1)}"></div><div class="field"><label>מגשים בכל תנור</label><input name="ovenTrays" type="number" min="1" step="1" value="${Number(state.settings.ovenTrays||1)}"></div><div class="field"><label>תחילת יום עבודה</label><input name="workStart" type="time" value="${esc(state.settings.workStart||'08:00')}"></div><div class="field"><label>סיום יום עבודה</label><input name="workEnd" type="time" value="${esc(state.settings.workEnd||'18:00')}"></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירת הגדרות</button></div></form></div><div class="card"><h2>שמירה בענן</h2>${cloud.user?`<div class="notice success"><strong>מחוברת:</strong> ${esc(cloud.user.email||'')}<br><span class="muted">החיבור נשמר אוטומטית במכשיר הזה, ובכניסה הבאה המערכת תתחבר ותטען את הנתונים מהענן.</span></div><div class="actions" style="margin-top:12px"><button class="btn secondary" onclick="App.pullCloud()">רענון מהענן</button><button class="btn ghost" onclick="App.logout()">התנתקות</button></div>`:`<div class="form-grid"><div class="field full"><label>Project URL</label><input id="cloudUrl" dir="ltr" value="${esc(c.url||'')}"></div><div class="field full"><label>Publishable / Anon Key</label><input id="cloudKey" type="password" dir="ltr" value="${esc(c.key||'')}"></div><div class="field"><label>אימייל</label><input id="cloudEmail" type="email" dir="ltr" autocomplete="email" value="${esc(c.email||'')}"></div><div class="field"><label>סיסמה</label><input id="cloudPassword" type="password" dir="ltr" autocomplete="current-password"></div></div><div class="actions" style="margin-top:12px"><button class="btn" onclick="App.cloudLogin()">כניסה</button><button class="btn secondary" onclick="App.cloudSignup()">יצירת חשבון</button></div>`}<div class="hint" style="margin-top:12px">פרטי הפרויקט, המפתח הציבורי והאימייל נשמרים במכשיר. לאחר התחברות מוצלחת, Supabase שומר סשן מאובטח ולכן בדרך כלל לא תצטרכי להקליד שוב את הסיסמה. הסיסמה עצמה אינה נשמרת באתר או בענן.</div></div><div class="card"><h2>עוזרת AI</h2><div class="notice">העוזרת פועלת דרך פונקציית Supabase בשם <strong>bakery-assistant</strong>. מפתח OpenAI נשמר רק בסודות השרת.</div><div class="actions" style="margin-top:12px"><button type="button" class="btn ghost" onclick="App.go('assistant')">פתיחת העוזרת</button><button type="button" class="btn ghost" onclick="App.clearAIChat()">מחיקת היסטוריה</button></div></div><div class="card"><h2>ייבוא מתכונים חכם</h2><div class="notice">המנתח המקומי פעיל תמיד. פונקציית Supabase בשם <strong>parse-recipe</strong> מוסיפה ניתוח AI כאשר היא מוגדרת.</div><div class="hint" style="margin-top:10px">מפתח ה־AI אינו נשמר באתר או ב־GitHub.</div></div><div class="card"><h2>תצוגה וניווט</h2><div class="actions"><button type="button" class="btn ghost" onclick="App.editTabOrder()">סידור לשוניות</button><button type="button" class="btn ghost" onclick="App.editAvailability()">הזמינות שלי</button></div></div><div class="card"><h2>גיבוי ותחזוקה</h2><div class="actions"><button class="btn secondary" onclick="App.exportData()">הורדת גיבוי</button><button class="btn ghost" onclick="document.getElementById('importFile').click()">ייבוא גיבוי</button><button class="btn danger" onclick="App.resetAll()">מחיקת כל הנתונים</button></div></div></div>`;const form=document.getElementById('settingsForm');form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);state.settings={...state.settings,businessName:f.get('businessName')||'Bakery Workspace',currency:f.get('currency')||'₪',distanceCostPerKm:Number(f.get('distanceCostPerKm')||0),ovens:Math.max(1,Math.floor(Number(f.get('ovens'))||1)),ovenTrays:Math.max(1,Math.floor(Number(f.get('ovenTrays'))||1)),workStart:f.get('workStart')||'08:00',workEnd:f.get('workEnd')||'18:00'};await persist();render()}}

/* Supabase */
function getCloud(){try{return JSON.parse(localStorage.getItem(CLOUD_KEY)||'null')}catch(e){return null}}
function hasBusinessData(x){return !!((x.recipes&&x.recipes.length)||(x.orders&&x.orders.length)||(x.invoices&&x.invoices.length)||(x.inventory&&x.inventory.length)||(x.suppliers&&x.suppliers.length))}
function initCloud(){const c=getCloud();if(!c?.url||!c?.key||!window.supabase)return false;cloud.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'bakery-workspace-auth-v1'}});return true}
function remoteIsNewer(updatedAt){return(Date.parse(updatedAt||0)||0)>(Date.parse(state.updatedAt||0)||0)+250}
function applyRemote(data,updatedAt,show=true){if(!data)return;if(updatedAt&&!remoteIsNewer(updatedAt)&&hasBusinessData(state))return;state=migrateState({...data,updatedAt:updatedAt||data.updatedAt||new Date().toISOString()});localStorage.setItem(LS_KEY,JSON.stringify(localStateSnapshot()));if(show){setStatus('✓ התעדכן מהענן');setTimeout(()=>setStatus(''),1400)}render()}
async function cloudAuth(mode){const url=document.getElementById('cloudUrl')?.value.trim(),key=document.getElementById('cloudKey')?.value.trim(),email=document.getElementById('cloudEmail')?.value.trim(),password=document.getElementById('cloudPassword')?.value;if(!url||!key||!email||!password)return alert('יש למלא את כל פרטי החיבור');localStorage.setItem(CLOUD_KEY,JSON.stringify({url,key,email}));if(!initCloud())return alert('פרטי Supabase אינם תקינים');setStatus('מתחברת…');const res=mode==='signup'?await cloud.client.auth.signUp({email,password}):await cloud.client.auth.signInWithPassword({email,password});if(res.error){setStatus('⚠ ההתחברות נכשלה');return alert(res.error.message)}cloud.user=res.data.user;if(!cloud.user){setStatus('');return alert('נשלח אימייל אימות. אשרי אותו ואז התחברי.')}await initialCloudSync();startCloudSync();setStatus('✓ החיבור נשמר');render()}
async function initialCloudSync(){if(!cloud.user||!cloud.client)return;setStatus('מסנכרן…');const {data,error}=await cloud.client.from('bakery_os_data').select('data,updated_at').eq('user_id',cloud.user.id).maybeSingle();if(error){setStatus('⚠ שגיאת סנכרון');throw error}if(data?.data){const localHas=hasBusinessData(state),remoteHas=hasBusinessData(data.data),localTime=Date.parse(state.updatedAt||0)||0,remoteTime=Date.parse(data.updated_at||data.data.updatedAt||0)||0;if(localHas&&(!remoteHas||localTime>remoteTime+250)){await pushCloud();setStatus('✓ הנתונים מהמכשיר נשמרו בענן')}else{state=migrateState({...data.data,updatedAt:data.updated_at||data.data.updatedAt});localStorage.setItem(LS_KEY,JSON.stringify(localStateSnapshot()));setStatus('✓ נטען מהענן')}}else if(hasBusinessData(state))await pushCloud();else{state.updatedAt=new Date().toISOString();await pushCloud()}}
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
  newOrder:()=>orderForm(),editOrder:x=>orderForm(state.orders.find(o=>o.id===x)),newSalesEvent:()=>salesEventForm(),editSalesEvent:x=>salesEventForm(state.salesEvents.find(e=>e.id===x)),addSalesEventItem:()=>document.getElementById('salesEventItems').insertAdjacentHTML('beforeend',salesEventItemRow({})),syncSalesEventItem,deleteSalesEvent:async x=>{if(confirm('למחוק את אירוע המכירה?')){state.salesEvents=state.salesEvents.filter(e=>e.id!==x);await persist();render()}},repeatOrderNextWeek,deleteOrder:async x=>{if(confirm('למחוק את ההזמנה?')){state.orders=state.orders.filter(o=>o.id!==x);await persist();render()}},addOrderItem:()=>document.getElementById('orderItems').insertAdjacentHTML('beforeend',orderRow({recipeId:'',qty:1})),
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

document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.view));
const tabsEl=document.getElementById('tabs');
if(tabsEl){tabsEl.addEventListener('scroll',updateTabScrollButtons,{passive:true});tabsEl.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();tabsEl.scrollLeft+=e.deltaY;}},{passive:false});window.addEventListener('resize',updateTabScrollButtons);setTimeout(updateTabScrollButtons,120);} 
document.addEventListener('submit',e=>{const button=e.submitter||e.target.querySelector('button[type=submit],button:not([type])');if(!button)return;saveFeedbackButton=button;if(!button.dataset.saveOriginal)button.dataset.saveOriginal=button.textContent.trim()||'שמירה';button.textContent='שומרת…';button.disabled=true;setTimeout(()=>{if(saveFeedbackButton===button){button.disabled=false;button.textContent=button.dataset.saveOriginal;saveFeedbackButton=null}},5000)},true);
document.getElementById('modalClose').onclick=close;document.getElementById('modal').onclick=e=>{if(e.target.id==='modal')close()};document.getElementById('backupBtn').onclick=exportData;document.getElementById('cloudBtn').onclick=()=>go('settings');
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
      const registration=await navigator.serviceWorker.register('./sw.js?v=1170',{updateViaCache:'none'});
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
initTabOrder();initSession().finally(render);
})();
