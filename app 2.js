(() => {
'use strict';

const LS_KEY='bakery_os_state_v1', CLOUD_KEY='bakery_os_cloud_v1';
const UNITS=['גרם','ק"ג','מ"ל','ליטר','יחידה','חבילה','כפית','כף','כוס','קורט'];
const WEIGHT={'גרם':1,'ק"ג':1000}, VOLUME={'מ"ל':1,'ליטר':1000};
const STATUSES=['חדשה','מאושרת','בייצור','מוכנה','נמסרה','בוטלה'];
const INVOICE_STATUSES=['טיוטה','נשלחה','שולמה','בוטלה'];
const INVOICE_TYPES=['דרישת תשלום','חשבונית עסקה / פרופורמה','הצעת מחיר'];
const CATS=['יבשים','מקרר','קפואים','תוספות','אריזות','אחר'];
const TASK_TYPES={shop:'קניות',prep:'הכנה',sub:'תת־מתכון',bake:'אפייה',pack:'אריזה',delivery:'מסירה',clean:'ניקיון'};
let currentView='dashboard', cloud={client:null,user:null,channel:null,timer:null};
let pendingImport=null, plannerWeekOffset=0, plannerMode='week', plannerDay=dayKey(new Date()), draggedTaskKey='', priceCatalogFilterTimer=null, touchPlanDrag=null, lastPlanDragEnd=0;
const priceCatalogSearchCache=new WeakMap();

const empty=()=>({
  settings:{businessName:'Bakery Workspace',currency:'₪',laborRate:45,distanceCostPerKm:1.5,ovens:1,ovenTrays:2,workStart:'08:00',workEnd:'18:00',planningBufferMin:120,weeklyAvailability:{0:[{start:'09:00',end:'13:00',available:true,label:'זמינה'}],1:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],2:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],3:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],4:[{start:'08:00',end:'18:00',available:true,label:'זמינה'}],5:[{start:'08:00',end:'13:00',available:true,label:'זמינה'}],6:[]},tabOrder:[]},
  invoiceProfile:{legalName:'',businessId:'',address:'',email:'',phone:'',vatRate:18,paymentTerms:'שוטף + 30',bankName:'',bankBranch:'',bankAccount:''},
  recipes:[],orders:[],invoices:[],invoiceSequence:1,todoItems:[],inventory:[],suppliers:[],priceImports:[],checkedTasks:{},checkedShopping:{},planOverrides:{},manualTasks:[],aiMessages:[],updatedAt:null
});

function id(prefix='id'){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
function esc(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(n,d=2){return Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:d})}
function money(n){return `${fmt(n)} ${state.settings.currency||'₪'}`}
function dateText(value){if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('he-IL',{dateStyle:'short',timeStyle:String(value).includes('T')?'short':undefined})}
function dayKey(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return'';const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`}
function addDays(value,n){const d=new Date(value);d.setDate(d.getDate()+Number(n||0));return d}
function minutesFromTime(t){const [h,m]=String(t||'08:00').split(':').map(Number);return(h||0)*60+(m||0)}
function timeFromMinutes(m){m=Math.max(0,Math.round(m));return`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`}
function norm(q,u){if(WEIGHT[u])return{qty:Number(q||0)*WEIGHT[u],unit:'גרם'};if(VOLUME[u])return{qty:Number(q||0)*VOLUME[u],unit:'מ"ל'};return{qty:Number(q||0),unit:u}}
function showQty(q,u){if(u==='גרם'&&q>=1000)return`${fmt(q/1000)} ק"ג`;if(u==='מ"ל'&&q>=1000)return`${fmt(q/1000)} ליטר`;return`${fmt(q)} ${u}`}
function showShoppingQty(q,u){if(u==='גרם')return`${Math.ceil(Math.max(0,Number(q||0))).toLocaleString('he-IL')} גרם`;return showQty(q,u)}
function setStatus(text){const el=document.getElementById('saveStatus');if(el)el.textContent=text||''}

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
    id:s.id||id('sub'),name:s.name||`תת־מתכון ${index+1}`,ingredients:Array.isArray(s.ingredients)?s.ingredients:[],steps:Array.isArray(s.steps)?s.steps:[],
    usedQtyGrams:Math.max(0,Number(s.usedQtyGrams||0)),evaporationPct:Number(s.evaporationPct??0),prepMin:Number(s.prepMin||0),restMin:Number(s.restMin||0),bakeMin:Number(s.bakeMin||0),ovenTemp:Number(s.ovenTemp||0),notes:String(s.notes||'')
  }));
  r.recipeType=r.subRecipes.length?'composite':'simple';
  r.packageWeight=Math.max(1,Number(r.packageWeight||r.unitWeight||200));
  r.evaporationPct=Number(r.evaporationPct??12);
  r.warnings=Array.isArray(r.warnings)?r.warnings:[];
  r.notes=String(r.notes||'');
  r.productionTasks=Array.isArray(r.productionTasks)?r.productionTasks.map((t,i)=>({id:t.id||id('flow'),title:String(t.title||t.text||`משימה ${i+1}`),type:t.type||inferTaskType(t.title||t.text||''),activeMin:Math.max(0,Number(t.activeMin??t.durationMin??20)),passiveMin:Math.max(0,Number(t.passiveMin||0)),canPrepareDays:Math.max(0,Number(t.canPrepareDays||0)),freshnessDays:Math.max(0,Number(t.freshnessDays||r.shelfLifeDays||0)),dependsOn:String(t.dependsOn||''),notes:String(t.notes||''),isPreprep:!!t.isPreprep})):[];
  r.ingredients=r.ingredients.map(i=>{
    const item={...i,name:String(i.name||'').trim(),qty:Number(i.qty||0),unit:UNITS.includes(i.unit)?i.unit:'גרם',category:CATS.includes(i.category)?i.category:ingredientCategory(i.name)};
    if(!item.linkedSubRecipeId){const match=r.subRecipes.find(s=>ingredientNamesMatch(item.name,s.name));if(match)item.linkedSubRecipeId=match.id}
    return item;
  });
  return r;
}
function migrateState(raw){
  const base=empty(),x={...base,...(raw||{})};
  x.settings={...base.settings,...(raw?.settings||{})};
  x.settings.weeklyAvailability={...base.settings.weeklyAvailability,...(raw?.settings?.weeklyAvailability||{})};
  x.settings.tabOrder=Array.isArray(raw?.settings?.tabOrder)?raw.settings.tabOrder:[];
  if(!x.settings.businessName||x.settings.businessName==='Bakery OS')x.settings.businessName='Bakery Workspace';
  x.recipes=(Array.isArray(raw?.recipes)?raw.recipes:[]).map(migrateRecipe);
  x.orders=Array.isArray(raw?.orders)?raw.orders:[];
  x.invoiceProfile={...base.invoiceProfile,...(raw?.invoiceProfile||{})};
  x.invoices=(Array.isArray(raw?.invoices)?raw.invoices:[]).map(inv=>({...inv,items:Array.isArray(inv.items)?inv.items:[],seller:{...x.invoiceProfile,...(inv.seller||{})},vatRate:Number(inv.vatRate??x.invoiceProfile.vatRate??18),vatEnabled:inv.vatEnabled!==false,status:INVOICE_STATUSES.includes(inv.status)?inv.status:'טיוטה'}));
  x.invoiceSequence=Math.max(1,Number(raw?.invoiceSequence||1));
  x.todoItems=(Array.isArray(raw?.todoItems)?raw.todoItems:[]).map(item=>({id:item.id||id('todo'),text:String(item.text||'').trim(),done:!!item.done,priority:['נמוכה','רגילה','גבוהה'].includes(item.priority)?item.priority:'רגילה',dueDate:String(item.dueDate||''),notes:String(item.notes||''),createdAt:item.createdAt||new Date().toISOString()}));
  x.inventory=Array.isArray(raw?.inventory)?raw.inventory:[];
  x.suppliers=Array.isArray(raw?.suppliers)?raw.suppliers:[];
  x.priceImports=Array.isArray(raw?.priceImports)?raw.priceImports:[];
  x.checkedTasks=raw?.checkedTasks&&typeof raw.checkedTasks==='object'?raw.checkedTasks:{};
  x.checkedShopping=raw?.checkedShopping&&typeof raw.checkedShopping==='object'?raw.checkedShopping:{};
  x.planOverrides=raw?.planOverrides&&typeof raw.planOverrides==='object'?raw.planOverrides:{};
  x.manualTasks=Array.isArray(raw?.manualTasks)?raw.manualTasks:[];
  x.aiMessages=(Array.isArray(raw?.aiMessages)?raw.aiMessages:[]).slice(-40).map(m=>({id:m.id||id('aimsg'),role:m.role==='assistant'?'assistant':'user',text:String(m.text||''),createdAt:m.createdAt||new Date().toISOString(),action:m.action&&typeof m.action==='object'?m.action:null}));
  return x;
}
function load(){try{return migrateState(JSON.parse(localStorage.getItem(LS_KEY)||'null'))}catch(e){console.warn(e);return empty()}}
let state=load();

async function persist(sync=true){
  state.updatedAt=new Date().toISOString();
  try{localStorage.setItem(LS_KEY,JSON.stringify(state));setStatus('✓ נשמר');setTimeout(()=>setStatus(''),1200)}catch(e){console.error(e);setStatus('⚠ אין מקום לשמירה מקומית');alert('הדפדפן לא הצליח לשמור את כל הנתונים. מומלץ להוריד גיבוי ולמחוק ייבואי מחירים ישנים.')}
  if(sync&&cloud.user)await pushCloud();
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
function recipeYieldBags(r){const p=packageSummary(r);return Math.max(1,p.fullBags||Number(r?.yieldUnits||1))}

function canonicalAmount(name,qty,unit){const w=ingredientWeightData({name,qty,unit});if(w.known&&w.grams>0)return{qty:w.grams,unit:'גרם'};return norm(qty,unit)}
function recipe(recipeId){return state.recipes.find(r=>r.id===recipeId)}
function activeOrders(){return state.orders.filter(o=>!['נמסרה','בוטלה'].includes(o.status))}
function revenue(order){return(order.items||[]).reduce((sum,item)=>sum+(recipe(item.recipeId)?.salePrice||0)*Number(item.qty||0),0)}
function inventoryPackageCount(i){return Math.max(0,Math.floor(Number(i?.packageCount??(Number(i?.qty||0)>0?1:0))))}
function inventoryAmountPerPackage(i){return Math.max(0,Number(i?.amountPerPackage??i?.qty??0))}
function inventoryTotal(i){return inventoryPackageCount(i)*inventoryAmountPerPackage(i)}
function inventoryMinPackageCount(i){return Math.max(0,Math.floor(Number(i?.minPackageCount??0)))}
function inventoryMinTotal(i){if(i?.minPackageCount!==undefined)return inventoryMinPackageCount(i)*inventoryAmountPerPackage(i);return Math.max(0,Number(i?.minQty||0))}
function inventoryPackCost(i){return Math.max(0,Number(i?.costPerPackage??i?.unitCost??0))}
function invAmount(name,unit){
  const target=cleanIngredientName(name),requested=canonicalAmount(name,1,unit);let total=0;
  state.inventory.forEach(i=>{if(cleanIngredientName(i.name)!==target)return;const x=canonicalAmount(i.name,inventoryTotal(i),i.unit);if(x.unit===requested.unit)total+=x.qty/requested.qty});return total;
}

function unitCost(name,unit){
  const target=cleanIngredientName(name),requested=canonicalAmount(name,1,unit);let best=null;
  state.inventory.forEach(i=>{if(cleanIngredientName(i.name)!==target)return;const pack=canonicalAmount(i.name,inventoryAmountPerPackage(i),i.unit);if(pack.unit!==requested.unit||!pack.qty)return;const cost=inventoryPackCost(i)/pack.qty*requested.qty;if(best===null||cost<best)best=cost});
  state.suppliers.forEach(s=>(s.prices||[]).forEach(p=>{if(cleanIngredientName(p.ingredient)!==target)return;const pack=canonicalAmount(p.ingredient,p.packQty,p.unit);if(pack.unit!==requested.unit||!pack.qty)return;const cost=Number(p.packPrice||0)/pack.qty*requested.qty;if(best===null||cost<best)best=cost}));
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
  const mainLabor=(Number(r.prepMin||0)+Number(r.bakeMin||0))/60*Number(state.settings.laborRate||0);
  let subLabor=0;(r.subRecipes||[]).forEach(s=>{const used=(r.ingredients||[]).filter(i=>i.linkedSubRecipeId===s.id).reduce((a,i)=>a+ingredientWeightData(i).grams,0),yieldW=calculateSubRecipeWeight(s).finalWeight,factor=yieldW?Math.min(1,used/yieldW):0;subLabor+=(Number(s.prepMin||0)+Number(s.bakeMin||0))/60*Number(state.settings.laborRate||0)*factor});
  const bags=recipeYieldBags(r),packaging=Number(r.packagingCost||0)*bags,total=(ingredients+mainLabor+subLabor+packaging)*(1+Number(r.wastePct||0)/100);
  return{ingredients,labor:mainLabor+subLabor,packaging,total,perUnit:total/bags};
}
function demand(){
  const byRecipe={},ingredients={};
  activeOrders().forEach(o=>(o.items||[]).forEach(i=>byRecipe[i.recipeId]=(byRecipe[i.recipeId]||0)+Number(i.qty||0)));
  Object.entries(byRecipe).forEach(([rid,bags])=>{const r=recipe(rid);if(!r)return;const batches=Math.ceil(bags/recipeYieldBags(r));expandedIngredients(r).forEach(i=>{const x=canonicalAmount(i.name,Number(i.qty||0)*batches,i.unit),key=`${cleanIngredientName(i.name)}|${x.unit}`;if(!ingredients[key])ingredients[key]={name:i.name,unit:x.unit,required:0,category:i.category||'אחר'};ingredients[key].required+=x.qty})});
  return{byRecipe,ingredients};
}
function shopping(){return Object.entries(demand().ingredients).map(([key,x])=>{const available=invAmount(x.name,x.unit);return{...x,key,available,need:Math.max(0,x.required-available),checked:!!state.checkedShopping[key]}}).filter(x=>x.need>0).sort((a,b)=>a.category.localeCompare(b.category,'he')||a.name.localeCompare(b.name,'he'))}
function supplierOptions(){const items=shopping();return state.suppliers.map(s=>{let itemsCost=0,covered=0;items.forEach(it=>{let best=null;(s.prices||[]).filter(p=>cleanIngredientName(p.ingredient)===cleanIngredientName(it.name)).forEach(p=>{const x=canonicalAmount(p.ingredient,p.packQty,p.unit);if(x.unit!==it.unit||!x.qty)return;const packs=Math.ceil(it.need/x.qty),cost=packs*Number(p.packPrice||0);if(best===null||cost<best)best=cost});if(best!==null){itemsCost+=best;covered++}});const delivery=Number(s.deliveryCost||0),distanceCost=Number(s.distanceKm||0)*2*Number(state.settings.distanceCostPerKm||0);return{supplier:s,itemsCost,covered,delivery,distanceCost,total:itemsCost+delivery+distanceCost}}).sort((a,b)=>a.total-b.total)}

/* ניתוח מתכונים מקומי */
const FRACTION_VALUES={'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875,'חצי':.5,'רבע':.25,'שליש':1/3};
const UNIT_ALIASES=[
{re:/^(?:ק[״"]?ג|קילו(?:גרם)?|קילוגרם|קילוגרמים)(?=\s|$)/i,unit:'ק"ג'},
{re:/^(?:גרם|גרמים|גר׳|ג׳|ג')(?=\s|$)/i,unit:'גרם'},
{re:/^(?:מ[״"]?ל|מיליליטר(?:ים)?|ml)(?=\s|$)/i,unit:'מ"ל'},
{re:/^(?:ליטר|ליטרים)(?=\s|$)/i,unit:'ליטר'},
{re:/^(?:כוס|כוסות)(?=\s|$)/i,unit:'כוס'},
{re:/^(?:כף|כפות)(?=\s|$)/i,unit:'כף'},
{re:/^(?:כפית|כפיות)(?=\s|$)/i,unit:'כפית'},
{re:/^(?:קורט|קורטים)(?=\s|$)/i,unit:'קורט'},
{re:/^(?:חבילה|חבילות|מארז|מארזים|שקית|שקיות)(?=\s|$)/i,unit:'חבילה'},
{re:/^(?:יחידה|יחידות)(?=\s|$)/i,unit:'יחידה'}
];
function parseNumberToken(token){token=String(token||'').trim().replace(',','.');if(FRACTION_VALUES[token]!==undefined)return FRACTION_VALUES[token];if(/^\d+\/\d+$/.test(token)){const[a,b]=token.split('/').map(Number);return b?a/b:0}if(/^\d+\s+\d+\/\d+$/.test(token)){const[m,f]=token.split(/\s+/,2);return Number(m)+parseNumberToken(f)}const n=Number(token);return Number.isFinite(n)?n:0}
function ingredientCategory(name){const n=cleanIngredientName(name);if(/חלב|חמאה|שמנת|יוגורט|גבינ|ביצה|ביצים/.test(n))return'מקרר';if(/קפוא|גלידה/.test(n))return'קפואים';if(/קופס|שקית|נייר אפייה|אריז|מדבקה|סרט/.test(n))return'אריזות';if(/שוקולד|אגוז|שקד|פקאן|פיסטוק|צימוק|סוכריות|תמצית|וניל|מחית|ריבה|ממרח|טופי/.test(n))return'תוספות';if(/קמח|סוכר|קקאו|מלח|אבקת אפייה|סודה|שמרים|קורנפלור|שיבולת|קוואקר/.test(n))return'יבשים';return'אחר'}
function recipeCategoryFromText(text){const n=cleanIngredientName(text);if(/עוגיות|קוקי/.test(n))return'עוגיות';if(/עוגה|טארט|פאי/.test(n))return'עוגות';if(/לחם|חלה|לחמנ/.test(n))return'לחמים';if(/מאפין|קאפקייק/.test(n))return'מאפינס';if(/קרואסון|בורקס|מאפה/.test(n))return'מאפים';return'אחר'}
function stripIngredientComment(text){
  return String(text||'').replace(/\s*[–—-]\s*(?:מעניק|מומלץ|לאיזון|לפי|לטעם|אופציונלי|רשות).*/i,'').replace(/\((?:מומלץ|לאיזון|אופציונלי|לפי הטעם|בסוף|בהתחלה)[^)]*\)/gi,'').trim();
}
function normalizeIngredientName(text){
  return stripIngredientComment(String(text||'').replace(/^של\s+/,'').replace(/[,:;.-]+$/,'').trim());
}
function parseQuantityAndUnit(text){
  let s=String(text||'').trim();
  const amount=s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞]|חצי|רבע|שליש)\s*(.*)$/i);
  if(!amount)return null;
  let qty=parseNumberToken(amount[1]),rest=amount[2].trim();
  if(!qty)return null;
  let unit='יחידה';
  for(const a of UNIT_ALIASES){const m=rest.match(a.re);if(m){unit=a.unit;rest=rest.slice(m[0].length).trim();break}}
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
  // שורות ממוספרות הן הוראות הכנה, לא כמויות של מצרכים.
  if(/^\d+[.)]\s+/.test(s)||/^שלב\s*\d+/i.test(s))return null;
  if(/^קורט\s+/.test(s)){
    const name=normalizeIngredientName(s.replace(/^קורט\s+/,''));
    return name?{name,qty:1,unit:'קורט',category:ingredientCategory(name)}:null;
  }
  // תומך גם במבנה "שם רכיב: 220 גרם" וגם במבנה "220 גרם רכיב".
  const named=s.match(/^([^:]{2,80})\s*:\s*(.+)$/);
  if(named){
    const parsed=parseQuantityAndUnit(named[2]);
    if(parsed){
      let name=normalizeIngredientName(named[1]);
      if(/^ביצה$/i.test(name)&&/גדולה|\bL\b/i.test(parsed.rest))name='ביצה גדולה L';
      return name?{name,qty:parsed.qty,unit:parsed.unit,category:ingredientCategory(name)}:null;
    }
  }
  const parsed=parseQuantityAndUnit(s);if(!parsed)return null;
  let rest=normalizeIngredientName(parsed.rest);
  if(/^ביצ(?:ה|ים)\b/.test(rest)){parsed.unit='יחידה';rest=rest.replace(/^ביצ(?:ה|ים)\b/,'ביצה')}
  if(!rest)return null;
  return{name:rest,qty:parsed.qty,unit:parsed.unit,category:ingredientCategory(rest)};
}
function inferAllergens(ingredients){const text=cleanIngredientName((ingredients||[]).map(i=>i.name).join(' ')),a=[];if(/קמח|גלוטן|חיטה|שיבולת|שיפון|שעורה/.test(text))a.push('גלוטן');if(/חלב|חמאה|שמנת|יוגורט|גבינ/.test(text))a.push('חלב');if(/ביצה|ביצים|חלבון|חלמון/.test(text))a.push('ביצים');if(/אגוז|שקד|פקאן|פיסטוק|לוז|קשיו/.test(text))a.push('אגוזים');if(/בוטנ/.test(text))a.push('בוטנים');if(/שומשום|טחינה/.test(text))a.push('שומשום');if(/סויה/.test(text))a.push('סויה');return a.join(', ')}
function normalizeSectionName(text){
  return String(text||'').replace(/[📦✨]/g,'').replace(/[:\-–—]+$/,'').replace(/^(?:ל|עבור)\s+/,'').replace(/^ה(?=עוגיות|טופי|בצק|קרם|מילוי)/,'').trim();
}
function isGenericHeading(line){return/^(?:מצרכים|רכיבים|אופן הכנה|אופן ההכנה|הוראות|הכנה|שלבי הכנה|אפייה|הערות|טיפים|אחסון|אחסון וחיי מדף|ingredients|method|instructions)\s*:?$/i.test(String(line||'').replace(/[📦✨]/g,'').trim())}
function isActionLine(line){return/(?:מערבב|ממיס|מוסיפ|מקפל|אופ|מחממ|מקרר|מצננ|מעביר|שופכ|מכניס|מוציא|מקציפ|חותכ|שובר|מבשל|מרדד|יוצר|מסדר|מניח|מוציאים|מחלק|מגלגל|משטח|מרפד|מכין|טורף|מוזג|מפסיק|מניחים|שמים|מבשלים)/.test(cleanIngredientName(line))}
function isNoteLine(line){return/(?:טיפ|הערה|אחסון|נשמר|חיי מדף|תנאי אחסון|חשוב|שימו לב|אפשר לשמור|חובה לאחסן|עד \d+ (?:ימים|חודשים))/.test(cleanIngredientName(line))}
function ingredientNamesMatch(a,b){
  const x=cleanIngredientName(a).replace(/\b(?:איכותית|רכה|כהה|דביק|גדולה|קטנה|שבבים|חתיכות)\b/g,'').trim();
  const y=cleanIngredientName(b).replace(/\b(?:מתכון|תת מתכון|שלב)\b/g,'').trim();
  return !!x&&!!y&&(x===y||x.includes(y)||y.includes(x));
}
function localParseRecipe(text){
  const raw=String(text||'').replace(/\r/g,''),lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);
  let originalTitle='',mode='unknown',current=null;const sections=[],warnings=[];
  const findSection=name=>sections.find(s=>cleanIngredientName(s.name)===cleanIngredientName(normalizeSectionName(name)));
  const useSection=name=>{const clean=normalizeSectionName(name)||'מתכון ראשי';current=findSection(clean)||{id:id('sub'),name:clean,ingredients:[],steps:[],bakingSteps:[],notes:[]};if(!sections.includes(current))sections.push(current);return current};
  for(let index=0;index<lines.length;index++){
    const line=lines[index],plain=line.replace(/[📦✨]/g,'').trim(),next=lines[index+1]||'';
    if(!originalTitle&&index<4&&!parseIngredientLine(line)&&!isGenericHeading(line)&&!isActionLine(line)&&!/(?:רכיבים|מצרכים|אופן הכנה)/.test(plain)){originalTitle=normalizeSectionName(line);continue}
    let m=plain.match(/^(?:מצרכים|רכיבים)\s+(?:ל|עבור)?\s*(.+?)\s*:?$/i);
    if(m){useSection(m[1]);mode='ingredients';continue}
    if(/^(?:מצרכים|רכיבים|ingredients)\s*:?$/i.test(plain)){if(!current)useSection(originalTitle||'מתכון ראשי');mode='ingredients';continue}
    m=plain.match(/^(.+?)\s+(?:אופן\s+ההכנה|אופן\s+הכנה|הוראות\s+הכנה)\s*:?$/i);
    if(m){useSection(m[1]);mode='steps';continue}
    if(/^(?:אופן\s+הכנה|אופן\s+ההכנה|הוראות|הכנה|שלבי\s+הכנה|method|instructions)\s*:?$/i.test(plain)){if(!current)useSection(originalTitle||'מתכון ראשי');mode='steps';continue}
    if(/^(?:אפייה|שלב\s+האפייה)\s*:?$/i.test(plain)){if(!current)useSection(originalTitle||'מתכון ראשי');mode='baking';continue}
    if(/^(?:הערות|טיפים|אחסון|אחסון\s+וחיי\s+מדף)\s*:?$/i.test(plain)){if(!current)useSection(originalTitle||'מתכון ראשי');mode='notes';continue}
    // כותרות כגון "שלב 1 – הכנת הבצק" שייכות לאופן ההכנה ואינן יוצרות תת־מתכון.
    if(/^שלב\s*\d+\s*[:.\-–—]/i.test(plain)||/^שלב\s*\d+/i.test(plain)){if(!current)useSection(originalTitle||'מתכון ראשי');mode='steps';current.steps.push({text:plain.replace(/[:]+$/,''),daysBefore:0,time:'',durationMin:0});continue}
    const ing=parseIngredientLine(line),nextIng=parseIngredientLine(next);
    const shortHeading=!ing&&!/^שלב\s*\d+/i.test(plain)&&!isActionLine(line)&&!isNoteLine(line)&&line.length<55&&nextIng&&!/^(?:זמן|תפוקה|טמפרטורה)/.test(line);
    if(shortHeading){useSection(line);mode='ingredients';continue}
    if(ing&&mode==='ingredients'){if(!current)useSection(originalTitle||'מתכון ראשי');current.ingredients.push(ing);continue}
    const clean=line.replace(/^\d+[.)]\s*/,'').replace(/^[•*\-–—]+\s*/,'').trim();if(!clean)continue;
    if(isNoteLine(clean)||mode==='notes'){if(!current)useSection(originalTitle||'מתכון ראשי');current.notes.push(clean);mode='notes';continue}
    if(mode==='baking'){current.bakingSteps.push({text:clean,daysBefore:0,time:'',durationMin:0});continue}
    if(isActionLine(clean)||mode==='steps'||sections.some(s=>s.ingredients.length)){if(!current)useSection(originalTitle||'מתכון ראשי');current.steps.push({text:clean,daysBefore:0,time:'',durationMin:0});mode='steps';continue}
  }
  if(!sections.length)useSection(originalTitle||'מתכון ראשי');
  const ingredientLinks=[];
  sections.forEach(container=>container.ingredients.forEach(i=>sections.forEach(candidate=>{if(candidate!==container&&candidate.ingredients.length&&ingredientNamesMatch(i.name,candidate.name))ingredientLinks.push({container,ingredient:i,sub:candidate})})));
  let main=ingredientLinks[0]?.container||sections.find(s=>/עוגי|קוקי/.test(cleanIngredientName(s.name)))||sections.slice().sort((a,b)=>b.ingredients.length-a.ingredients.length)[0]||sections[0];
  const linkedSubs=[...new Set(ingredientLinks.filter(x=>x.container===main).map(x=>x.sub))];
  let subSections=linkedSubs.length?linkedSubs:sections.filter(s=>s!==main&&s.ingredients.length);
  const subRecipes=subSections.map(s=>({...s,usedQtyGrams:0,evaporationPct:0,prepMin:0,restMin:0,bakeMin:0,ovenTemp:0,notes:s.notes.join('\n')}));
  main.ingredients.forEach(i=>{const match=subRecipes.find(s=>ingredientNamesMatch(i.name,s.name));if(match){i.linkedSubRecipeId=match.id;match.usedQtyGrams=ingredientWeightData(i).grams}});
  let finalName=originalTitle||main.name||'מתכון מיובא';
  if(/^(?:עוגיות|עוגיה|cookies?)$/i.test(cleanIngredientName(main.name))&&subRecipes.some(s=>ingredientNamesMatch(finalName,s.name)))finalName=`עוגיות ${subRecipes.find(s=>ingredientNamesMatch(finalName,s.name)).name}`;
  if(cleanIngredientName(finalName)===cleanIngredientName(subRecipes[0]?.name)&&/עוגי/.test(cleanIngredientName(main.name)))finalName=`${main.name} ${subRecipes[0].name}`;
  const allIngredients=[...main.ingredients,...subRecipes.flatMap(s=>s.ingredients)],allText=cleanIngredientName(allIngredients.map(i=>i.name).join(' ')),stepText=cleanIngredientName([...main.steps,...main.bakingSteps,...subRecipes.flatMap(s=>s.steps)].map(s=>s.text).join(' '));
  if(/שוקולד/.test(stepText)&&!/שוקולד/.test(allText))warnings.push('אופן ההכנה מזכיר שוקולד, אבל שוקולד לא מופיע ברשימת המצרכים. לא הוספתי שוקולד אוטומטית.');
  const temp=raw.match(/(?:תנור[^\d]{0,18}|)(\d{2,3})\s*(?:°|מעלות)/),bakeRange=raw.match(/אופים?[^\d]{0,20}(\d+)\s*(?:[-–—]\s*(\d+))?\s*(?:דקות|דק['׳]?)/i),bake=raw.match(/(\d+)\s*(?:דקות|דק['׳]?)\s+(?:אפייה|בתנור)/i),prep=raw.match(/זמן\s+הכנה[^\d]{0,10}(\d+)/),yieldM=raw.match(/(?:תפוקה|יוצא|מתקבל(?:ות|ים)?)[^\d]{0,15}(\d+)\s*(?:שקיות|יחידות|עוגיות|מאפים|מנות)?/i);
  if(!yieldM)warnings.push('לא נמצאה תפוקה מדויקת. מספר השקיות יחושב מהמשקל הסופי ומשקל השקית.');
  const packageM=raw.match(/(?:שקית|אריזה)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*גרם/i);
  return{name:finalName,category:recipeCategoryFromText(finalName+' '+raw),packageWeight:packageM?Number(packageM[1].replace(',','.')):200,yieldUnits:yieldM?Number(yieldM[1]):1,unitWeight:0,prepMin:prep?Number(prep[1]):30,restMin:0,bakeMin:bakeRange?Number(bakeRange[2]||bakeRange[1]):bake?Number(bake[1]):0,ovenTemp:temp?Number(temp[1]):0,traysPerBatch:1,unitsPerTray:12,shelfLifeDays:4,packagingCost:0,wastePct:5,evaporationPct:12,salePrice:0,allergens:inferAllergens(allIngredients),notes:main.notes.join('\n'),ingredients:main.ingredients,steps:main.steps,bakingSteps:main.bakingSteps,subRecipes,warnings,recipeType:subRecipes.length?'composite':'simple'};
}
function sanitizeIngredient(i){return{name:String(i?.name||'').trim(),qty:Math.max(0,Number(i?.qty||0)),unit:UNITS.includes(i?.unit)?i.unit:'גרם',category:CATS.includes(i?.category)?i.category:ingredientCategory(i?.name),linkedSubRecipeId:String(i?.linkedSubRecipeId||'')}}
function sanitizeStep(s){return{text:String(s?.text||s||'').trim(),daysBefore:Math.max(0,Number(s?.daysBefore||0)),time:String(s?.time||''),durationMin:Math.max(0,Number(s?.durationMin||0))}}
function sanitizeImportedRecipe(data,text){
  const base=localParseRecipe(text),x=data&&typeof data==='object'?data:{},structured=base.ingredients.length>=2&&(base.steps.length+base.bakingSteps.length)>=2;
  const subsSource=structured?base.subRecipes:(Array.isArray(x.subRecipes)?x.subRecipes:base.subRecipes);
  const subs=subsSource.map((s,index)=>({id:String(s.id||id('sub')),name:String(s.name||`תת־מתכון ${index+1}`),usedQtyGrams:Math.max(0,Number(s.usedQtyGrams||0)),evaporationPct:Math.max(0,Number(s.evaporationPct||0)),prepMin:Math.max(0,Number(s.prepMin||0)),restMin:Math.max(0,Number(s.restMin||0)),bakeMin:Math.max(0,Number(s.bakeMin||0)),ovenTemp:Math.max(0,Number(s.ovenTemp||0)),notes:String(s.notes||''),ingredients:(Array.isArray(s.ingredients)?s.ingredients:[]).map(sanitizeIngredient).filter(i=>i.name&&i.qty),steps:(Array.isArray(s.steps)?s.steps:[]).map(sanitizeStep).filter(s=>s.text)}));
  const ingredientSource=structured?base.ingredients:(Array.isArray(x.ingredients)?x.ingredients:base.ingredients);
  const ingredients=ingredientSource.map(sanitizeIngredient).filter(i=>i.name&&i.qty);
  ingredients.forEach(i=>{if(!i.linkedSubRecipeId){const m=subs.find(s=>ingredientNamesMatch(i.name,s.name));if(m)i.linkedSubRecipeId=m.id}});
  subs.forEach(s=>{const i=ingredients.find(x=>x.linkedSubRecipeId===s.id||ingredientNamesMatch(x.name,s.name));if(i){i.linkedSubRecipeId=s.id;s.usedQtyGrams=ingredientWeightData(i).grams||s.usedQtyGrams}});
  const steps=(structured?base.steps:(Array.isArray(x.steps)?x.steps:base.steps)).map(sanitizeStep).filter(s=>s.text);
  const bakingSteps=(structured?base.bakingSteps:(Array.isArray(x.bakingSteps)?x.bakingSteps:base.bakingSteps)).map(sanitizeStep).filter(s=>s.text);
  return migrateRecipe({...base,...x,id:'',name:String(structured?base.name:(x.name||base.name||'מתכון מיובא')),category:String(x.category||base.category||'אחר'),packageWeight:Math.max(1,Number(x.packageWeight||base.packageWeight||200)),yieldUnits:Math.max(1,Number(x.yieldUnits||base.yieldUnits||1)),prepMin:Math.max(0,Number(x.prepMin??base.prepMin??0)),restMin:Math.max(0,Number(x.restMin??base.restMin??0)),bakeMin:Math.max(0,Number(x.bakeMin??base.bakeMin??0)),ovenTemp:Math.max(0,Number(x.ovenTemp??base.ovenTemp??0)),traysPerBatch:Math.max(1,Number(x.traysPerBatch||1)),unitsPerTray:Math.max(1,Number(x.unitsPerTray||12)),shelfLifeDays:Math.max(0,Number(x.shelfLifeDays??4)),packagingCost:Math.max(0,Number(x.packagingCost||0)),wastePct:Math.max(0,Number(x.wastePct??5)),evaporationPct:Math.max(0,Number(x.evaporationPct??12)),salePrice:Math.max(0,Number(x.salePrice||0)),allergens:String(x.allergens||inferAllergens([...ingredients,...subs.flatMap(s=>s.ingredients)])),notes:String(structured?base.notes:(x.notes||base.notes||'')),ingredients,steps,bakingSteps,subRecipes:subs,warnings:[...new Set([...(base.warnings||[]),...(Array.isArray(x.warnings)?x.warnings:[])].map(String))]});
}
async function parseRecipeWithAI(text){if(!cloud.client||!cloud.user)return null;try{const {data,error}=await cloud.client.functions.invoke('parse-recipe',{body:{text}});if(error)throw error;return data?.recipe||data}catch(e){console.warn('AI recipe import unavailable; using local parser.',e);return null}}


/* v8.3 — מנוע ייצור דינמי, זמינות, הכנות מוקדמות ותלויות */
const DAY_NAMES=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function textMinutes(text){const n=cleanIngredientName(text),hour=n.match(/(\d+(?:[.,]\d+)?)\s*(?:שעה|שעות)/),mins=n.match(/(\d+)\s*(?:דקות|דק)/);return Math.round((hour?Number(hour[1].replace(',','.'))*60:0)+(mins?Number(mins[1]):0))}
function isPassiveText(text){return /קירור|מנוחה|מצננ|התקרר|הקפא|ייבוש|מתייצב|להתקשות|מחכים|ממתינים/.test(cleanIngredientName(text))}
function isPreprepText(text){return /קליית|קולים|טופי|קרמל|מילוי|קרם|ציפוי|רוטב|הכנה מראש|שבבים|הפשר/.test(cleanIngredientName(text))}
function groupedWorkflowFromRecipe(r){
  if(r.productionTasks?.length)return r.productionTasks.map((t,i)=>({...t,id:t.id||id('flow'),order:i}));
  const tasks=[];let prev='';
  const add=(title,type,activeMin,passiveMin=0,opt={})=>{const t={id:id('flow'),title,type,activeMin,passiveMin,canPrepareDays:opt.canPrepareDays||0,freshnessDays:opt.freshnessDays||r.shelfLifeDays||0,dependsOn:prev,notes:opt.notes||'',isPreprep:!!opt.isPreprep,order:tasks.length};tasks.push(t);prev=t.id;return t};
  add('בדיקת מלאי ורשימת חוסרים','shop',15,0,{canPrepareDays:7,isPreprep:true});
  add('קניות או הזמנת חומרי גלם ואריזות','shop',40,0,{canPrepareDays:6,isPreprep:true});
  (r.subRecipes||[]).forEach(sub=>{
    const active=Math.max(15,Number(sub.prepMin||25));
    add(`הכנה מקדימה: ${sub.name}`,'sub',active,Math.max(0,Number(sub.restMin||0)),{canPrepareDays:Math.max(1,Number(sub.canPrepareDays||3)),isPreprep:true,notes:'תת־מתכון שחייב להיות מוכן לפני המתכון הראשי'});
  });
  const allSteps=[...(r.steps||[])];
  const prepSteps=allSteps.filter(x=>!isPassiveText(x.text)&&!/^שלב\s*\d+/i.test(String(x.text||'')));
  const passiveSteps=allSteps.filter(x=>isPassiveText(x.text));
  const toast=prepSteps.find(x=>/קול(?:ים|ה)|שקדים.*תנור/.test(cleanIngredientName(x.text)));
  if(toast)add('הכנה מקדימה: קליית שקדים','prep',Math.max(10,textMinutes(toast.text)||15),20,{canPrepareDays:2,isPreprep:true,notes:toast.text});
  if(prepSteps.length)add('שקילה, הכנת עמדת עבודה והכנת התערובת','prep',Math.max(25,Number(r.prepMin||40)),0,{notes:prepSteps.map(x=>x.text).join('\n')});
  passiveSteps.forEach((st,i)=>add(st.text,'prep',5,Math.max(10,textMinutes(st.text)||30),{notes:'זמן פסיבי — אפשר לשבץ משימות אחרות במקביל'}));
  const bakeSteps=(r.bakingSteps||[]).length?r.bakingSteps:[...(r.steps||[]).filter(x=>/אופ|תנור/.test(cleanIngredientName(x.text)))];
  bakeSteps.forEach((st,i)=>add(`אפייה${bakeSteps.length>1?` ${i+1}`:''}: ${st.text}`,'bake',Math.max(10,Number(st.durationMin||textMinutes(st.text)||r.bakeMin||20)),0,{notes:st.text}));
  if(!bakeSteps.length&&r.bakeMin)add('אפייה','bake',Math.max(10,Number(r.bakeMin)),0);
  add('צינון מלא לפני אריזה','prep',5,Math.max(15,Number(r.coolingMin||20)),{notes:'זמן פסיבי'});
  add('שקילה, חלוקה לשקיות, אריזה ותיוג','pack',Math.max(25,Math.ceil(recipeYieldBags(r)*2.5)),0);
  add('בדיקת איכות וספירה סופית','pack',15,0);
  add('ניקיון וסגירת תחנת העבודה','clean',20,0);
  return tasks;
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
  const workflow=groupedWorkflowFromRecipe(r),due=new Date(o.dueAt),buffer=Number(state.settings.planningBufferMin||120),finish=new Date(due.getTime()-buffer*60000),base=`${o.id}|${r.id}`,tasks=[];let cursor=finish;
  for(let i=workflow.length-1;i>=0;i--){const w=workflow[i],passive=Math.max(0,Number(w.passiveMin||0));if(passive)cursor=new Date(cursor.getTime()-passive*60000);const slot=previousAvailableSlot(cursor,Math.max(5,Number(w.activeMin||20)));if(!slot){tasks.push({unscheduled:true,key:`${base}|flow-${i}`,text:w.title,date:dayKey(cursor),time:'',duration:w.activeMin,type:w.type,recipe:r.name,customer:o.customer,source:r.name,orderKey:base,seq:i,passiveMin:passive,isPreprep:w.isPreprep});continue}tasks.push({key:`${base}|flow-${i}`,date:dayKey(slot.start),time:timeFromMinutes(slot.start.getHours()*60+slot.start.getMinutes()),text:w.title,type:w.type,duration:w.activeMin,passiveMin:passive,recipe:r.name,customer:o.customer,batches:Math.ceil(Number(it.qty||0)/recipeYieldBags(r)),qty:Number(it.qty||0),source:r.name,done:!!state.checkedTasks[`${base}|flow-${i}`],manual:false,orderKey:base,seq:i,dependsOn:i?`${base}|flow-${i-1}`:'',isPreprep:w.isPreprep,notes:w.notes||'',endAt:slot.end.toISOString()});cursor=slot.start}
  return tasks.reverse();
}
function applyOverridesAndBlocks(out){out.forEach(t=>{const ov=state.planOverrides[t.key]||{};if(ov.date)t.date=ov.date;if(ov.time)t.time=ov.time;if(ov.duration)t.duration=Number(ov.duration);if(ov.passiveMin!=null)t.passiveMin=Number(ov.passiveMin);if(ov.done!=null)t.done=!!ov.done});return out}
function shiftTaskChain(key,newDate,newTime,newDuration){const tasks=generatedTasks().filter(t=>t.orderKey),target=tasks.find(t=>t.key===key);if(!target)return;const chain=tasks.filter(t=>t.orderKey===target.orderKey&&t.seq>=target.seq).sort((a,b)=>a.seq-b.seq);let cursor=dateAt(newDate,newTime);chain.forEach((t,index)=>{const duration=index===0?newDuration:Number(t.duration||20),slot=nextAvailableSlot(cursor,duration);state.planOverrides[t.key]={...(state.planOverrides[t.key]||{}),date:dayKey(slot.start),time:timeFromMinutes(slot.start.getHours()*60+slot.start.getMinutes()),duration};cursor=new Date(slot.end.getTime()+Number(t.passiveMin||0)*60000)})}
function availabilityModal(){const rows=DAY_NAMES.map((name,day)=>{const vals=state.settings.weeklyAvailability?.[day]||[];return`<div class="availability-day"><strong>${name}</strong><div id="avail-${day}">${vals.map(v=>availabilityRow(day,v)).join('')}</div><button type="button" class="btn small ghost" onclick="App.addAvailability(${day})">+ חלון</button></div>`}).join('');modal('הזמינות שלי',`<form id="availabilityForm"><div class="notice">הגדירי חלונות שבהם את זמינה לעבודה וחסימות כמו משרד, נסיעה או פגישה. התכנון ישתמש בהם אוטומטית.</div><div class="availability-grid">${rows}</div><div class="field" style="margin-top:14px"><label>מרווח ביטחון לפני משלוח (דקות)</label><input name="buffer" type="number" min="0" step="15" value="${Number(state.settings.planningBufferMin||120)}"></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה ובנייה מחדש</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('availabilityForm').onsubmit=async e=>{e.preventDefault();const form=e.target,next={};for(let day=0;day<7;day++){next[day]=[...form.querySelectorAll(`[data-day="${day}"]`)].map(row=>({start:row.querySelector('[name=start]').value,end:row.querySelector('[name=end]').value,available:row.querySelector('[name=kind]').value==='available',label:row.querySelector('[name=label]').value||''})).filter(x=>x.start&&x.end&&x.end>x.start)}state.settings.weeklyAvailability=next;state.settings.planningBufferMin=Number(new FormData(form).get('buffer')||120);state.planOverrides={};await persist();close();render()}}
function availabilityRow(day,v={start:'09:00',end:'17:00',available:true,label:'זמינה'}){return`<div class="availability-row" data-day="${day}"><input name="start" type="time" value="${esc(v.start)}"><span>–</span><input name="end" type="time" value="${esc(v.end)}"><select name="kind"><option value="available" ${v.available!==false?'selected':''}>זמינה</option><option value="blocked" ${v.available===false?'selected':''}>חסומה</option></select><input name="label" value="${esc(v.label||'')}" placeholder="משרד / נסיעה / אפייה"><button type="button" class="icon-btn" onclick="this.closest('.availability-row').remove()">×</button></div>`}
function workflowEditor(recipeId){const r=recipe(recipeId);if(!r)return;const tasks=groupedWorkflowFromRecipe(r);modal(`תהליך הייצור — ${r.name}`,`<form id="workflowForm"><div class="notice">זהו התהליך שהלוח ישבץ. אפשר לאחד, לשנות זמן פעיל/פסיבי ולסמן הכנה מקדימה.</div><div id="workflowRows">${tasks.map(workflowRow).join('')}</div><div class="actions"><button type="button" class="btn small ghost" onclick="App.addWorkflowTask()">+ משימה</button><button class="btn">שמירת תהליך</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('workflowForm').onsubmit=async e=>{e.preventDefault();r.productionTasks=[...e.target.querySelectorAll('.workflow-row')].map((row,i)=>({id:row.dataset.id||id('flow'),title:row.querySelector('[name=title]').value,type:row.querySelector('[name=type]').value,activeMin:Number(row.querySelector('[name=active]').value||0),passiveMin:Number(row.querySelector('[name=passive]').value||0),canPrepareDays:Number(row.querySelector('[name=days]').value||0),isPreprep:row.querySelector('[name=pre]').checked,dependsOn:i?e.target.querySelectorAll('.workflow-row')[i-1].dataset.id:'',notes:row.querySelector('[name=notes]').value}));state.planOverrides={};await persist();close();render()}}
function workflowRow(t={}){return`<div class="workflow-row" data-id="${esc(t.id||id('flow'))}"><div class="field workflow-title"><label>משימה</label><input name="title" value="${esc(t.title||'')}" required></div><div class="field"><label>סוג</label><select name="type">${Object.entries(TASK_TYPES).map(([k,v])=>`<option value="${k}" ${t.type===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>זמן פעיל</label><input name="active" type="number" min="0" step="5" value="${Number(t.activeMin||20)}"></div><div class="field"><label>זמן פסיבי</label><input name="passive" type="number" min="0" step="5" value="${Number(t.passiveMin||0)}"></div><div class="field"><label>ימים מראש</label><input name="days" type="number" min="0" step="1" value="${Number(t.canPrepareDays||0)}"></div><label class="check-field"><input name="pre" type="checkbox" ${t.isPreprep?'checked':''}> הכנה מקדימה</label><div class="field workflow-notes"><label>הערות</label><input name="notes" value="${esc(t.notes||'')}"></div><button type="button" class="icon-btn" onclick="this.closest('.workflow-row').remove()">×</button></div>`}
function initTabOrder(){const tabs=document.getElementById('tabs'),order=state.settings.tabOrder||[];if(!tabs||!order.length)return;const map=new Map([...tabs.querySelectorAll('button[data-view]')].map(b=>[b.dataset.view,b]));order.forEach(v=>{if(map.has(v))tabs.appendChild(map.get(v))});}
function tabOrderEditor(){const tabs=[...document.querySelectorAll('#tabs button[data-view]')];modal('סידור לשוניות',`<div class="notice">גררי את השורות לסדר הרצוי. הסדר יישמר במכשיר ובענן.</div><div id="tabOrderList" class="tab-order-list">${tabs.map(b=>`<div class="tab-order-item" draggable="true" data-view="${b.dataset.view}"><span>⋮⋮</span><strong>${esc(b.textContent.trim())}</strong></div>`).join('')}</div><div class="actions"><button class="btn" onclick="App.saveTabOrder()">שמירה</button><button class="btn ghost" onclick="App.resetTabOrder()">איפוס</button></div>`);let drag=null;document.querySelectorAll('.tab-order-item').forEach(el=>{el.ondragstart=()=>drag=el;el.ondragover=e=>{e.preventDefault();const r=el.getBoundingClientRect();el.parentElement.insertBefore(drag,e.clientY<r.top+r.height/2?el:el.nextSibling)}})}

/* תכנון שבועי */
function inferTaskType(text){const n=cleanIngredientName(text);if(/קני|מלאי|הזמנת חומר/.test(n))return'shop';if(/טופי|תת מתכון|קרם|מילוי/.test(n))return'sub';if(/אופ|תנור/.test(n))return'bake';if(/אריז|שקיל|תיוג|מדבקה/.test(n))return'pack';if(/מסיר|איסוף|משלוח/.test(n))return'delivery';if(/ניקי/.test(n))return'clean';return'prep'}
function estimateDuration(text,r,sub=null){const n=cleanIngredientName(text);if(/בדיקת מלאי/.test(n))return20;if(/רשימת קניות|קניות/.test(n))return45;if(/אריז/.test(n))return45;if(/ניקי/.test(n))return25;if(/מסיר|משלוח/.test(n))return30;if(/אופ/.test(n))return Math.max(15,Number(sub?.bakeMin||r?.bakeMin||30));return Math.max(20,Math.round(Number(sub?.prepMin||r?.prepMin||40)/Math.max(1,(sub?.steps||r?.steps||[]).length||1)))}
function generatedTasks(){
  let out=[];
  activeOrders().forEach(o=>{
    (o.items||[]).forEach(it=>{const r=recipe(it.recipeId);if(r)out.push(...scheduleOrderBackward(o,it,r))});
    const due=new Date(o.dueAt),deliveryKey=`${o.id}|delivery`,items=(o.items||[]).map(it=>({recipe:recipe(it.recipeId),qty:Number(it.qty||0)})).filter(x=>x.recipe),totalBags=items.reduce((sum,x)=>sum+x.qty,0),names=items.map(x=>`${x.recipe.name} × ${fmt(x.qty,0)}`).join(' · ');
    out.push({key:deliveryKey,date:dayKey(due),time:String(o.dueAt||'').slice(11,16),text:`${o.delivery==='משלוח'?'משלוח':'מסירה'} ל${o.customer}`,type:'delivery',duration:30,passiveMin:0,recipe:'כל ההזמנה',customer:o.customer,batches:0,qty:totalBags,source:names,notes:names,done:!!state.checkedTasks[deliveryKey],manual:false,orderKey:`${o.id}|delivery`,seq:9999,dependsOn:''});
  });
  (state.manualTasks||[]).forEach(t=>out.push({...t,done:!!state.checkedTasks[t.key],manual:true,orderKey:t.orderKey||'',seq:Number(t.seq||0),passiveMin:Number(t.passiveMin||0)}));
  applyOverridesAndBlocks(out);
  return out.sort((a,b)=>(a.date+(a.time||'99:99')).localeCompare(b.date+(b.time||'99:99'))||Number(a.seq||0)-Number(b.seq||0));
}
function workdayCapacity(date=dayKey(new Date())){return availabilityForDate(date).reduce((a,s)=>a+(s.end-s.start)/60000,0)}
function weekStart(value){const d=new Date(value);d.setHours(12,0,0,0);d.setDate(d.getDate()-d.getDay());return d}
function plannerSuggestions(tasks){const by={};tasks.forEach(t=>(by[t.date]||(by[t.date]=[])).push(t));const overloaded=Object.entries(by).filter(([date,list])=>list.reduce((a,t)=>a+Number(t.duration||0),0)>workdayCapacity(date)),unscheduled=tasks.filter(t=>t.unscheduled).length;const missing=activeOrders().filter(o=>new Date(o.dueAt)<new Date()).length;const parts=[];if(unscheduled)parts.push(`${unscheduled} משימות לא נכנסו לחלונות הזמינות`);if(overloaded.length)parts.push(`${overloaded.length} ימים עמוסים מעבר לשעות העבודה שהוגדרו`);if(shopping().length)parts.push(`${shopping().length} חומרי גלם חסרים כרגע`);if(missing)parts.push(`${missing} הזמנות שמועדן עבר`);return parts.length?parts.join(' · '):'התוכנית מתאימה לחלונות הזמינות, כוללת הכנות מקדימות ומשאירה מרווח ביטחון לפני המשלוח.'}

function go(view){currentView=view;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${view}`));document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view===view));render();const active=document.querySelector(`#tabs button[data-view="${view}"]`);active?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});window.scrollTo({top:0,behavior:'smooth'})}
function openPlanner(){plannerMode='week';plannerWeekOffset=0;go('planner')}
function modal(title,html){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=html;document.getElementById('modal').classList.add('open')}
function close(){document.getElementById('modal').classList.remove('open')}
function render(){document.getElementById('brandTitle').textContent=state.settings.businessName||'Bakery Workspace';({dashboard:renderDashboard,orders:renderOrders,invoices:renderInvoices,todo:renderTodo,planner:renderPlanner,assistant:renderAssistant,recipes:renderRecipes,recipebook:renderRecipeBook,production:renderProduction,shopping:renderShopping,inventory:renderInventory,suppliers:renderSuppliers,reports:renderReports,settings:renderSettings}[currentView]||renderDashboard)()}

function taskHtml(t){return`<div class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="App.toggleTask('${esc(t.key)}')"><div class="task-text"><strong>${esc(t.text)}</strong><div class="meta">${esc(t.recipe)} · ${t.batches} כפולות · ${fmt(t.qty,0)} שקיות · ${esc(t.customer)} ${t.time?'· '+esc(t.time):''}</div></div></div>`}
function managedTaskHtml(t){return`<div class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="App.toggleTask('${esc(t.key)}')"><div class="task-text" role="button" tabindex="0" onclick="App.editPlanTask('${esc(t.key)}')"><strong>${esc(t.text)}</strong><div class="meta">${esc(t.recipe)} · ${t.batches||0} כפולות · ${fmt(t.qty||0,0)} שקיות · ${esc(t.customer||'')} ${t.time?'· '+esc(t.time):''}</div></div><button class="btn small ghost" onclick="App.editPlanTask('${esc(t.key)}')">עריכה</button></div>`}
function renderDashboard(){
  const os=activeOrders(),ts=generatedTasks(),today=dayKey(new Date()),low=state.inventory.filter(i=>inventoryTotal(i)<=inventoryMinTotal(i)).length,up=os.slice().sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,5),todayTasks=ts.filter(t=>t.date===today&&!t.done),bags=os.reduce((sum,o)=>sum+(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0),0),heroMessage=heroMessageForSession();
  document.getElementById('view-dashboard').innerHTML=`<section class="hero"><div class="hero-copy"><div class="recipe-card-kicker">Luxury Bakery Studio</div><div class="hero-message"><h2 id="heroTitle">${esc(heroMessage.title)}</h2><p id="heroSubtitle">${esc(heroMessage.text)}</p></div><div class="hint" style="color:#f2dfcf;margin:10px 0 0">${new Date().toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})}</div><div class="actions"><button class="btn secondary" onclick="App.openPlanner()">פתיחת תכנון השבוע</button><button class="btn ghost" onclick="App.newOrder()">הזמנה חדשה</button></div></div><div class="hero-stats"><div class="hero-stat"><strong>${todayTasks.length}</strong><span>משימות פתוחות היום</span></div><div class="hero-stat"><strong>${bags}</strong><span>שקיות בהזמנות פעילות</span></div><div class="hero-stat"><strong>${shopping().length}</strong><span>חוסרים לקנייה</span></div><div class="hero-stat"><strong>${os.length}</strong><span>הזמנות פעילות</span></div></div></section>
  <div class="grid four" style="margin-top:16px"><div class="metric"><div class="label">הזמנות פעילות</div><div class="value">${os.length}</div></div><div class="metric"><div class="label">הכנסה צפויה</div><div class="value">${money(os.reduce((s,o)=>s+revenue(o),0))}</div></div><div class="metric"><div class="label">משימות להיום</div><div class="value">${todayTasks.length}</div></div><div class="metric"><div class="label">מלאי נמוך</div><div class="value">${low}</div></div></div>
  <div class="grid two" style="margin-top:16px"><div class="card"><div class="section-head"><h2>הזמנות קרובות</h2><button class="btn small secondary" onclick="App.newOrder()">+ הזמנה</button></div>${up.length?`<div class="list">${up.map(o=>`<div class="list-item"><div class="item-row"><div><div class="title">${esc(o.customer)}</div><div class="meta">${dateText(o.dueAt)} · ${esc(o.status)} · ${money(revenue(o))}</div></div><span class="badge rose">${esc(o.delivery)}</span></div></div>`).join('')}</div>`:'<div class="empty">אין הזמנות פעילות</div>'}</div><div class="card"><div class="section-head"><h2>היום בייצור</h2><button class="btn small ghost" onclick="App.go('planner')">לכל השבוע</button></div>${ts.filter(t=>t.date===today).map(taskHtml).join('')||'<div class="empty">אין משימות להיום</div>'}</div></div>
  <div class="grid two" style="margin-top:16px"><div class="card"><h2>קניות נדרשות</h2>${shopping().slice(0,6).map(i=>`<div class="kpi-line"><span>${esc(i.name)}</span><strong>${showQty(i.need,i.unit)}</strong></div>`).join('')||'<div class="empty">אין חוסרים</div>'}</div><div class="card"><h2>פעולות מהירות</h2><div class="actions" style="margin-top:14px"><button class="btn" onclick="App.newRecipe()">מתכון חדש</button><button class="btn secondary" onclick="App.importRecipe()">✨ הדבקת מתכון</button><button class="btn ghost" onclick="App.newInventory()">עדכון מלאי</button></div></div></div>`;
  revealHeroMessage();
}

function renderOrders(){const rows=state.orders.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));document.getElementById('view-orders').innerHTML=`<div class="card"><div class="section-head"><div><h2>הזמנות</h2><div class="hint">הכמות בכל מוצר היא מספר שקיות. אפשר לשכפל הזמנה קבועה לשבוע הבא ואז לערוך רק את מה שהשתנה.</div></div><button class="btn secondary" onclick="App.newOrder()">+ הזמנה חדשה</button></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>לקוחה</th><th>מועד</th><th>שקיות</th><th>סטטוס</th><th>תשלום</th><th>סכום</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td><strong>${esc(o.customer)}</strong>${o.recurringWeekly?'<div><span class="badge gold">הזמנה שבועית</span></div>':''}<div class="muted">${esc(o.phone||'')}</div></td><td>${dateText(o.dueAt)}<div class="muted">${esc(o.delivery)}</div></td><td>${(o.items||[]).map(i=>`${esc(recipe(i.recipeId)?.name||'מתכון נמחק')} × ${fmt(i.qty,0)} שקיות`).join('<br>')}</td><td><span class="badge">${esc(o.status)}</span></td><td>${o.paid?'<span class="badge green">שולם</span>':'<span class="badge red">לא שולם</span>'}</td><td class="money">${money(revenue(o))}</td><td><div class="actions"><button class="btn small secondary" onclick="App.repeatOrderNextWeek('${o.id}')">לשבוע הבא</button><button class="btn small secondary" onclick="App.invoiceFromOrder('${o.id}')">חשבונית</button><button class="btn small ghost" onclick="App.editOrder('${o.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteOrder('${o.id}')">מחיקה</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">עדיין אין הזמנות</div>'}</div>`}
function orderRow(i){return`<div class="repeat-row order-item-row"><div class="field"><label>מתכון</label><select class="oi-r" required><option value="">בחירה</option>${state.recipes.map(r=>`<option value="${r.id}" ${i.recipeId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>מספר שקיות</label><input class="oi-q" type="number" min="1" step="1" value="${i.qty||1}"></div><div></div><div></div><button type="button" class="btn small danger" onclick="this.closest('.order-item-row').remove()">הסר</button></div>`}
function orderForm(o={id:'',customer:'',phone:'',dueAt:'',delivery:'איסוף עצמי',status:'חדשה',paid:false,notes:'',items:[],recurringWeekly:false,seriesId:''}){modal(o.id?'עריכת הזמנה':'הזמנה חדשה',`<form id="orderForm"><input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="seriesId" value="${esc(o.seriesId||'')}"><div class="form-grid"><div class="field"><label>שם הלקוחה</label><input name="customer" required value="${esc(o.customer)}"></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(o.phone)}"></div><div class="field"><label>מועד אספקה</label><input name="dueAt" type="datetime-local" required value="${esc((o.dueAt||'').slice(0,16))}"></div><div class="field"><label>מסירה</label><select name="delivery">${['איסוף עצמי','משלוח'].map(x=>`<option ${o.delivery===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>סטטוס</label><select name="status">${STATUSES.map(x=>`<option ${o.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>תשלום</label><select name="paid"><option value="false" ${!o.paid?'selected':''}>לא שולם</option><option value="true" ${o.paid?'selected':''}>שולם</option></select></div><div class="field full"><label style="display:flex;align-items:center;gap:9px"><input type="checkbox" name="recurringWeekly" ${o.recurringWeekly?'checked':''}> הזמנה שבועית קבועה</label><div class="hint">לא נוצרת סדרה אוטומטית. בכל שבוע לוחצים „לשבוע הבא”, וכל הפרטים מועתקים; אחר כך אפשר לערוך רק את ההזמנה החדשה.</div></div><div class="field full"><label>מוצרים ומספר שקיות</label><div id="orderItems">${(o.items.length?o.items:[{recipeId:'',qty:1}]).map(orderRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addOrderItem()">+ מוצר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(o.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('orderForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.orders.find(x=>x.id===f.get('id')),items=[...document.querySelectorAll('.order-item-row')].map(r=>({recipeId:r.querySelector('.oi-r').value,qty:Math.max(1,Math.floor(Number(r.querySelector('.oi-q').value||0)))})).filter(x=>x.recipeId&&x.qty);if(!items.length)return alert('יש להוסיף מוצר');const x={id:f.get('id')||id('ord'),customer:f.get('customer'),phone:f.get('phone'),dueAt:f.get('dueAt'),delivery:f.get('delivery'),status:f.get('status'),paid:f.get('paid')==='true',notes:f.get('notes'),items,recurringWeekly:f.get('recurringWeekly')==='on',seriesId:f.get('seriesId')||ex?.seriesId||'',createdAt:ex?.createdAt||new Date().toISOString()};if(x.recurringWeekly&&!x.seriesId)x.seriesId=id('series');if(ex)Object.assign(ex,x);else state.orders.push(x);await persist();close();render()}}


function plannerDayRange(date){
  const d=new Date(date+'T12:00'),day=d.getDay(),rows=state.settings.weeklyAvailability?.[day]||[];
  const available=rows.filter(x=>x.available!==false&&x.start&&x.end&&x.end>x.start);
  const start=available.length?Math.min(...available.map(x=>minutesFromTime(x.start))):minutesFromTime(state.settings.workStart||'08:00');
  const end=available.length?Math.max(...available.map(x=>minutesFromTime(x.end))):minutesFromTime(state.settings.workEnd||'20:00');
  return{start:Math.max(0,start),end:Math.max(start+60,end)};
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
  if(t.orderKey)shiftTaskChain(key,date,time||t.time,t.duration);
  else state.planOverrides[key]={...(state.planOverrides[key]||{}),date,time:time||t.time};
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
  const controls=`<div class="planner-toolbar"><div><h2>תכנון שבועי ויומי</h2><div class="hint">גררי משימה ליום אחר, סמני ביצוע או פתחי אותה לשינוי שעה ומשך.</div></div><div class="actions"><button class="btn small ghost" onclick="App.plannerPrev()">‹ שבוע קודם</button><button class="btn small ghost" onclick="App.plannerToday()">השבוע</button><button class="btn small ghost" onclick="App.plannerNext()">שבוע הבא ›</button><button class="btn small secondary" onclick="App.buildPlan()">✨ בנה לי שבוע עבודה</button><button class="btn small" onclick="App.newManualTask()">+ משימה ידנית</button><button class="btn small ghost" onclick="window.print()">הדפסה</button></div></div>`;
  const toggle=`<div class="inner-tabs"><button class="${plannerMode==='week'?'active':''}" onclick="App.setPlannerMode('week')">שבוע</button><button class="${plannerMode==='day'?'active':''}" onclick="App.setPlannerMode('day')">יום</button></div>`;
  let body='';
  if(plannerMode==='week'){
    body=`<div class="planner-week">${days.map(d=>{const key=dayKey(d),list=tasks.filter(t=>t.date===key),minutes=list.reduce((a,t)=>a+Number(t.duration||0),0),over=minutes>workdayCapacity(key);return`<section class="planner-day ${over?'overload':''} ${key===today?'today':''}" data-date="${key}" ondragover="App.dragOverPlanTask(event,'${key}')" ondragleave="if(!this.contains(event.relatedTarget))App.clearPlannerDropHint()" ondrop="App.dropPlanTaskAt(event,'${key}')"><div class="planner-day-head"><strong>${d.toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric'})}</strong><span>${Math.round(minutes/60*10)/10} שעות${over?' ⚠':''}</span></div><div class="planner-day-body">${list.map(planCardHtml).join('')||'<div class="muted" style="text-align:center;padding:20px 4px">פנוי</div>'}</div></section>`}).join('')}</div>`;
  }else{
    const list=tasks.filter(t=>t.date===plannerDay);body=`<div class="card"><div class="section-head"><div><h2>סדר היום</h2><div class="hint">${new Date(plannerDay+'T12:00').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})}</div></div><input type="date" value="${plannerDay}" onchange="App.setPlannerDay(this.value)"></div><div class="planner-day-list">${list.map(t=>`<div class="day-agenda-row"><strong>${esc(t.time)}</strong><div>${planCardHtml(t)}</div></div>`).join('')||'<div class="empty">אין משימות ביום הזה</div>'}</div></div>`;
  }
  document.getElementById('view-planner').innerHTML=`${controls}<div class="notice ${plannerSuggestions(tasks).includes('עמוסים')?'warning':'success'}">${esc(plannerSuggestions(tasks))}</div><div class="planner-legend"><span class="badge">קניות</span><span class="badge gold">תת־מתכון</span><span class="badge rose">אפייה ואריזה</span><span class="badge green">מסירה</span></div>${toggle}${body}`;
}
function planCardHtml(t){return`<article class="plan-card type-${esc(t.type)} ${t.done?'done':''}" draggable="true" ondragstart="App.dragPlanTask(event,'${esc(t.key)}')" onpointerdown="App.startTouchPlanDrag(event,'${esc(t.key)}')" onpointermove="App.moveTouchPlanDrag(event)" onpointerup="App.endTouchPlanDrag(event)" onpointercancel="App.endTouchPlanDrag(event)" oncontextmenu="return false" onclick="if(Date.now()-lastPlanDragEnd>500)App.editPlanTask('${esc(t.key)}')"><div class="plan-time">${esc(t.time||'לא שובץ')} · ${fmt(t.duration,0)} דק׳ פעיל${t.passiveMin?` · ${fmt(t.passiveMin,0)} דק׳ פסיבי`:''}</div><div class="plan-title">${t.isPreprep?'<span class="badge gold">הכנה מקדימה</span> ':''}${esc(t.text)}</div><div class="meta">${esc(t.recipe||'משימה אישית')}${t.customer?' · '+esc(t.customer):''}${t.source&&t.source!==t.recipe?' · '+esc(t.source):''}</div></article>`}
function editPlanTask(key){const task=generatedTasks().find(t=>t.key===key);if(!task)return;modal('עריכת משימה',`<form id="planTaskForm"><div class="notice"><strong>${esc(task.text)}</strong><br>${esc(task.recipe||'')} ${task.customer?'· '+esc(task.customer):''}${task.passiveMin?`<br>זמן פסיבי אחרי הפעולה: ${task.passiveMin} דקות`:''}</div><div class="form-grid" style="margin-top:12px"><div class="field"><label>תאריך</label><input name="date" type="date" value="${esc(task.date)}"></div><div class="field"><label>שעה</label><input name="time" type="time" value="${esc(task.time)}"></div><div class="field"><label>זמן פעיל בדקות</label><input name="duration" type="number" min="5" step="5" value="${task.duration||30}"></div><div class="field"><label>זמן פסיבי אחריו</label><input name="passive" type="number" min="0" step="5" value="${task.passiveMin||0}"></div><div class="field"><label>סטטוס</label><select name="done"><option value="false" ${!task.done?'selected':''}>פתוחה</option><option value="true" ${task.done?'selected':''}>בוצעה</option></select></div><div class="field"><label>אופן הזזה</label><select name="shift"><option value="chain">המשימה וכל המשימות שאחריה</option><option value="single">רק המשימה הזאת</option></select></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button>${task.manual?`<button type="button" class="btn danger" onclick="App.deleteManualTask('${esc(task.key)}')">מחיקה</button>`:''}<button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('planTaskForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),date=f.get('date'),time=f.get('time'),duration=Number(f.get('duration')||30),passive=Number(f.get('passive')||0);if(f.get('shift')==='chain'&&task.orderKey)shiftTaskChain(key,date,time,duration);else state.planOverrides[key]={...(state.planOverrides[key]||{}),date,time,duration,passiveMin:passive};state.checkedTasks[key]=f.get('done')==='true';await persist();close();render()}}
function manualTaskForm(){modal('משימה ידנית חדשה',`<form id="manualTaskForm"><div class="form-grid"><div class="field full"><label>משימה</label><input name="text" required placeholder="למשל: הדפסת מדבקות"></div><div class="field"><label>תאריך</label><input name="date" type="date" required value="${plannerDay||dayKey(new Date())}"></div><div class="field"><label>שעה</label><input name="time" type="time" value="${state.settings.workStart||'08:00'}"></div><div class="field"><label>משך בדקות</label><input name="duration" type="number" min="5" step="5" value="30"></div><div class="field"><label>סוג</label><select name="type">${Object.entries(TASK_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div></div><div class="actions" style="margin-top:14px"><button class="btn">הוספה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('manualTaskForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),key=id('manual');state.manualTasks.push({key,text:f.get('text'),date:f.get('date'),time:f.get('time'),duration:Number(f.get('duration')||30),type:f.get('type'),recipe:'',customer:'',batches:0,qty:0,source:'',manual:true});await persist();close();render()}}

function renderRecipes(){document.getElementById('view-recipes').innerHTML=`<div class="card"><div class="section-head"><div><h2>מתכונים</h2><div class="hint">ניהול מתכונים רגילים ומורכבים, תתי־מתכונים, משקל סופי ותפוקה בשקיות.</div></div><div class="actions"><button class="btn ghost" onclick="App.importRecipe()">✨ הדבקת מתכון</button><button class="btn secondary" onclick="App.newRecipe()">+ מתכון חדש</button></div></div>${state.recipes.length?`<div class="recipe-book-grid">${state.recipes.map(r=>{const p=packageSummary(r),c=recipeCost(r);return`<article class="recipe-card"><button class="recipe-card-main" onclick="App.editRecipe('${r.id}')"><div class="recipe-card-kicker">${r.subRecipes?.length?'מתכון מורכב':'מתכון רגיל'} · ${esc(r.category||'אחר')}</div><h3>${esc(r.name)}</h3><div class="recipe-card-meta"><span>${p.fullBags} שקיות × ${fmt(p.packageWeight,0)} גרם</span><span>יתרה ${showQty(p.remainder,'גרם')}</span><span>${money(c.perUnit)} עלות לשקית</span></div></button><div class="recipe-card-actions"><button class="btn small ghost" onclick="App.editRecipe('${r.id}')">עריכה</button><button class="btn small secondary" onclick="App.weightCalc('${r.id}')">התאמת כמות</button><button class="btn small ghost" onclick="App.workflowEditor('${r.id}')">תהליך ייצור</button>${(r.originalRecipeBase||Number(r.savedScaleFactor)>0)?`<button class="btn small ghost" onclick="App.resetRecipeOriginal('${r.id}')">חזרה למקור</button>`:''}<button class="btn small danger" onclick="App.deleteRecipe('${r.id}')">מחיקה</button></div></article>`}).join('')}</div>`:'<div class="empty">עדיין אין מתכונים. אפשר להדביק מתכון שלם והמערכת תחלק אותו לשדות ותציג אזהרות לבדיקה.</div>'}</div>`}
function ingredientRow(i={},sub=false){return`<div class="repeat-row ingredient-row ${sub?'sub-ingredient-row':''}"><div class="field"><label>רכיב</label><input class="ri-n" value="${esc(i.name||'')}"></div><div class="field"><label>כמות</label><input class="ri-q" type="number" min="0" step=".01" value="${i.qty??''}"></div><div class="field"><label>יחידה</label><select class="ri-u">${UNITS.map(u=>`<option ${i.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>קטגוריה</label><select class="ri-c">${CATS.map(c=>`<option ${i.category===c?'selected':''}>${c}</option>`).join('')}</select><input class="ri-link" type="hidden" value="${esc(i.linkedSubRecipeId||'')}"></div><button type="button" class="btn small danger" onclick="App.removeIngredient(this)">הסר</button></div>`}
function stepRow(s={},sub=false){return`<div class="repeat-row step-row ${sub?'sub-step-row':''}"><div class="field"><label>תיאור הפעולה</label><input class="rs-t" value="${esc(s.text||'')}"></div><div class="field"><label>ימים לפני מסירה</label><input class="rs-d" type="number" min="0" value="${s.daysBefore||0}"></div><div class="field"><label>שעה</label><input class="rs-h" type="time" value="${esc(s.time||'')}"></div><div class="field"><label>משך בדקות</label><input class="rs-m" type="number" min="0" step="5" value="${s.durationMin||0}"></div><button type="button" class="btn small danger" onclick="this.closest('.step-row').remove()">הסר</button></div>`}
function subRecipeCard(s={id:id('sub'),name:'תת־מתכון',usedQtyGrams:0,evaporationPct:0,prepMin:30,restMin:30,bakeMin:0,ovenTemp:0,notes:'',ingredients:[],steps:[]}){return`<section class="subrecipe-card" data-sub-id="${esc(s.id)}"><div class="subrecipe-head"><input class="sub-name" value="${esc(s.name)}" aria-label="שם תת־המתכון"><button type="button" class="btn small danger" onclick="this.closest('.subrecipe-card').remove();App.updateRecipeWeightPreview()">הסרת תת־מתכון</button></div><div class="form-grid three"><div class="field"><label>כמות מתת־המתכון שנכנסת למתכון הראשי — גרם</label><input class="sub-used" type="number" min="0" step=".01" value="${s.usedQtyGrams||0}"></div><div class="field"><label>אחוז אידוי</label><input class="sub-evap" type="number" min="0" max="100" step=".1" value="${s.evaporationPct||0}"></div><div class="field"><label>זמן הכנה פעיל</label><input class="sub-prep" type="number" min="0" value="${s.prepMin||0}"></div><div class="field"><label>מנוחה/קירור</label><input class="sub-rest" type="number" min="0" value="${s.restMin||0}"></div><div class="field"><label>זמן חימום/אפייה</label><input class="sub-bake" type="number" min="0" value="${s.bakeMin||0}"></div><div class="field"><label>טמפרטורה</label><input class="sub-temp" type="number" min="0" value="${s.ovenTemp||0}"></div><div class="field full"><label>מצרכי תת־המתכון</label><div class="sub-ingredients">${(s.ingredients.length?s.ingredients:[{name:'',qty:'',unit:'גרם',category:'אחר'}]).map(i=>ingredientRow(i,true)).join('')}</div><button type="button" class="btn small secondary" onclick="App.addSubIngredient(this)">+ רכיב לתת־מתכון</button></div><div class="field full"><label>שלבי תת־המתכון</label><div class="sub-steps">${(s.steps.length?s.steps:[{text:'',daysBefore:3,time:'',durationMin:0}]).map(x=>stepRow(x,true)).join('')}</div><button type="button" class="btn small secondary" onclick="App.addSubStep(this)">+ שלב לתת־מתכון</button></div><div class="field full"><label>הערות</label><textarea class="sub-notes">${esc(s.notes||'')}</textarea></div><div class="field full"><div class="sub-weight-preview notice"></div></div></div></section>`}
function readIngredientRows(container){return[...container.querySelectorAll(':scope > .ingredient-row')].map(x=>({name:x.querySelector('.ri-n').value.trim(),qty:Number(x.querySelector('.ri-q').value||0),unit:x.querySelector('.ri-u').value,category:x.querySelector('.ri-c').value,linkedSubRecipeId:x.querySelector('.ri-link')?.value||''})).filter(x=>x.name&&x.qty)}
function readStepRows(container){return[...container.querySelectorAll(':scope > .step-row')].map(x=>({text:x.querySelector('.rs-t').value.trim(),daysBefore:Number(x.querySelector('.rs-d').value||0),time:x.querySelector('.rs-h').value,durationMin:Number(x.querySelector('.rs-m').value||0)})).filter(x=>x.text)}
function readRecipeFormIngredients(){const c=document.getElementById('recipeIngredients');return c?readIngredientRows(c):[]}
function readSubRecipes(){return[...document.querySelectorAll('.subrecipe-card')].map(card=>({id:card.dataset.subId||id('sub'),name:card.querySelector('.sub-name').value.trim()||'תת־מתכון',usedQtyGrams:Number(card.querySelector('.sub-used').value||0),evaporationPct:Number(card.querySelector('.sub-evap').value||0),prepMin:Number(card.querySelector('.sub-prep').value||0),restMin:Number(card.querySelector('.sub-rest').value||0),bakeMin:Number(card.querySelector('.sub-bake').value||0),ovenTemp:Number(card.querySelector('.sub-temp').value||0),notes:card.querySelector('.sub-notes').value,ingredients:readIngredientRows(card.querySelector('.sub-ingredients')),steps:readStepRows(card.querySelector('.sub-steps'))}))}
function updateRecipeWeightPreview(){
  const form=document.getElementById('recipeForm'),box=document.getElementById('recipeWeightPreview');if(!form||!box)return;
  const ingredients=readRecipeFormIngredients(),evaporationPct=Number(form.elements.evaporationPct?.value||0),packageWeight=Math.max(1,Number(form.elements.packageWeight?.value||200)),w=calculateIngredientListWeight(ingredients,evaporationPct),p={fullBags:Math.floor(w.finalWeight/packageWeight),remainder:w.finalWeight%packageWeight};
  if(form.elements.yieldUnits)form.elements.yieldUnits.value=p.fullBags;if(form.elements.unitWeight)form.elements.unitWeight.value=packageWeight;
  box.innerHTML=w.rawWeight?`<strong>משקל המתכון הראשי:</strong> לפני אפייה ${showQty(w.rawWeight,'גרם')} · אידוי משוער ${showQty(w.evaporationLoss,'גרם')} · משקל סופי ${showQty(w.finalWeight,'גרם')}<br><strong>תפוקת אריזה:</strong> ${p.fullBags} שקיות מלאות × ${fmt(packageWeight,0)} גרם · יתרה ${showQty(p.remainder,'גרם')}${w.estimatedCount?`<div class="hint">החישוב כולל ${w.estimatedCount} המרות ביתיות משוערות.</div>`:''}${w.excluded.length?`<div class="hint">לא נמצאה המרה עבור: ${w.excluded.map(esc).join(', ')}.</div>`:''}`:'הוסיפי רכיבים וכמויות כדי לחשב משקל ותפוקת שקיות.';
  document.querySelectorAll('.subrecipe-card').forEach(card=>{const s={ingredients:readIngredientRows(card.querySelector('.sub-ingredients')),evaporationPct:Number(card.querySelector('.sub-evap').value||0)},sw=calculateSubRecipeWeight(s),used=Number(card.querySelector('.sub-used').value||0),batches=sw.finalWeight&&used?Math.ceil(used/sw.finalWeight):used?0:1,left=sw.finalWeight*batches-used;card.querySelector('.sub-weight-preview').innerHTML=sw.rawWeight?`תפוקת תת־המתכון: <strong>${showQty(sw.finalWeight,'גרם')}</strong>. נדרש במתכון הראשי: <strong>${showQty(used,'גרם')}</strong>${used?` · אצוות נדרשות: <strong>${batches}</strong> · יתרה: <strong>${showQty(Math.max(0,left),'גרם')}</strong>`:''}${sw.excluded.length?`<div class="hint">לא חושבו: ${sw.excluded.map(esc).join(', ')}</div>`:''}`:'הוסיפי מצרכים לתת־המתכון.'})
}
function recipeForm(raw={}){
  const r=migrateRecipe({id:'',name:'',category:'עוגיות',yieldUnits:1,packageWeight:200,unitWeight:200,prepMin:30,restMin:60,bakeMin:12,ovenTemp:175,traysPerBatch:1,unitsPerTray:12,shelfLifeDays:4,packagingCost:1,wastePct:5,evaporationPct:12,salePrice:12,allergens:'',notes:'',ingredients:[],steps:[],bakingSteps:[],subRecipes:[],warnings:[],...raw});
  modal(r.id?'עריכת מתכון':'מתכון חדש',`<form id="recipeForm"><input type="hidden" name="id" value="${esc(r.id)}"><div class="form-grid three"><div class="field"><label>שם המתכון</label><input name="name" required value="${esc(r.name)}"></div><div class="field"><label>קטגוריה</label><input name="category" value="${esc(r.category)}"></div><div class="field"><label>משקל יעד לשקית</label><input name="packageWeight" type="number" min="1" step="1" value="${r.packageWeight}"></div><div class="field"><label>מספר שקיות מלאות — מחושב</label><input name="yieldUnits" type="number" readonly value="${r.yieldUnits||0}"></div><div class="field"><label>משקל שקית — מחושב</label><input name="unitWeight" type="number" readonly value="${r.packageWeight}"></div><div class="field"><label>אחוז אידוי מהמים באפייה</label><input name="evaporationPct" type="number" min="0" max="100" step=".1" value="${r.evaporationPct}"><div class="hint">האחוז חל רק על המים המזוהים ברכיבים.</div></div><div class="field"><label>זמן הכנה פעיל</label><input name="prepMin" type="number" min="0" value="${r.prepMin||0}"></div><div class="field"><label>מנוחה/קירור</label><input name="restMin" type="number" min="0" value="${r.restMin||0}"></div><div class="field"><label>זמן אפייה</label><input name="bakeMin" type="number" min="0" value="${r.bakeMin||0}"></div><div class="field"><label>טמפרטורה</label><input name="ovenTemp" type="number" value="${r.ovenTemp||0}"></div><div class="field"><label>מגשים לאצווה</label><input name="traysPerBatch" type="number" min="1" value="${r.traysPerBatch||1}"></div><div class="field"><label>יחידות במגש</label><input name="unitsPerTray" type="number" min="1" value="${r.unitsPerTray||1}"></div><div class="field"><label>חיי מדף בימים</label><input name="shelfLifeDays" type="number" min="0" value="${r.shelfLifeDays||0}"></div><div class="field"><label>עלות אריזה לשקית</label><input name="packagingCost" type="number" step=".01" min="0" value="${r.packagingCost||0}"></div><div class="field"><label>אחוז בזבוז</label><input name="wastePct" type="number" min="0" value="${r.wastePct||0}"></div><div class="field"><label>מחיר מכירה לשקית</label><input name="salePrice" type="number" step=".01" min="0" value="${r.salePrice||0}"></div><div class="field"><label>אלרגנים</label><input name="allergens" value="${esc(r.allergens)}"></div>${r.warnings?.length?`<div class="field full"><div class="notice warning"><strong>נקודות לבדיקה מהייבוא:</strong><ul class="warning-list">${r.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div></div>`:''}<div class="field full"><label>מצרכי המתכון הראשי</label><div id="recipeIngredients">${(r.ingredients.length?r.ingredients:[{name:'',qty:'',unit:'גרם',category:'יבשים'}]).map(i=>ingredientRow(i,false)).join('')}</div><button type="button" class="btn small secondary" onclick="App.addIngredient()">+ רכיב</button></div><div class="field full"><div id="recipeWeightPreview" class="notice"></div></div><div class="field full"><div class="section-head"><div><label>שלב 1 — תת־מתכון והכנה מוקדמת</label><div class="hint">למשל טופי בייטס, קרם, מילוי או רוטב שצריך להכין לפני המתכון הראשי.</div></div><button type="button" class="btn small secondary" onclick="App.addSubRecipe()">+ תת־מתכון</button></div><div id="subRecipes">${(r.subRecipes||[]).map(subRecipeCard).join('')}</div></div><div class="field full"><label>שלב 2 — מתכון ראשי: אופן ההכנה</label><div id="recipeSteps">${(r.steps.length?r.steps:[{text:'',daysBefore:1,time:'',durationMin:0}]).map(s=>stepRow(s,false)).join('')}</div><button type="button" class="btn small secondary" onclick="App.addStep()">+ שלב</button></div><div class="field full"><label>שלב 2 — אפייה</label><div id="recipeBakingSteps">${(r.bakingSteps.length?r.bakingSteps:[{text:'',daysBefore:0,time:'',durationMin:0}]).map(s=>stepRow(s,false)).join('')}</div><button type="button" class="btn small secondary" onclick="App.addBakingStep()">+ שלב אפייה</button></div><div class="field full"><label>שלב 2 — הערות</label><textarea name="notes">${esc(r.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  const form=document.getElementById('recipeForm');form.addEventListener('input',updateRecipeWeightPreview);form.addEventListener('change',updateRecipeWeightPreview);updateRecipeWeightPreview();
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.recipes.find(x=>x.id===f.get('id')),ingredients=readRecipeFormIngredients(),steps=readStepRows(document.getElementById('recipeSteps')),bakingSteps=readStepRows(document.getElementById('recipeBakingSteps')),subRecipes=readSubRecipes(),packageWeight=Math.max(1,Number(f.get('packageWeight')||200));subRecipes.forEach(s=>{const mainIngredient=ingredients.find(i=>i.linkedSubRecipeId===s.id||ingredientNamesMatch(i.name,s.name));if(mainIngredient){mainIngredient.linkedSubRecipeId=s.id;s.usedQtyGrams=ingredientWeightData(mainIngredient).grams||s.usedQtyGrams}else if(s.usedQtyGrams>0){ingredients.push({name:s.name,qty:s.usedQtyGrams,unit:'גרם',category:'תוספות',linkedSubRecipeId:s.id})}});const weight=calculateIngredientListWeight(ingredients,Number(f.get('evaporationPct')||0)),fullBags=Math.floor(weight.finalWeight/packageWeight);const obj=migrateRecipe({id:f.get('id')||id('rec'),name:f.get('name'),category:f.get('category'),packageWeight,yieldUnits:Math.max(1,fullBags),unitWeight:packageWeight,evaporationPct:Number(f.get('evaporationPct')||0),prepMin:Number(f.get('prepMin')||0),restMin:Number(f.get('restMin')||0),bakeMin:Number(f.get('bakeMin')||0),ovenTemp:Number(f.get('ovenTemp')||0),traysPerBatch:Number(f.get('traysPerBatch')||1),unitsPerTray:Number(f.get('unitsPerTray')||1),shelfLifeDays:Number(f.get('shelfLifeDays')||0),packagingCost:Number(f.get('packagingCost')||0),wastePct:Number(f.get('wastePct')||0),salePrice:Number(f.get('salePrice')||0),allergens:f.get('allergens'),notes:f.get('notes'),ingredients,steps,bakingSteps,subRecipes,warnings:[]});if(ex)Object.assign(ex,obj);else state.recipes.push(obj);await persist();close();render()};
}
function scaledNumber(value,factor){return Number((Number(value||0)*factor).toFixed(4))}
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
  if(!r.originalRecipeBase&&Number(r.savedScaleFactor)>0){const reverse=1/Number(r.savedScaleFactor);r.originalRecipeBase={ingredients:(r.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,reverse)})),subRecipes:(r.subRecipes||[]).map(s=>({...s,usedQtyGrams:scaledNumber(s.usedQtyGrams,reverse),ingredients:(s.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,reverse)}))})),packageWeight:Number(r.packageWeight||200),unitWeight:Number(r.unitWeight||r.packageWeight||200),yieldUnits:Math.max(1,Math.round(Number(r.yieldUnits||1)*reverse)),capturedAt:new Date().toISOString(),reconstructed:true};}
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
  r.ingredients=(r.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,plan.factor)}));
  r.subRecipes=(r.subRecipes||[]).map(s=>({...s,usedQtyGrams:scaledNumber(s.usedQtyGrams,plan.factor),ingredients:(s.ingredients||[]).map(i=>({...i,qty:scaledNumber(i.qty,plan.factor)}))}));
  r.packageWeight=plan.pkg;r.unitWeight=plan.pkg;r.yieldUnits=Math.max(1,plan.bags);r.savedScaleAt=new Date().toISOString();r.savedScaleFactor=plan.factor;
  await persist();close();render();setStatus('✓ כמות השקיות נשמרה במתכון');setTimeout(()=>setStatus(''),1800)
}
function weightCalculator(r){
  if(!r)return;const base=calculateRecipeWeight(r);if(!base.finalWeight)return alert('לא ניתן לחשב משקל סופי לפני הזנת מצרכים ניתנים להמרה.');const p=packageSummary(r);
  modal(`התאמת ${r.name}`,`<div class="inner-tabs"><button class="active" onclick="App.scaleMode('weight',this)">לפי משקל סופי</button><button onclick="App.scaleMode('bags',this)">לפי מספר שקיות</button></div><div class="form-grid"><div class="field" id="scaleWeightField"><label>משקל סופי רצוי בק״ג</label><input id="targetWeightValue" type="number" min=".01" step=".01" value="${Math.round(base.finalWeight/10)/100}"></div><div class="field" id="scaleBagsField" hidden><label>מספר שקיות רצוי</label><input id="targetBagsValue" type="number" min="1" step="1" value="${Math.max(1,p.fullBags)}"></div><div class="field"><label>משקל לשקית</label><input id="targetPackageWeight" type="number" min="1" value="${p.packageWeight}"></div></div><div id="weightScaleSummary" class="notice" style="margin-top:12px"></div><div id="weightScaleResults" style="margin-top:12px"></div><div class="notice success" style="margin-top:12px">לחיצה על <strong>שמירת הכמות במתכון</strong> תהפוך את הכמויות המותאמות לבסיס הקבוע החדש. בפעם הראשונה נשמר גם עותק של הכמויות המקוריות.</div><div class="actions" style="margin-top:14px"><button class="btn" id="saveScaledRecipe" type="button">שמירת הכמות במתכון</button><button class="btn secondary" id="copyWeightPlan" type="button">העתקת רשימת מצרכים</button>${(r.originalRecipeBase||Number(r.savedScaleFactor)>0)?`<button class="btn ghost" type="button" onclick="App.resetRecipeOriginal('${r.id}')">החזרה לכמויות המקוריות</button>`:''}<button class="btn ghost" type="button" onclick="App.close()">סגירה</button></div>`);
  window.__scaleMode='weight';
  const update=()=>{const mode=window.__scaleMode||'weight',pkg=Math.max(1,Number(document.getElementById('targetPackageWeight').value||r.packageWeight||200)),targetGrams=mode==='bags'?Math.max(1,Number(document.getElementById('targetBagsValue').value||1))*pkg:Math.max(0,Number(document.getElementById('targetWeightValue').value||0))*1000,factor=targetGrams/base.finalWeight,rows=expandedIngredients(r).map(i=>({...i,scaledQty:Number(i.qty||0)*factor})),bags=Math.floor(targetGrams/pkg),rem=targetGrams-bags*pkg;window.__scalePlan={factor,targetGrams,pkg,bags,rem};document.getElementById('weightScaleSummary').innerHTML=`המתכון הנוכחי נותן <strong>${showQty(base.finalWeight,'גרם')}</strong>. יעד: <strong>${showQty(targetGrams,'גרם')}</strong> · מקדם <strong>${fmt(factor,3)}</strong> · ${bags} שקיות מלאות · יתרה ${showQty(rem,'גרם')}.`;document.getElementById('weightScaleResults').innerHTML=`<div class="table-wrap"><table><thead><tr><th>רכיב</th><th>כמות חדשה</th><th>מקור</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.name)}</td><td><strong>${fmt(i.scaledQty,2)} ${esc(i.unit)}</strong></td><td>${esc(i.sourceSubRecipe||'מתכון ראשי')}</td></tr>`).join('')}</tbody></table></div>`;window.__scaleCopy=`${r.name}\nמשקל סופי רצוי: ${showQty(targetGrams,'גרם')}\n${bags} שקיות × ${pkg} גרם\nמקדם: ${fmt(factor,3)}\n\n`+rows.map(i=>`${i.name}: ${fmt(i.scaledQty,2)} ${i.unit}${i.sourceSubRecipe?' ('+i.sourceSubRecipe+')':''}`).join('\n')};
  ['targetWeightValue','targetBagsValue','targetPackageWeight'].forEach(x=>document.getElementById(x).addEventListener('input',update));document.getElementById('copyWeightPlan').onclick=async()=>{try{await navigator.clipboard.writeText(window.__scaleCopy);document.getElementById('copyWeightPlan').textContent='✓ הועתק'}catch(e){alert(window.__scaleCopy)}};document.getElementById('saveScaledRecipe').onclick=()=>saveScaledRecipe(r.id);window.__updateScale=update;update()
}

function importRecipeModal(){modal('הדבקת מתכון חכמה',`<div class="field"><label>הדביקי את המתכון המלא</label><textarea id="recipeImportText" class="recipe-import-text" placeholder="שם המתכון\n\nתת־מתכון: טופי בייטס\n115 גרם חמאה...\n\nלעוגיות\n220 גרם קמח...\n\nאופן הכנה:\n..."></textarea><div class="hint">המערכת מפרידה בין מצרכים, פעולות, טיפים ותתי־מתכונים. היא מציגה סתירות וחוסרים לבדיקה ולא שומרת אוטומטית.</div></div><div id="recipeImportStatus"></div><div class="actions" style="margin-top:14px"><button class="btn secondary" type="button" onclick="App.analyzeRecipeImport()">ניתוח והצגת מסך בדיקה</button><button class="btn ghost" type="button" onclick="App.close()">ביטול</button></div>`);setTimeout(()=>document.getElementById('recipeImportText')?.focus(),50)}
async function analyzeRecipeImport(){const text=document.getElementById('recipeImportText')?.value.trim(),status=document.getElementById('recipeImportStatus');if(!text)return alert('יש להדביק מתכון');if(status)status.innerHTML='<div class="notice" style="margin-top:12px">מנתחת מצרכים, שלבים ותתי־מתכונים…</div>';const ai=await parseRecipeWithAI(text);pendingImport=sanitizeImportedRecipe(ai||localParseRecipe(text),text);reviewImportedRecipe(pendingImport)}
function reviewImportedRecipe(r){
  const totalIngredients=r.ingredients.length+r.subRecipes.reduce((a,s)=>a+s.ingredients.length,0),totalActions=r.steps.length+r.bakingSteps.length+r.subRecipes.reduce((a,s)=>a+s.steps.length,0);
  const subCards=r.subRecipes.map((s,i)=>`<div class="review-section"><div class="recipe-card-kicker">שלב ${i+1} · תת־מתכון</div><strong>${esc(s.name)}</strong><div class="meta">${s.ingredients.length} מצרכים · ${s.steps.length} פעולות · הערות ${s.notes?'כן':'לא'}</div><div class="muted" style="margin-top:8px">${s.ingredients.map(x=>`${fmt(x.qty)} ${esc(x.unit)} ${esc(x.name)}`).join(' · ')}</div></div>`).join('');
  const linked=r.ingredients.filter(i=>i.linkedSubRecipeId).map(i=>`<span class="badge green">↗ ${esc(i.name)} מקושר לתת־מתכון</span>`).join(' ');
  modal('בדיקת המתכון לפני שמירה',`${r.warnings?.length?`<div class="notice warning"><strong>נדרשת בדיקה:</strong><ul class="warning-list">${r.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:'<div class="notice success">לא נמצאו סתירות בולטות. עדיין מומלץ לעבור על הכמויות.</div>'}<div class="import-summary"><div><strong>${r.subRecipes.length+1}</strong><div class="muted">שלבים</div></div><div><strong>${totalIngredients}</strong><div class="muted">מצרכים</div></div><div><strong>${totalActions}</strong><div class="muted">פעולות</div></div><div><strong>${r.subRecipes.length}</strong><div class="muted">תתי־מתכונים</div></div></div>${subCards}<div class="review-section"><div class="recipe-card-kicker">שלב ${r.subRecipes.length+1} · מתכון ראשי</div><strong>${esc(r.name)}</strong><div class="meta">${r.ingredients.length} מצרכים · ${r.steps.length} פעולות הכנה · ${r.bakingSteps.length} פעולות אפייה · הערות ${r.notes?'כן':'לא'}</div><div style="margin-top:9px">${linked||'<span class="muted">לא נמצא קישור לתת־מתכון</span>'}</div></div><div class="actions"><button class="btn secondary" onclick="App.openPendingRecipe()">פתיחה לעריכה ושמירה</button><button class="btn ghost" onclick="App.close()">ביטול</button></div>`)
}
function recipeBookCard(r){const p=packageSummary(r);return`<article class="recipe-card" data-search="${esc((r.name+' '+r.category).toLowerCase())}" data-category="${esc(r.category||'אחר')}"><button class="recipe-card-main" onclick="App.openBookRecipe('${r.id}')"><div class="recipe-card-kicker">${esc(r.category||'מתכון')} ${r.subRecipes?.length?'· מורכב':''}</div><h3>${esc(r.name)}</h3><div class="recipe-card-meta"><span>◷ ${fmt(Number(r.prepMin||0)+Number(r.bakeMin||0),0)} דק׳</span><span>◌ ${p.fullBags} שקיות</span><span>⚖ ${showQty(p.finalWeight,'גרם')}</span></div></button><div class="recipe-card-actions"><button class="btn small secondary" onclick="App.openBookRecipe('${r.id}')">פתיחת מתכון</button><button class="btn small ghost" onclick="App.weightCalc('${r.id}')">התאמת כמות</button></div></article>`}
function renderRecipeBook(){const cats=[...new Set(state.recipes.map(r=>r.category||'אחר'))].sort((a,b)=>a.localeCompare(b,'he'));document.getElementById('view-recipebook').innerHTML=`<div class="card recipe-book-shell"><div class="section-head"><div><h2>ספר המתכונים</h2><div class="hint">תצוגה נקייה לעבודה במטבח, כולל תתי־מתכונים וסדר הכנה.</div></div><button class="btn secondary" onclick="App.importRecipe()">✨ הדבקת מתכון</button></div><div class="recipe-book-toolbar"><div class="field"><label>חיפוש</label><input id="recipeBookSearch" type="search" placeholder="שם מתכון או קטגוריה" oninput="App.filterRecipeBook()"></div><div class="field"><label>קטגוריה</label><select id="recipeBookCategory" onchange="App.filterRecipeBook()"><option value="">הכול</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div></div><div id="recipeBookGrid" class="recipe-book-grid">${state.recipes.map(recipeBookCard).join('')||'<div class="empty">עדיין אין מתכונים בספר.</div>'}</div></div>`}
function filterRecipeBook(){const q=String(document.getElementById('recipeBookSearch')?.value||'').toLowerCase().trim(),cat=document.getElementById('recipeBookCategory')?.value||'';document.querySelectorAll('#recipeBookGrid .recipe-card').forEach(card=>{card.hidden=!((!q||card.dataset.search.includes(q))&&(!cat||card.dataset.category===cat))})}
function ingredientDisplay(i,linkMap={}){
  const link=i.linkedSubRecipeId&&linkMap[i.linkedSubRecipeId];
  return`<li><strong>${fmt(i.qty)} ${esc(i.unit)}</strong> ${link?`<button type="button" class="ingredient-link" onclick="App.openSubRecipeFromIngredient('${esc(link.pane)}')">${esc(i.name)} <span aria-hidden="true">↗</span></button>`:esc(i.name)}</li>`;
}
function stepsBlock(title,steps){return`<div class="card"><h3>${esc(title)}</h3><ol class="steps-list">${(steps||[]).map(s=>`<li>${esc(s.text)}</li>`).join('')||'<li>לא הוזנו שלבים</li>'}</ol></div>`}
function sectionHtml(title,ingredients,steps,bakingSteps=[],notes='',linkMap={}){
  return`<div class="recipe-stage"><div class="recipe-detail-grid"><div class="card"><h3>מצרכים</h3><ul class="ingredient-list">${(ingredients||[]).map(i=>ingredientDisplay(i,linkMap)).join('')||'<li>אין מצרכים</li>'}</ul></div>${stepsBlock('אופן ההכנה',steps)}</div>${bakingSteps?.length?`<div style="margin-top:14px">${stepsBlock('אפייה',bakingSteps)}</div>`:''}<div class="card" style="margin-top:14px"><h3>הערות</h3>${notes?`<div class="notice">${esc(notes).replace(/\n/g,'<br>')}</div>`:'<div class="muted">אין הערות</div>'}</div></div>`;
}
function openBookRecipe(recipeId){
  const r=recipe(recipeId);if(!r)return;const p=packageSummary(r),linkMap={};(r.subRecipes||[]).forEach((s,i)=>linkMap[s.id]={pane:`sub${i}`,name:s.name});
  const tabs=[{id:'full',label:'מתכון מלא'},{id:'main',label:'מתכון ראשי'},...(r.subRecipes||[]).map((s,i)=>({id:`sub${i}`,label:s.name}))];
  const full=`${(r.subRecipes||[]).map((s,i)=>`<div class="stage-heading"><span>שלב ${i+1}</span><strong>תת־מתכון: ${esc(s.name)}</strong></div>${sectionHtml(s.name,s.ingredients,s.steps,[],s.notes,{})}`).join('')}<div class="stage-heading"><span>שלב ${(r.subRecipes||[]).length+1}</span><strong>מתכון ראשי: ${esc(r.name)}</strong></div>${sectionHtml(r.name,r.ingredients,r.steps,r.bakingSteps,r.notes,linkMap)}`;
  modal(r.name,`<div class="recipe-detail-hero"><div class="recipe-card-kicker">${esc(r.category||'מתכון')} ${r.subRecipes?.length?'· מתכון מורכב':''}</div><h3>${esc(r.name)}</h3><div class="recipe-card-meta" style="color:#f0dfd0;margin-top:12px"><span>${p.fullBags} שקיות × ${fmt(p.packageWeight,0)} גרם</span><span>משקל סופי ${showQty(p.finalWeight,'גרם')}</span><span>יתרה ${showQty(p.remainder,'גרם')}</span><span>${fmt(r.ovenTemp,0)}° · ${fmt(r.bakeMin,0)} דק׳</span></div></div><div class="inner-tabs">${tabs.map((t,i)=>`<button data-pane="${t.id}" class="${i===0?'active':''}" onclick="App.switchBookPane('${t.id}',this)">${esc(t.label)}</button>`).join('')}</div><div id="book-full" class="book-pane active">${full}</div><div id="book-main" class="book-pane"><div class="stage-heading"><span>שלב ${(r.subRecipes||[]).length+1}</span><strong>מתכון ראשי</strong></div>${sectionHtml(r.name,r.ingredients,r.steps,r.bakingSteps,r.notes,linkMap)}</div>${(r.subRecipes||[]).map((s,i)=>`<div id="book-sub${i}" class="book-pane"><div class="stage-heading"><span>שלב ${i+1}</span><strong>תת־מתכון: ${esc(s.name)}</strong></div>${sectionHtml(s.name,s.ingredients,s.steps,[],s.notes,{})}<div class="notice" style="margin-top:12px">נדרש במתכון הראשי: <strong>${showQty(s.usedQtyGrams||0,'גרם')}</strong> · תפוקת תת־המתכון: <strong>${showQty(calculateSubRecipeWeight(s).finalWeight,'גרם')}</strong></div></div>`).join('')}<div class="actions" style="margin-top:16px"><button class="btn secondary" onclick="App.weightCalc('${r.id}')">התאמה למשקל או לשקיות</button>${(r.originalRecipeBase||Number(r.savedScaleFactor)>0)?`<button class="btn ghost" onclick="App.resetRecipeOriginal('${r.id}')">חזרה לכמויות המקוריות</button>`:''}<button class="btn ghost" onclick="App.copyRecipe('${r.id}')">העתקה</button><button class="btn ghost" onclick="window.print()">הדפסה</button></div>`)
}
function openSubRecipeFromIngredient(pane){
  document.querySelectorAll('.book-pane').forEach(x=>x.classList.toggle('active',x.id===`book-${pane}`));
  document.querySelectorAll('.inner-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.pane===pane));
  document.getElementById(`book-${pane}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function recipePlainText(r){const p=packageSummary(r);return`${r.name}\n${r.category||''}\n\nתפוקה: ${p.fullBags} שקיות × ${p.packageWeight} גרם\nמשקל סופי משוער: ${showQty(p.finalWeight,'גרם')}\nיתרה: ${showQty(p.remainder,'גרם')}\n\n${(r.subRecipes||[]).map((s,i)=>`שלב ${i+1} — תת־מתכון: ${s.name}\nמצרכים:\n${s.ingredients.map(x=>`• ${fmt(x.qty)} ${x.unit} ${x.name}`).join('\n')}\n\nאופן ההכנה:\n${s.steps.map((x,j)=>`${j+1}. ${x.text}`).join('\n')}\n\nהערות:\n${s.notes||'אין'}`).join('\n\n')}\n\nשלב ${(r.subRecipes||[]).length+1} — מתכון ראשי: ${r.name}\nמצרכים:\n${(r.ingredients||[]).map(i=>`• ${fmt(i.qty)} ${i.unit} ${i.name}${i.linkedSubRecipeId?' ↗ תת־מתכון':''}`).join('\n')}\n\nאופן ההכנה:\n${(r.steps||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n')}\n\nאפייה:\n${(r.bakingSteps||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n')}\n\nהערות:\n${r.notes||'אין'}`}

function renderProduction(){const ts=generatedTasks(),g={},d=demand().byRecipe;ts.forEach(t=>(g[t.date]||(g[t.date]=[])).push(t));document.getElementById('view-production').innerHTML=`<div class="grid two"><div class="card"><h2>שקיות ואצוות</h2>${Object.entries(d).map(([rid,q])=>{const r=recipe(rid),yieldBags=recipeYieldBags(r),b=Math.ceil(q/yieldBags),left=b*yieldBags-q;return`<div class="kpi-line"><span>${esc(r?.name||'מתכון')}</span><strong>${fmt(q,0)} שקיות · ${b} אצוות · עודף ${fmt(left,0)} שקיות</strong></div>`}).join('')||'<div class="empty">אין משימות מתוכננות</div>'}</div><div class="card"><h2>עומס תנור ומגשים</h2>${Object.entries(d).map(([rid,q])=>{const r=recipe(rid);if(!r)return'';const b=Math.ceil(q/recipeYieldBags(r));return`<div class="kpi-line"><span>${esc(r.name)}</span><strong>${b*(r.traysPerBatch||1)} מגשים · ${b*(r.bakeMin||0)} דק׳ תנור</strong></div>`}).join('')||'<div class="empty">אין עומס מחושב</div>'}</div></div><div class="card" style="margin-top:14px"><div class="section-head"><div><h2>משימות לפי יום</h2><div class="hint">אפשר לסמן ביצוע, לפתוח משימה לעריכה או להוסיף משימה חדשה.</div></div><div class="actions"><button class="btn small secondary" onclick="App.newManualTask()">+ הוספת משימה</button><button class="btn small ghost" onclick="App.go('planner')">פתיחת Planner</button></div></div>${Object.keys(g).length?Object.keys(g).sort().map(day=>`<div><div class="day-title">${new Date(day+'T12:00').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})}</div>${g[day].sort((a,b)=>String(a.time).localeCompare(String(b.time))).map(managedTaskHtml).join('')}</div>`).join(''):'<div class="empty">אין משימות. לחצי על “הוספת משימה” או הוסיפי הזמנה.</div>'}</div>`}
function renderShopping(){const items=shopping(),g={},opts=supplierOptions(),best=opts[0];items.forEach(i=>(g[i.category]||(g[i.category]=[])).push(i));document.getElementById('view-shopping').innerHTML=`<div class="grid two shopping-layout"><div class="card shopping-list-card"><div class="section-head shopping-head"><h2>רשימת קניות מאוחדת</h2><button class="btn small ghost" onclick="window.print()">הדפסה</button></div>${items.length?Object.entries(g).map(([cat,a])=>`<section class="shopping-group"><h3>${esc(cat)}</h3>${a.map(i=>`<label class="task shopping-item ${i.checked?'done':''}"><input type="checkbox" ${i.checked?'checked':''} onchange="App.toggleShopping('${esc(i.key)}')"><div class="task-text"><strong>${esc(i.name)}</strong><div class="meta shopping-amounts"><span>דרוש ${showShoppingQty(i.required,i.unit)}</span><span>במלאי ${showShoppingQty(i.available,i.unit)}</span><span>לקנייה ${showShoppingQty(i.need,i.unit)}</span></div></div></label>`).join('')}</section>`).join(''):'<div class="empty">אין חוסרים</div>'}</div><div class="card shopping-summary-card"><h2>המלצת סל</h2>${best?`<div class="notice shopping-summary"><strong>${esc(best.supplier.name)}</strong><div class="shopping-summary-lines"><span>פריטים ${money(best.itemsCost)}</span><span>משלוח ${money(best.delivery)}</span><span>נסיעה ${money(best.distanceCost)}</span></div><strong>סה"כ ${money(best.total)}</strong></div><div class="hint" style="margin-top:10px">מבוסס על המחירים שהוזנו או יובאו ועל המרחקים שהגדרת.</div>`:'<div class="empty">הוסיפי ספקים ומחירים</div>'}${opts.length?`<div class="table-wrap shopping-supplier-table" style="margin-top:12px"><table><thead><tr><th>ספק</th><th>כיסוי</th><th>סה"כ</th></tr></thead><tbody>${opts.map(o=>`<tr><td>${esc(o.supplier.name)}</td><td>${o.covered}/${items.length}</td><td class="money">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`:''}</div></div>`}

function renderInventory(){const soon=addDays(new Date(),7);document.getElementById('view-inventory').innerHTML=`<div class="card"><div class="section-head"><div><h2>מלאי</h2><div class="hint">מספר אריזות × כמות בכל אריזה = סך הכול במלאי.</div></div><button class="btn secondary" onclick="App.newInventory()">+ פריט מלאי</button></div>${state.inventory.length?`<div class="table-wrap"><table><thead><tr><th>רכיב</th><th>כמות יחידות</th><th>בכל יחידה</th><th>סה״כ במלאי</th><th>מינימום</th><th>תפוגה</th><th>מיקום</th><th>עלות לאריזה</th><th></th></tr></thead><tbody>${state.inventory.map(i=>{const count=inventoryPackageCount(i),per=inventoryAmountPerPackage(i),total=inventoryTotal(i),low=total<=inventoryMinTotal(i),exp=i.expiry&&new Date(i.expiry)<=soon;return`<tr><td><strong>${esc(i.name)}</strong>${low?'<div><span class="badge red">מלאי נמוך</span></div>':''}</td><td>${fmt(count,0)}</td><td>${showQty(per,i.unit)}</td><td><strong>${showQty(total,i.unit)}</strong></td><td>${fmt(inventoryMinPackageCount(i),0)} יחידות</td><td>${i.expiry?dateText(i.expiry):'—'} ${exp?'<span class="badge gold">קרוב</span>':''}</td><td>${esc(i.location||'')}</td><td>${money(inventoryPackCost(i))}</td><td><div class="actions"><button class="btn small ghost" onclick="App.editInventory('${i.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteInventory('${i.id}')">מחיקה</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">אין פריטי מלאי</div>'}</div>`}
function inventoryForm(i={id:'',name:'',packageCount:0,amountPerPackage:0,unit:'גרם',minPackageCount:0,expiry:'',location:'',costPerPackage:0,supplierId:''}){const legacy=i.packageCount===undefined,packageCount=legacy?(Number(i.qty||0)>0?1:0):inventoryPackageCount(i),amountPerPackage=legacy?Number(i.qty||0):inventoryAmountPerPackage(i),minPackageCount=legacy?(amountPerPackage>0?Math.ceil(Number(i.minQty||0)/amountPerPackage):0):inventoryMinPackageCount(i);modal(i.id?'עריכת מלאי':'פריט מלאי חדש',`<form id="invForm"><input type="hidden" name="id" value="${esc(i.id)}"><div class="form-grid"><div class="field"><label>רכיב</label><input name="name" required value="${esc(i.name)}"></div><div class="field"><label>כמות יחידות</label><input name="packageCount" type="number" step="1" min="0" value="${packageCount}"></div><div class="field"><label>כמות בכל יחידה</label><input name="amountPerPackage" type="number" step=".01" min="0" value="${amountPerPackage}"></div><div class="field"><label>יחידת מידה</label><select name="unit">${UNITS.map(u=>`<option ${i.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>מינימום יחידות</label><input name="minPackageCount" type="number" step="1" min="0" value="${minPackageCount}"></div><div class="field"><label>עלות לאריזה</label><input name="costPerPackage" type="number" step=".01" min="0" value="${inventoryPackCost(i)}"></div><div class="field"><label>תפוגה</label><input name="expiry" type="date" value="${esc(i.expiry)}"></div><div class="field"><label>מיקום אחסון</label><input name="location" value="${esc(i.location)}"></div><div class="field"><label>ספק</label><select name="supplierId"><option value="">ללא</option>${state.suppliers.map(s=>`<option value="${s.id}" ${i.supplierId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field full"><div id="inventoryTotalPreview" class="notice"></div></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);const form=document.getElementById('invForm'),update=()=>{const count=Math.max(0,Math.floor(Number(form.elements.packageCount.value)||0)),per=Math.max(0,Number(form.elements.amountPerPackage.value)||0),unit=form.elements.unit.value;form.elements.packageCount.value=count;document.getElementById('inventoryTotalPreview').innerHTML=`סה״כ במלאי: <strong>${showQty(count*per,unit)}</strong> (${fmt(count,0)} × ${showQty(per,unit)})`};form.addEventListener('input',update);form.addEventListener('change',update);update();form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),ex=state.inventory.find(x=>x.id===f.get('id')),obj={id:f.get('id')||id('inv'),name:f.get('name'),packageCount:Math.max(0,Math.floor(Number(f.get('packageCount')||0))),amountPerPackage:Number(f.get('amountPerPackage')||0),unit:f.get('unit'),minPackageCount:Math.max(0,Math.floor(Number(f.get('minPackageCount')||0))),expiry:f.get('expiry'),location:f.get('location'),costPerPackage:Number(f.get('costPerPackage')||0),supplierId:f.get('supplierId')};if(ex)Object.assign(ex,obj);else state.inventory.push(obj);await persist();close();render()}}

/* ייבוא שקיפות מחירים רמי לוי */
async function readMaybeGzip(file){const buf=await file.arrayBuffer();if(file.name.toLowerCase().endsWith('.gz')){if('DecompressionStream'in window){const stream=new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));return await new Response(stream).text()}if(window.pako?.ungzip)return window.pako.ungzip(new Uint8Array(buf),{to:'string'});throw new Error('הדפדפן אינו תומך בפתיחת GZ. אפשר לחלץ את הקובץ ולהעלות XML.')}return new TextDecoder('utf-8').decode(buf)}
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
function priceRow(p={}){return`<div class="repeat-row price-row"><div class="field"><label>רכיב</label><input class="sp-i" value="${esc(p.ingredient||'')}"></div><div class="field"><label>כמות בחבילה</label><input class="sp-q" type="number" min="0" step=".01" value="${p.packQty||0}"></div><div class="field"><label>יחידה</label><select class="sp-u">${UNITS.map(u=>`<option ${p.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>מחיר חבילה</label><input class="sp-p" type="number" min="0" step=".01" value="${p.packPrice||0}"></div><button type="button" class="btn small danger" onclick="this.closest('.price-row').remove()">הסר</button></div>`}
function supplierForm(s={id:'',name:'',address:'',distanceKm:0,deliveryCost:0,notes:'',prices:[]}){modal(s.id?'עריכת ספק':'ספק חדש',`<form id="supForm"><input type="hidden" name="id" value="${esc(s.id)}"><div class="form-grid"><div class="field"><label>שם ספק/חנות</label><input name="name" required value="${esc(s.name)}"></div><div class="field"><label>כתובת</label><input name="address" value="${esc(s.address)}"></div><div class="field"><label>מרחק בק"מ</label><input name="distanceKm" type="number" step=".1" min="0" value="${s.distanceKm}"></div><div class="field"><label>עלות משלוח</label><input name="deliveryCost" type="number" step=".01" min="0" value="${s.deliveryCost}"></div><div class="field full"><label>מחירי אריזות</label><div id="supplierPrices">${(s.prices.length?s.prices:[{ingredient:'',packQty:1,unit:'ק"ג',packPrice:0}]).map(priceRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addPrice()">+ מחיר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(s.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('supForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.suppliers.find(x=>x.id===f.get('id')),prices=[...document.querySelectorAll('.price-row')].map(r=>({ingredient:r.querySelector('.sp-i').value.trim(),packQty:Number(r.querySelector('.sp-q').value||0),unit:r.querySelector('.sp-u').value,packPrice:Number(r.querySelector('.sp-p').value||0),updatedAt:new Date().toISOString()})).filter(x=>x.ingredient&&x.packQty),obj={id:f.get('id')||id('sup'),name:f.get('name'),address:f.get('address'),distanceKm:Number(f.get('distanceKm')||0),deliveryCost:Number(f.get('deliveryCost')||0),notes:f.get('notes'),prices};if(ex)Object.assign(ex,obj);else state.suppliers.push(obj);await persist();close();render()}}


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
function invoiceDocumentHtml(inv){const t=invoiceTotals(inv),seller=inv.seller||state.invoiceProfile,rows=(inv.items||[]).map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.description)}</td><td>${fmt(i.qty)}</td><td>${esc(i.unit)}</td><td>${money(i.unitPrice)}</td><td>${money(Number(i.qty||0)*Number(i.unitPrice||0))}</td></tr>`).join('');return`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.documentType)} ${esc(inv.number)}</title><style>body{font-family:Arial,sans-serif;color:#2d1b17;margin:0;background:#f5efe7}.sheet{width:190mm;min-height:267mm;margin:10mm auto;background:white;padding:18mm;box-sizing:border-box}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #2b1712;padding-bottom:18px}.brand h1{margin:0;font-size:28px}.doc{text-align:left}.doc h2{margin:0 0 8px;font-size:24px}.meta{color:#74645e;font-size:13px;line-height:1.7}.parties{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.box{border:1px solid #ddd0c2;border-radius:12px;padding:14px}.box h3{margin:0 0 8px;font-size:14px;color:#8b5f3c}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px;border-bottom:1px solid #e7ddd3;text-align:right}th{background:#f6eee5;font-size:12px}.totals{margin-right:auto;width:320px}.line{display:flex;justify-content:space-between;padding:7px 0}.total{font-size:20px;font-weight:bold;border-top:2px solid #2b1712;margin-top:5px;padding-top:10px}.footer{margin-top:28px;border-top:1px solid #ddd0c2;padding-top:16px;line-height:1.7}.draft{margin-top:20px;padding:10px;border:1px solid #d8b06d;background:#fff8e8;border-radius:8px;font-size:12px}@media print{body{background:white}.sheet{margin:0;width:auto;min-height:auto;box-shadow:none}}</style></head><body><div class="sheet"><div class="top"><div class="brand"><h1>${esc(seller.legalName||state.settings.businessName)}</h1><div class="meta">${seller.businessId?`ח.פ / ע.מ: ${esc(seller.businessId)}<br>`:''}${esc(seller.address||'')}<br>${esc(seller.phone||'')} ${seller.email?`· ${esc(seller.email)}`:''}</div></div><div class="doc"><h2>${esc(inv.documentType)}</h2><strong>${esc(inv.number)}</strong><div class="meta">תאריך: ${dateText(inv.issueDate)}<br>לתשלום עד: ${dateText(inv.dueDate)}${inv.allocationNumber?`<br>מספר הקצאה/אישור: ${esc(inv.allocationNumber)}`:''}</div></div></div><div class="parties"><div class="box"><h3>מאת</h3><strong>${esc(seller.legalName||state.settings.businessName)}</strong><div class="meta">${esc(seller.address||'')}<br>${esc(seller.phone||'')} · ${esc(seller.email||'')}</div></div><div class="box"><h3>לכבוד</h3><strong>${esc(inv.clientName)}</strong><div class="meta">${inv.clientBusinessId?`ח.פ / ע.מ: ${esc(inv.clientBusinessId)}<br>`:''}${esc(inv.clientContact||'')}<br>${esc(inv.clientAddress||'')}<br>${esc(inv.clientPhone||'')} ${inv.clientEmail?`· ${esc(inv.clientEmail)}`:''}</div></div></div><table><thead><tr><th>#</th><th>תיאור</th><th>כמות</th><th>יחידה</th><th>מחיר יחידה</th><th>סה״כ</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="line"><span>סכום לפני מע״מ</span><strong>${money(t.subtotal)}</strong></div>${inv.vatEnabled!==false?`<div class="line"><span>מע״מ ${fmt(t.vatRate,1)}%</span><strong>${money(t.vat)}</strong></div>`:''}<div class="line total"><span>סה״כ לתשלום</span><span>${money(t.total)}</span></div></div><div class="footer"><strong>תנאי תשלום:</strong> ${esc(inv.paymentTerms||'')}<br>${seller.bankName||seller.bankBranch||seller.bankAccount?`<strong>פרטי העברה:</strong> ${esc([seller.bankName,seller.bankBranch&&'סניף '+seller.bankBranch,seller.bankAccount&&'חשבון '+seller.bankAccount].filter(Boolean).join(' · '))}<br>`:''}${inv.notes?`<strong>הערות:</strong> ${esc(inv.notes).replace(/\n/g,'<br>')}`:''}<div class="draft">מסמך מסחרי זה אינו חשבונית מס או קבלה רשמית.</div></div></div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`}
function printInvoice(id){const inv=state.invoices.find(x=>x.id===id);if(!inv)return;const w=window.open('','_blank');if(!w)return alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר.');w.document.open();w.document.write(invoiceDocumentHtml(inv));w.document.close()}
function todoSort(items){return items.slice().sort((a,b)=>Number(a.done)-Number(b.done)||({'גבוהה':0,'רגילה':1,'נמוכה':2}[a.priority]??1)-({'גבוהה':0,'רגילה':1,'נמוכה':2}[b.priority]??1)||(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')||String(a.createdAt||'').localeCompare(String(b.createdAt||'')))}
function todoBadge(priority){return priority==='גבוהה'?'red':priority==='נמוכה'?'blue':'gold'}
function renderTodo(){
  const items=todoSort(state.todoItems||[]),open=items.filter(x=>!x.done),done=items.filter(x=>x.done),today=dayKey(new Date());
  const itemHtml=item=>`<div class="todo-item ${item.done?'done':''}"><label class="todo-check"><input type="checkbox" ${item.done?'checked':''} onchange="App.toggleTodo('${item.id}')"><span></span></label><button class="todo-main" onclick="App.editTodo('${item.id}')"><strong>${esc(item.text)}</strong><div class="meta">${item.dueDate?`לביצוע עד ${dateText(item.dueDate)}`:'ללא תאריך'}${item.notes?` · ${esc(item.notes)}`:''}</div></button><span class="badge ${todoBadge(item.priority)}">${esc(item.priority)}</span><button class="icon-btn" aria-label="מחיקת משימה" onclick="App.deleteTodo('${item.id}')">✕</button></div>`;
  document.getElementById('view-todo').innerHTML=`<div class="section-head"><div><h2>To Do List</h2><div class="hint">רשימת המשימות האישית שלך. כל סימון נשמר במכשיר ובענן.</div></div><button class="btn secondary" onclick="App.newTodo()">+ משימה חדשה</button></div><div class="grid three todo-summary"><div class="metric"><div class="label">משימות פתוחות</div><div class="value">${open.length}</div></div><div class="metric"><div class="label">להיום</div><div class="value">${open.filter(x=>x.dueDate===today).length}</div></div><div class="metric"><div class="label">הושלמו</div><div class="value">${done.length}</div></div></div><div class="card" style="margin-top:16px"><div class="section-head"><h2>לביצוע</h2>${done.length?`<button class="btn small ghost" onclick="App.clearCompletedTodos()">ניקוי משימות שהושלמו</button>`:''}</div><div class="todo-list">${open.map(itemHtml).join('')||'<div class="empty">אין משימות פתוחות 🎉</div>'}</div>${done.length?`<details class="todo-completed"><summary>הושלמו (${done.length})</summary><div class="todo-list">${done.map(itemHtml).join('')}</div></details>`:''}</div>`;
}
function todoForm(item={}){
  modal(item.id?'עריכת משימה':'משימה חדשה',`<form id="todoForm"><div class="form-grid"><div class="field full"><label>מה צריך לעשות?</label><input name="text" required maxlength="180" value="${esc(item.text||'')}" placeholder="לדוגמה: להזמין שקיות אריזה"></div><div class="field"><label>עדיפות</label><select name="priority">${['נמוכה','רגילה','גבוהה'].map(v=>`<option ${v===(item.priority||'רגילה')?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>תאריך יעד</label><input name="dueDate" type="date" value="${esc(item.dueDate||'')}"></div><div class="field full"><label>הערות</label><textarea name="notes" rows="3" placeholder="פרטים נוספים, טלפון, כמות או כל דבר שחשוב לזכור">${esc(item.notes||'')}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  document.getElementById('todoForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),text=String(f.get('text')||'').trim();if(!text)return;const next={id:item.id||id('todo'),text,priority:String(f.get('priority')||'רגילה'),dueDate:String(f.get('dueDate')||''),notes:String(f.get('notes')||'').trim(),done:!!item.done,createdAt:item.createdAt||new Date().toISOString()};if(item.id)state.todoItems=state.todoItems.map(x=>x.id===item.id?next:x);else state.todoItems.push(next);await persist();close();render()};
}
function renderReports(){const os=state.orders.filter(o=>o.status!=='בוטלה'),rev=os.reduce((s,o)=>s+revenue(o),0);let cost=0,by={};os.forEach(o=>(o.items||[]).forEach(i=>{const r=recipe(i.recipeId);if(r)cost+=recipeCost(r).perUnit*Number(i.qty);by[i.recipeId]=(by[i.recipeId]||0)+Number(i.qty)}));const profit=rev-cost;document.getElementById('view-reports').innerHTML=`<div class="grid four"><div class="metric"><div class="label">הכנסות</div><div class="value">${money(rev)}</div></div><div class="metric"><div class="label">עלות משוערת</div><div class="value">${money(cost)}</div></div><div class="metric"><div class="label">רווח גולמי</div><div class="value">${money(profit)}</div></div><div class="metric"><div class="label">שיעור רווח</div><div class="value">${rev?fmt(profit/rev*100,1):0}%</div></div></div><div class="grid two" style="margin-top:14px"><div class="card"><h2>מוצרים נמכרים</h2>${Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([rid,q])=>`<div class="kpi-line"><span>${esc(recipe(rid)?.name||'מתכון')}</span><strong>${fmt(q,0)} שקיות</strong></div>`).join('')||'<div class="empty">אין נתונים</div>'}</div><div class="card"><h2>רווחיות מתכונים</h2>${state.recipes.map(r=>{const c=recipeCost(r);return`<div class="kpi-line"><span>${esc(r.name)}</span><strong>${money(Number(r.salePrice)-c.perUnit)} לשקית</strong></div>`}).join('')||'<div class="empty">אין מתכונים</div>'}</div></div><div class="card" style="margin-top:14px"><div class="notice">זהו אומדן ניהולי. שכירות, מסים, עמלות, פחת והוצאות קבועות אינן נכללות אלא אם הוזנו.</div></div>`}

function assistantContext(){
  const tasks=generatedTasks().filter(t=>!t.done).slice(0,80).map(t=>({key:t.key,text:t.text,date:t.date,time:t.time,duration:t.duration,recipe:t.recipe,customer:t.customer,type:t.type}));
  return {
    now:new Date().toISOString(),
    business:{name:state.settings.businessName,currency:state.settings.currency,workStart:state.settings.workStart,workEnd:state.settings.workEnd,planningBufferMin:state.settings.planningBufferMin,weeklyAvailability:state.settings.weeklyAvailability},
    orders:state.orders.slice(-40).map(o=>({id:o.id,customer:o.customer,dueAt:o.dueAt,status:o.status,delivery:o.delivery,items:(o.items||[]).map(i=>({recipeId:i.recipeId,recipe:recipe(i.recipeId)?.name||'',qty:Number(i.qty||0),unitPrice:Number(i.unitPrice||0)}))})),
    recipes:state.recipes.slice(0,80).map(r=>({id:r.id,name:r.name,packageWeight:r.packageWeight,yieldUnits:r.yieldUnits,finalWeight:recipeWeight(r).finalWeight,warnings:r.warnings,subRecipes:(r.subRecipes||[]).map(x=>({id:x.id,name:x.name,usedQtyGrams:x.usedQtyGrams})),productionTasks:(r.productionTasks||[]).map(x=>({title:x.title,type:x.type,activeMin:x.activeMin,passiveMin:x.passiveMin,isPreprep:x.isPreprep}))})),
    inventory:state.inventory.slice(0,120).map(i=>({id:i.id,name:i.name,total:inventoryTotal(i),minimum:inventoryMinTotal(i),unit:i.unit||i.packUnit||''})),
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
    else if(a.type==='add_manual_task'){state.manualTasks.push({key:id('manual'),text:String(a.text||a.label||'משימה'),date:String(a.date||dayKey(new Date())),time:String(a.time||state.settings.workStart||'08:00'),duration:Math.max(5,Number(a.duration||30)),type:TASK_TYPES[a.taskType]?a.taskType:'prep',recipe:String(a.recipe||''),customer:String(a.customer||''),batches:0,qty:0,source:'AI',manual:true})}
    else if(a.type==='reschedule_task'){const key=String(a.taskKey||''),target=generatedTasks().find(t=>t.key===key);if(!target)throw new Error('המשימה לא נמצאה');state.planOverrides[key]={...(state.planOverrides[key]||{}),date:String(a.date||target.date),time:String(a.time||target.time)};}
    else if(a.type==='navigate'){go(String(a.view||'dashboard'));}
    else throw new Error('סוג הפעולה אינו נתמך');
    message.action=null;message.text+=`\n\n✓ הפעולה בוצעה.`;await persist();render();if(currentView==='assistant')renderAssistant();
  }catch(error){alert(`לא ניתן לבצע את הפעולה: ${error.message||error}`)}
}
async function dismissAIAction(messageId){const m=state.aiMessages.find(x=>x.id===messageId);if(m){m.action=null;m.text+='\n\nהפעולה בוטלה.';await persist();renderAssistant()}}
async function clearAIChat(){if(!confirm('למחוק את היסטוריית השיחה עם העוזרת?'))return;state.aiMessages=[];await persist();renderAssistant()}

function renderSettings(){const c=getCloud()||{};document.getElementById('view-settings').innerHTML=`<div class="grid two"><div class="card"><h2>הגדרות העסק</h2><form id="settingsForm"><div class="form-grid"><div class="field"><label>שם העסק</label><input name="businessName" value="${esc(state.settings.businessName||'Bakery Workspace')}"></div><div class="field"><label>מטבע</label><input name="currency" value="${esc(state.settings.currency||'₪')}"></div><div class="field"><label>שכר עבודה לשעה</label><input name="laborRate" type="number" min="0" step=".01" value="${Number(state.settings.laborRate||0)}"></div><div class="field"><label>עלות נסיעה לק״מ</label><input name="distanceCostPerKm" type="number" min="0" step=".01" value="${Number(state.settings.distanceCostPerKm||0)}"></div><div class="field"><label>מספר תנורים</label><input name="ovens" type="number" min="1" step="1" value="${Number(state.settings.ovens||1)}"></div><div class="field"><label>מגשים בכל תנור</label><input name="ovenTrays" type="number" min="1" step="1" value="${Number(state.settings.ovenTrays||1)}"></div><div class="field"><label>תחילת יום עבודה</label><input name="workStart" type="time" value="${esc(state.settings.workStart||'08:00')}"></div><div class="field"><label>סיום יום עבודה</label><input name="workEnd" type="time" value="${esc(state.settings.workEnd||'18:00')}"></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירת הגדרות</button></div></form></div><div class="card"><h2>שמירה בענן</h2>${cloud.user?`<div class="notice success"><strong>מחוברת:</strong> ${esc(cloud.user.email||'')}<br><span class="muted">החיבור נשמר אוטומטית במכשיר הזה, ובכניסה הבאה המערכת תתחבר ותטען את הנתונים מהענן.</span></div><div class="actions" style="margin-top:12px"><button class="btn secondary" onclick="App.pullCloud()">רענון מהענן</button><button class="btn ghost" onclick="App.logout()">התנתקות</button></div>`:`<div class="form-grid"><div class="field full"><label>Project URL</label><input id="cloudUrl" dir="ltr" value="${esc(c.url||'')}"></div><div class="field full"><label>Publishable / Anon Key</label><input id="cloudKey" type="password" dir="ltr" value="${esc(c.key||'')}"></div><div class="field"><label>אימייל</label><input id="cloudEmail" type="email" dir="ltr" autocomplete="email" value="${esc(c.email||'')}"></div><div class="field"><label>סיסמה</label><input id="cloudPassword" type="password" dir="ltr" autocomplete="current-password"></div></div><div class="actions" style="margin-top:12px"><button class="btn" onclick="App.cloudLogin()">כניסה</button><button class="btn secondary" onclick="App.cloudSignup()">יצירת חשבון</button></div>`}<div class="hint" style="margin-top:12px">פרטי הפרויקט, המפתח הציבורי והאימייל נשמרים במכשיר. לאחר התחברות מוצלחת, Supabase שומר סשן מאובטח ולכן בדרך כלל לא תצטרכי להקליד שוב את הסיסמה. הסיסמה עצמה אינה נשמרת באתר או בענן.</div></div><div class="card"><h2>עוזרת AI</h2><div class="notice">העוזרת פועלת דרך פונקציית Supabase בשם <strong>bakery-assistant</strong>. מפתח OpenAI נשמר רק בסודות השרת.</div><div class="actions" style="margin-top:12px"><button type="button" class="btn ghost" onclick="App.go('assistant')">פתיחת העוזרת</button><button type="button" class="btn ghost" onclick="App.clearAIChat()">מחיקת היסטוריה</button></div></div><div class="card"><h2>ייבוא מתכונים חכם</h2><div class="notice">המנתח המקומי פעיל תמיד. פונקציית Supabase בשם <strong>parse-recipe</strong> מוסיפה ניתוח AI כאשר היא מוגדרת.</div><div class="hint" style="margin-top:10px">מפתח ה־AI אינו נשמר באתר או ב־GitHub.</div></div><div class="card"><h2>תצוגה וניווט</h2><div class="actions"><button type="button" class="btn ghost" onclick="App.editTabOrder()">סידור לשוניות</button><button type="button" class="btn ghost" onclick="App.editAvailability()">הזמינות שלי</button></div></div><div class="card"><h2>גיבוי ותחזוקה</h2><div class="actions"><button class="btn secondary" onclick="App.exportData()">הורדת גיבוי</button><button class="btn ghost" onclick="document.getElementById('importFile').click()">ייבוא גיבוי</button><button class="btn danger" onclick="App.resetAll()">מחיקת כל הנתונים</button></div></div></div>`;const form=document.getElementById('settingsForm');form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);state.settings={...state.settings,businessName:f.get('businessName')||'Bakery Workspace',currency:f.get('currency')||'₪',laborRate:Number(f.get('laborRate')||0),distanceCostPerKm:Number(f.get('distanceCostPerKm')||0),ovens:Math.max(1,Math.floor(Number(f.get('ovens'))||1)),ovenTrays:Math.max(1,Math.floor(Number(f.get('ovenTrays'))||1)),workStart:f.get('workStart')||'08:00',workEnd:f.get('workEnd')||'18:00'};await persist();render()}}

/* Supabase */
function getCloud(){try{return JSON.parse(localStorage.getItem(CLOUD_KEY)||'null')}catch(e){return null}}
function hasBusinessData(x){return !!((x.recipes&&x.recipes.length)||(x.orders&&x.orders.length)||(x.invoices&&x.invoices.length)||(x.inventory&&x.inventory.length)||(x.suppliers&&x.suppliers.length))}
function initCloud(){const c=getCloud();if(!c?.url||!c?.key||!window.supabase)return false;cloud.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'bakery-workspace-auth-v1'}});return true}
function remoteIsNewer(updatedAt){return(Date.parse(updatedAt||0)||0)>(Date.parse(state.updatedAt||0)||0)+250}
function applyRemote(data,updatedAt,show=true){if(!data)return;if(updatedAt&&!remoteIsNewer(updatedAt)&&hasBusinessData(state))return;state=migrateState({...data,updatedAt:updatedAt||data.updatedAt||new Date().toISOString()});localStorage.setItem(LS_KEY,JSON.stringify(state));if(show){setStatus('✓ התעדכן מהענן');setTimeout(()=>setStatus(''),1400)}render()}
async function cloudAuth(mode){const url=document.getElementById('cloudUrl')?.value.trim(),key=document.getElementById('cloudKey')?.value.trim(),email=document.getElementById('cloudEmail')?.value.trim(),password=document.getElementById('cloudPassword')?.value;if(!url||!key||!email||!password)return alert('יש למלא את כל פרטי החיבור');localStorage.setItem(CLOUD_KEY,JSON.stringify({url,key,email}));if(!initCloud())return alert('פרטי Supabase אינם תקינים');setStatus('מתחברת…');const res=mode==='signup'?await cloud.client.auth.signUp({email,password}):await cloud.client.auth.signInWithPassword({email,password});if(res.error){setStatus('⚠ ההתחברות נכשלה');return alert(res.error.message)}cloud.user=res.data.user;if(!cloud.user){setStatus('');return alert('נשלח אימייל אימות. אשרי אותו ואז התחברי.')}await initialCloudSync();startCloudSync();setStatus('✓ החיבור נשמר');render()}
async function initialCloudSync(){if(!cloud.user||!cloud.client)return;setStatus('מסנכרן…');const {data,error}=await cloud.client.from('bakery_os_data').select('data,updated_at').eq('user_id',cloud.user.id).maybeSingle();if(error){setStatus('⚠ שגיאת סנכרון');throw error}if(data?.data){const localHas=hasBusinessData(state),remoteHas=hasBusinessData(data.data),localTime=Date.parse(state.updatedAt||0)||0,remoteTime=Date.parse(data.updated_at||data.data.updatedAt||0)||0;if(localHas&&(!remoteHas||localTime>remoteTime+250)){await pushCloud();setStatus('✓ הנתונים מהמכשיר נשמרו בענן')}else{state=migrateState({...data.data,updatedAt:data.updated_at||data.data.updatedAt});localStorage.setItem(LS_KEY,JSON.stringify(state));setStatus('✓ נטען מהענן')}}else if(hasBusinessData(state))await pushCloud();else{state.updatedAt=new Date().toISOString();await pushCloud()}}
async function pushCloud(){if(!cloud.user||!cloud.client)return false;const stamp=state.updatedAt||new Date().toISOString();state.updatedAt=stamp;const {error}=await cloud.client.from('bakery_os_data').upsert({user_id:cloud.user.id,data:state,updated_at:stamp},{onConflict:'user_id'});if(error){console.error(error);setStatus('⚠ השמירה בענן נכשלה');return false}return true}
async function pullCloud(show=true){if(!cloud.user||!cloud.client)return;if(show)setStatus('טוען מהענן…');const {data,error}=await cloud.client.from('bakery_os_data').select('data,updated_at').eq('user_id',cloud.user.id).maybeSingle();if(error){if(show)setStatus('⚠ שגיאת טעינה');console.error(error);return}if(data?.data){if(remoteIsNewer(data.updated_at)||!hasBusinessData(state))applyRemote(data.data,data.updated_at,show);else if(show){setStatus('✓ כבר מעודכן');setTimeout(()=>setStatus(''),1200)}}}
function stopCloudSync(){if(cloud.channel&&cloud.client)cloud.client.removeChannel(cloud.channel);cloud.channel=null;if(cloud.timer)clearInterval(cloud.timer);cloud.timer=null}
function startCloudSync(){stopCloudSync();if(!cloud.user||!cloud.client)return;cloud.channel=cloud.client.channel('bakery-os-'+cloud.user.id).on('postgres_changes',{event:'*',schema:'public',table:'bakery_os_data',filter:'user_id=eq.'+cloud.user.id},payload=>{const row=payload.new;if(row?.data&&remoteIsNewer(row.updated_at))applyRemote(row.data,row.updated_at,true)}).subscribe();cloud.timer=setInterval(()=>{if(document.visibilityState==='visible')pullCloud(false)},15000)}
async function initSession(){if(!initCloud())return;const {data,error}=await cloud.client.auth.getSession();if(error){console.warn('Session restore failed',error);return}cloud.user=data?.session?.user||null;if(cloud.user){setStatus('מתחברת לענן…');await initialCloudSync();startCloudSync();setStatus('✓ מחוברת לענן');setTimeout(()=>setStatus(''),1400)}}
function exportData(){const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bakery-os-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href)}
async function importData(file){try{state=migrateState(JSON.parse(await file.text()));await persist();render();alert('הנתונים יובאו')}catch(e){alert('קובץ לא תקין')}}

window.App={
  askAI:assistantQuickQuestion,sendAI:sendAssistantMessage,confirmAIAction,dismissAIAction,clearAIChat,
  go,openPlanner,close,
  newTodo:()=>todoForm(),editTodo:x=>todoForm(state.todoItems.find(t=>t.id===x)||{}),toggleTodo:async x=>{const item=state.todoItems.find(t=>t.id===x);if(item){item.done=!item.done;await persist();render()}},deleteTodo:async x=>{if(confirm('למחוק את המשימה?')){state.todoItems=state.todoItems.filter(t=>t.id!==x);await persist();render()}},clearCompletedTodos:async()=>{if(confirm('למחוק את כל המשימות שסומנו כהושלמו?')){state.todoItems=state.todoItems.filter(t=>!t.done);await persist();render()}},
  newOrder:()=>orderForm(),editOrder:x=>orderForm(state.orders.find(o=>o.id===x)),repeatOrderNextWeek,deleteOrder:async x=>{if(confirm('למחוק את ההזמנה?')){state.orders=state.orders.filter(o=>o.id!==x);await persist();render()}},addOrderItem:()=>document.getElementById('orderItems').insertAdjacentHTML('beforeend',orderRow({recipeId:'',qty:1})),
  newInvoice:()=>invoiceForm(),editInvoice:x=>invoiceForm(state.invoices.find(i=>i.id===x)),invoiceFromOrder,addInvoiceItem:()=>{document.getElementById('invoiceItems').insertAdjacentHTML('beforeend',invoiceItemRow());updateInvoicePreview()},updateInvoicePreview,printInvoice,deleteInvoice:async x=>{if(confirm('למחוק את המסמך?')){state.invoices=state.invoices.filter(i=>i.id!==x);await persist();render()}},
  newRecipe:()=>recipeForm(),editRecipe:x=>recipeForm(state.recipes.find(r=>r.id===x)),deleteRecipe:async x=>{if(confirm('למחוק את המתכון?')){state.recipes=state.recipes.filter(r=>r.id!==x);await persist();render()}},
  addIngredient:()=>{document.getElementById('recipeIngredients').insertAdjacentHTML('beforeend',ingredientRow({name:'',qty:'',unit:'גרם',category:'אחר'}));updateRecipeWeightPreview()},removeIngredient:b=>{b.closest('.ingredient-row').remove();updateRecipeWeightPreview()},addStep:()=>document.getElementById('recipeSteps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:1,time:'',durationMin:0})),addBakingStep:()=>document.getElementById('recipeBakingSteps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:0,time:'',durationMin:0})),
  addSubRecipe:()=>{document.getElementById('subRecipes').insertAdjacentHTML('beforeend',subRecipeCard());updateRecipeWeightPreview()},addSubIngredient:b=>{b.parentElement.querySelector('.sub-ingredients').insertAdjacentHTML('beforeend',ingredientRow({name:'',qty:'',unit:'גרם',category:'אחר'},true));updateRecipeWeightPreview()},addSubStep:b=>b.parentElement.querySelector('.sub-steps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:3,time:'',durationMin:0},true)),updateRecipeWeightPreview,
  weightCalc:x=>weightCalculator(state.recipes.find(r=>r.id===x)),saveRecipeScale:saveScaledRecipe,resetRecipeOriginal:resetRecipeToOriginal,scaleMode:(mode,button)=>{window.__scaleMode=mode;document.getElementById('scaleWeightField').hidden=mode!=='weight';document.getElementById('scaleBagsField').hidden=mode!=='bags';button.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));window.__updateScale?.()},
  importRecipe:importRecipeModal,analyzeRecipeImport,openPendingRecipe:()=>{const r=pendingImport;pendingImport=null;close();recipeForm(r)},filterRecipeBook,openBookRecipe,openSubRecipeFromIngredient,switchBookPane:(pane,button)=>{document.querySelectorAll('.book-pane').forEach(x=>x.classList.toggle('active',x.id===`book-${pane}`));button.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button))},copyRecipe:async x=>{const r=recipe(x);try{await navigator.clipboard.writeText(recipePlainText(r));setStatus('✓ המתכון הועתק')}catch(e){alert(recipePlainText(r))}},
  toggleTask:async k=>{state.checkedTasks[k]=!state.checkedTasks[k];await persist();render()},toggleShopping:async k=>{state.checkedShopping[k]=!state.checkedShopping[k];await persist();render()},
  editAvailability:availabilityModal,addAvailability:day=>document.getElementById(`avail-${day}`).insertAdjacentHTML('beforeend',availabilityRow(day)),workflowEditor,addWorkflowTask:()=>document.getElementById('workflowRows').insertAdjacentHTML('beforeend',workflowRow()),editTabOrder:tabOrderEditor,saveTabOrder:async()=>{state.settings.tabOrder=[...document.querySelectorAll('#tabOrderList .tab-order-item')].map(x=>x.dataset.view);await persist();close();initTabOrder();render()},resetTabOrder:async()=>{state.settings.tabOrder=[];await persist();location.reload()},
  plannerPrev:()=>{plannerWeekOffset--;render()},plannerNext:()=>{plannerWeekOffset++;render()},plannerToday:()=>{plannerWeekOffset=0;plannerDay=dayKey(new Date());render()},setPlannerMode:m=>{plannerMode=m;render()},setPlannerDay:d=>{plannerDay=d;render()},buildPlan:async()=>{state.planOverrides={};await persist();render();setStatus('✓ התוכנית נבנתה מחדש')},newManualTask:manualTaskForm,editPlanTask,dragPlanTask:(e,key)=>{draggedTaskKey=key;e.dataTransfer.setData('text/plain',key);e.dataTransfer.effectAllowed='move'},dragOverPlanTask,dropPlanTaskAt,clearPlannerDropHint,startTouchPlanDrag,moveTouchPlanDrag,endTouchPlanDrag,deleteManualTask:async key=>{state.manualTasks=state.manualTasks.filter(t=>t.key!==key);delete state.planOverrides[key];delete state.checkedTasks[key];await persist();close();render()},
  newInventory:()=>inventoryForm(),editInventory:x=>inventoryForm(state.inventory.find(i=>i.id===x)),deleteInventory:async x=>{if(confirm('למחוק את הפריט?')){state.inventory=state.inventory.filter(i=>i.id!==x);await persist();render()}},
  newSupplier:()=>supplierForm(),editSupplier:x=>supplierForm(state.suppliers.find(s=>s.id===x)),deleteSupplier:async x=>{if(confirm('למחוק את הספק?')){state.suppliers=state.suppliers.filter(s=>s.id!==x);await persist();render()}},addPrice:()=>document.getElementById('supplierPrices').insertAdjacentHTML('beforeend',priceRow({ingredient:'',packQty:1,unit:'ק"ג',packPrice:0})),
  filterPriceCatalog,schedulePriceCatalogFilter,setPrivateBrandFilter,clearPriceCatalogFilters,linkCatalogProduct,deletePriceImport:async x=>{if(confirm('למחוק את קובץ המחירים שיובא?')){state.priceImports=state.priceImports.filter(i=>i.id!==x);await persist();render()}},
  exportData,cloudLogin:()=>cloudAuth('login'),cloudSignup:()=>cloudAuth('signup'),pullCloud,logout:async()=>{stopCloudSync();if(cloud.client)await cloud.client.auth.signOut();cloud.user=null;setStatus('התנתקת מהענן');render()},resetAll:async()=>{if(confirm('למחוק את כל הנתונים?')){state=empty();await persist(false);render()}}
};

document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.view));
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
      const registration=await navigator.serviceWorker.register('./sw.js?v=960',{updateViaCache:'none'});
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
