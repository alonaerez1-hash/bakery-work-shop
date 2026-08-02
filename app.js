(() => {
'use strict';
const LS_KEY='bakery_os_state_v1', CLOUD_KEY='bakery_os_cloud_v1';
const UNITS=['גרם','ק"ג','מ"ל','ליטר','יחידה','חבילה','כפית','כף','כוס'];
const WEIGHT={'גרם':1,'ק"ג':1000}, VOLUME={'מ"ל':1,'ליטר':1000};
const STATUSES=['חדשה','מאושרת','בייצור','מוכנה','נמסרה','בוטלה'];
const CATS=['יבשים','מקרר','קפואים','תוספות','אריזות','אחר'];
let currentView='dashboard', cloud={client:null,user:null};
const empty=()=>({settings:{businessName:'Bakery OS',currency:'₪',laborRate:45,distanceCostPerKm:1.5,ovens:1,ovenTrays:2,workStart:'08:00',workEnd:'18:00'},recipes:[],orders:[],inventory:[],suppliers:[],checkedTasks:{},checkedShopping:{},updatedAt:null});
let state=load();
function load(){try{return {...empty(),...JSON.parse(localStorage.getItem(LS_KEY)||'null')}}catch(e){return empty()}}
function id(p='id'){return p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(n,d=2){return Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:d})}
function money(n){return `${fmt(n)} ${state.settings.currency||'₪'}`}
function dateText(v){if(!v)return'—';const d=new Date(v);return isNaN(d)?'—':d.toLocaleString('he-IL',{dateStyle:'short',timeStyle:v.includes('T')?'short':undefined})}
function dayKey(v){const d=new Date(v);return new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString().slice(0,10)}
function addDays(v,n){const d=new Date(v);d.setDate(d.getDate()+n);return d}
function norm(q,u){if(WEIGHT[u])return{qty:Number(q||0)*WEIGHT[u],unit:'גרם'};if(VOLUME[u])return{qty:Number(q||0)*VOLUME[u],unit:'מ"ל'};return{qty:Number(q||0),unit:u}}

/* מנוע פנימי לחישוב משקל ואידוי. אין צורך בסימון ליד כל רכיב. */
const INGREDIENT_PROFILES=[
{keys:['חלבון ביצה','חלבוני ביצה','חלבונים','egg white'],density:1.03,water:.88,unitWeight:33},
{keys:['חלמון','חלמונים','egg yolk'],density:1.03,water:.50,unitWeight:18},
{keys:['שמנת חמוצה','sour cream'],density:1,water:.73},
{keys:['אבקת סוכר','powdered sugar','icing sugar'],density:.56,water:0},
{keys:['סוכר חום','brown sugar'],density:.88,water:0},
{keys:['שוקולד צ׳יפס','שוקולד ציפס','שוקולד צ\'יפס','chocolate chips'],density:.72,water:0},
{keys:['תמצית וניל','vanilla extract'],density:.95,water:.65},
{keys:['יוגורט','yogurt'],density:1.03,water:.84},
{keys:['מחית','puree'],density:1,water:.80},
{keys:['ריבה','jam'],density:1.30,water:.30},
{keys:['סירופ','syrup'],density:1.30,water:.35},
{keys:['דבש','honey'],density:1.42,water:.17},
{keys:['שמנת','cream'],density:.99,water:.60},
{keys:['חמאה','butter'],density:.96,water:.16},
{keys:['מרגרינה','margarine'],density:.96,water:.16},
{keys:['שמן','oil'],density:.92,water:0},
{keys:['חלב','milk'],density:1.03,water:.87},
{keys:['מיץ','juice'],density:1.04,water:.90},
{keys:['ביצה','ביצים','egg'],density:1.03,water:.74,unitWeight:50},
{keys:['מים','water'],density:1,water:1},
{keys:['קמח','flour'],density:.53,water:0},
{keys:['קקאו','cocoa'],density:.42,water:0},
{keys:['שיבולת שועל','קוואקר','oats'],density:.36,water:0},
{keys:['סוכר','sugar'],density:.85,water:0},
{keys:['שוקולד','chocolate'],density:.72,water:0}
];
function cleanIngredientName(name){return String(name||'').toLowerCase().replace(/[״"']/g,'').replace(/[^\u0590-\u05ffa-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()}
function ingredientProfile(name){const n=cleanIngredientName(name);return INGREDIENT_PROFILES.find(p=>p.keys.some(k=>n.includes(cleanIngredientName(k))))||{density:1,water:0}}
function ingredientWeightData(i){const qty=Number(i?.qty||0),unit=i?.unit||'גרם',p=ingredientProfile(i?.name);if(!qty)return{grams:0,waterGrams:0,known:true};let grams=0,known=true;if(unit==='גרם')grams=qty;else if(unit==='ק"ג')grams=qty*1000;else if(unit==='מ"ל')grams=qty*p.density;else if(unit==='ליטר')grams=qty*1000*p.density;else if(unit==='כפית')grams=qty*5*p.density;else if(unit==='כף')grams=qty*15*p.density;else if(unit==='כוס')grams=qty*240*p.density;else if((unit==='יחידה'||unit==='חבילה')&&p.unitWeight)grams=qty*p.unitWeight;else known=false;return{grams:known?grams:0,waterGrams:known?grams*Number(p.water||0):0,known}}
function calculateRecipeWeight(r,override){const ingredients=override||r?.ingredients||[];let rawWeight=0,waterAvailable=0,excludedCount=0;ingredients.forEach(i=>{const x=ingredientWeightData(i);rawWeight+=x.grams;waterAvailable+=x.waterGrams;if(!x.known&&Number(i.qty||0)>0)excludedCount++});const evaporationPct=Math.max(0,Math.min(100,Number(r?.evaporationPct??12)));const evaporationLoss=Math.min(waterAvailable,waterAvailable*evaporationPct/100);return{rawWeight,waterAvailable,evaporationPct,evaporationLoss,finalWeight:Math.max(0,rawWeight-evaporationLoss),excludedCount}}
function readRecipeFormIngredients(){return[...document.querySelectorAll('.ingredient-row')].map(x=>({name:x.querySelector('.ri-n').value.trim(),qty:Number(x.querySelector('.ri-q').value||0),unit:x.querySelector('.ri-u').value,category:x.querySelector('.ri-c').value})).filter(x=>x.name&&x.qty)}
function updateRecipeWeightPreview(){const form=document.getElementById('recipeForm'),box=document.getElementById('recipeWeightPreview');if(!form||!box)return;const ingredients=readRecipeFormIngredients(),evaporationPct=Number(form.elements.evaporationPct?.value||0),yieldUnits=Number(form.elements.yieldUnits?.value||1),w=calculateRecipeWeight({evaporationPct},ingredients),perUnit=w.finalWeight/(yieldUnits||1);if(form.elements.unitWeight)form.elements.unitWeight.value=w.finalWeight?Math.round(perUnit*100)/100:0;box.innerHTML=w.rawWeight?`<strong>משקל מחושב:</strong> לפני אפייה ${showQty(w.rawWeight,'גרם')} · אידוי משוער ${showQty(w.evaporationLoss,'גרם')} · אחרי אפייה ${showQty(w.finalWeight,'גרם')} · ${fmt(perUnit)} גרם ליחידה${w.excludedCount?`<div class="hint">החישוב אינו כולל ${w.excludedCount} רכיבים שלא נמצאה להם המרת משקל פנימית.</div>`:''}`:'הוסיפי רכיבים וכמויות כדי לחשב משקל אוטומטית.'}

function showQty(q,u){if(u==='גרם'&&q>=1000)return`${fmt(q/1000)} ק"ג`;if(u==='מ"ל'&&q>=1000)return`${fmt(q/1000)} ליטר`;return`${fmt(q)} ${u}`}
function setStatus(t){const e=document.getElementById('saveStatus');if(e)e.textContent=t||''}
async function persist(sync=true){state.updatedAt=new Date().toISOString();localStorage.setItem(LS_KEY,JSON.stringify(state));setStatus('✓ נשמר');setTimeout(()=>setStatus(''),1200);if(sync&&cloud.user)await pushCloud()}
function recipe(x){return state.recipes.find(r=>r.id===x)}
function activeOrders(){return state.orders.filter(o=>!['נמסרה','בוטלה'].includes(o.status))}
function revenue(o){return(o.items||[]).reduce((s,i)=>s+(recipe(i.recipeId)?.salePrice||0)*Number(i.qty||0),0)}
function inventoryPackageCount(i){
  if(i?.packageCount!==undefined)return Math.max(0,Math.floor(Number(i.packageCount)||0));
  return Number(i?.qty||0)>0?1:0
}
function inventoryAmountPerPackage(i){
  if(i?.amountPerPackage!==undefined)return Math.max(0,Number(i.amountPerPackage)||0);
  return Math.max(0,Number(i?.qty||0))
}
function inventoryTotal(i){
  if(i?.packageCount!==undefined||i?.amountPerPackage!==undefined)return inventoryPackageCount(i)*inventoryAmountPerPackage(i);
  return Math.max(0,Number(i?.qty||0))
}
function inventoryMinPackageCount(i){
  if(i?.minPackageCount!==undefined)return Math.max(0,Math.floor(Number(i.minPackageCount)||0));
  const per=inventoryAmountPerPackage(i);
  return per>0?Math.ceil(Number(i?.minQty||0)/per):0
}
function inventoryMinTotal(i){
  if(i?.minPackageCount!==undefined)return inventoryMinPackageCount(i)*inventoryAmountPerPackage(i);
  return Math.max(0,Number(i?.minQty||0))
}
function inventoryPackCost(i){return Math.max(0,Number(i?.costPerPackage??i?.unitCost??0))}
function invAmount(name,unit){
  const t=norm(1,unit);let total=0;
  state.inventory.forEach(i=>{
    if(String(i.name||'').trim().toLowerCase()!==String(name||'').trim().toLowerCase())return;
    const x=norm(inventoryTotal(i),i.unit);
    if(x.unit===t.unit)total+=x.qty
  });
  return total
}
function unitCost(name,unit){
  const t=norm(1,unit),a=[];
  state.inventory.forEach(i=>{
    if(String(i.name||'').trim().toLowerCase()!==String(name||'').trim().toLowerCase())return;
    const packQty=inventoryAmountPerPackage(i),pack=norm(packQty,i.unit),cost=inventoryPackCost(i);
    if(cost>0&&pack.unit===t.unit&&pack.qty>0)a.push(cost/pack.qty)
  });
  state.suppliers.forEach(s=>(s.prices||[]).forEach(p=>{
    if(String(p.ingredient||'').trim().toLowerCase()===String(name||'').trim().toLowerCase()){
      const x=norm(p.packQty,p.unit);
      if(x.unit===t.unit&&x.qty)a.push(Number(p.packPrice)/x.qty)
    }
  }));
  return a.length?Math.min(...a):0
}
function recipeCost(r){let ingredients=0;(r.ingredients||[]).forEach(i=>{const x=norm(i.qty,i.unit);ingredients+=x.qty*unitCost(i.name,i.unit)});const labor=(Number(r.prepMin||0)+Number(r.bakeMin||0))/60*Number(state.settings.laborRate||0);const packaging=Number(r.packagingCost||0)*(Number(r.yieldUnits)||1);const total=(ingredients+labor+packaging)*(1+Number(r.wastePct||0)/100);return{ingredients,labor,packaging,total,perUnit:total/(Number(r.yieldUnits)||1)}}
function demand(){const byRecipe={},ingredients={};activeOrders().forEach(o=>(o.items||[]).forEach(i=>byRecipe[i.recipeId]=(byRecipe[i.recipeId]||0)+Number(i.qty||0)));Object.entries(byRecipe).forEach(([rid,q])=>{const r=recipe(rid);if(!r)return;const batches=Math.ceil(q/(Number(r.yieldUnits)||1));(r.ingredients||[]).forEach(i=>{const x=norm(Number(i.qty||0)*batches,i.unit),k=i.name.trim().toLowerCase()+'|'+x.unit;if(!ingredients[k])ingredients[k]={name:i.name,unit:x.unit,required:0,category:i.category||'אחר'};ingredients[k].required+=x.qty})});return{byRecipe,ingredients}}
function tasks(){const out=[];activeOrders().forEach(o=>(o.items||[]).forEach(it=>{const r=recipe(it.recipeId);if(!r)return;const batches=Math.ceil(Number(it.qty||0)/(Number(r.yieldUnits)||1)),steps=r.steps?.length?r.steps:[{text:'הכנת חומרי גלם ושקילות',daysBefore:1},{text:'הכנה ואפייה',daysBefore:0},{text:'קירור, אריזה ותיוג',daysBefore:0}];steps.forEach((s,n)=>{const d=addDays(o.dueAt,-Number(s.daysBefore||0)),key=`${o.id}|${r.id}|${n}|${dayKey(d)}`;out.push({key,date:dayKey(d),time:s.time||'',text:s.text,recipe:r.name,customer:o.customer,batches,qty:Number(it.qty||0),done:!!state.checkedTasks[key]})})}));return out.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function shopping(){return Object.entries(demand().ingredients).map(([key,x])=>{const available=invAmount(x.name,x.unit);return{...x,key,available,need:Math.max(0,x.required-available),checked:!!state.checkedShopping[key]}}).filter(x=>x.need>0).sort((a,b)=>a.category.localeCompare(b.category,'he')||a.name.localeCompare(b.name,'he'))}
function supplierOptions(){const items=shopping();return state.suppliers.map(s=>{let itemsCost=0,covered=0;(items||[]).forEach(it=>{let best=null;(s.prices||[]).filter(p=>p.ingredient.trim().toLowerCase()===it.name.trim().toLowerCase()).forEach(p=>{const x=norm(p.packQty,p.unit);if(x.unit!==it.unit||!x.qty)return;const packs=Math.ceil(it.need/x.qty),cost=packs*Number(p.packPrice||0);if(!best||cost<best)best=cost});if(best!==null){itemsCost+=best;covered++}});const delivery=Number(s.deliveryCost||0),distanceCost=Number(s.distanceKm||0)*2*Number(state.settings.distanceCostPerKm||0);return{supplier:s,itemsCost,covered,delivery,distanceCost,total:itemsCost+delivery+distanceCost}}).sort((a,b)=>a.total-b.total)}
function go(v){currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+v));document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view===v));render()}
function modal(title,html){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=html;document.getElementById('modal').classList.add('open')}
function close(){document.getElementById('modal').classList.remove('open')}
function render(){
  document.getElementById('brandTitle').textContent=state.settings.businessName||'Bakery OS';
  ({dashboard:renderDashboard,orders:renderOrders,recipes:renderRecipes,recipebook:renderRecipeBook,production:renderProduction,shopping:renderShopping,inventory:renderInventory,suppliers:renderSuppliers,reports:renderReports,settings:renderSettings}[currentView]||renderDashboard)()
}
function taskHtml(t){return`<div class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="App.toggleTask('${t.key}')"><div class="task-text"><strong>${esc(t.text)}</strong><div class="meta">${esc(t.recipe)} · ${t.batches} כפולות · ${fmt(t.qty,0)} יחידות · ${esc(t.customer)} ${t.time?'· '+t.time:''}</div></div></div>`}
function renderDashboard(){const os=activeOrders(),ts=tasks(),today=dayKey(new Date()),low=state.inventory.filter(i=>inventoryTotal(i)<=inventoryMinTotal(i)).length,up=os.slice().sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,5);document.getElementById('view-dashboard').innerHTML=`<div class="grid four"><div class="metric"><div class="label">הזמנות פעילות</div><div class="value">${os.length}</div></div><div class="metric"><div class="label">הכנסה צפויה</div><div class="value">${money(os.reduce((s,o)=>s+revenue(o),0))}</div></div><div class="metric"><div class="label">משימות להיום</div><div class="value">${ts.filter(t=>t.date===today&&!t.done).length}</div></div><div class="metric"><div class="label">מלאי נמוך</div><div class="value">${low}</div></div></div><div class="grid two" style="margin-top:14px"><div class="card"><div class="section-head"><h2>הזמנות קרובות</h2><button class="btn small secondary" onclick="App.newOrder()">+ הזמנה</button></div>${up.length?`<div class="list">${up.map(o=>`<div class="list-item"><div class="item-row"><div><div class="title">${esc(o.customer)}</div><div class="meta">${dateText(o.dueAt)} · ${esc(o.status)} · ${money(revenue(o))}</div></div><span class="badge blue">${esc(o.delivery)}</span></div></div>`).join('')}</div>`:'<div class="empty">אין הזמנות פעילות</div>'}</div><div class="card"><h2>היום בייצור</h2>${ts.filter(t=>t.date===today).map(taskHtml).join('')||'<div class="empty">אין משימות להיום</div>'}</div></div><div class="grid two" style="margin-top:14px"><div class="card"><h2>קניות נדרשות</h2>${shopping().slice(0,6).map(i=>`<div class="kpi-line"><span>${esc(i.name)}</span><strong>${showQty(i.need,i.unit)}</strong></div>`).join('')||'<div class="empty">אין חוסרים</div>'}</div><div class="card"><h2>פעולות מהירות</h2><div class="actions"><button class="btn" onclick="App.newRecipe()">מתכון חדש</button><button class="btn secondary" onclick="App.newOrder()">הזמנה חדשה</button><button class="btn ghost" onclick="App.newInventory()">עדכון מלאי</button></div></div></div>`}
function renderOrders(){const rows=state.orders.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));document.getElementById('view-orders').innerHTML=`<div class="card"><div class="section-head"><div><h2>הזמנות</h2><div class="hint">כל הזמנה מזינה את תוכנית הייצור והקניות.</div></div><button class="btn secondary" onclick="App.newOrder()">+ הזמנה חדשה</button></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>לקוחה</th><th>מועד</th><th>פריטים</th><th>סטטוס</th><th>תשלום</th><th>סכום</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td><strong>${esc(o.customer)}</strong><div class="muted">${esc(o.phone||'')}</div></td><td>${dateText(o.dueAt)}<div class="muted">${esc(o.delivery)}</div></td><td>${(o.items||[]).map(i=>`${esc(recipe(i.recipeId)?.name||'מתכון נמחק')} × ${fmt(i.qty,0)}`).join('<br>')}</td><td><span class="badge">${esc(o.status)}</span></td><td>${o.paid?'<span class="badge green">שולם</span>':'<span class="badge red">לא שולם</span>'}</td><td class="money">${money(revenue(o))}</td><td><div class="actions"><button class="btn small ghost" onclick="App.editOrder('${o.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteOrder('${o.id}')">מחיקה</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">עדיין אין הזמנות</div>'}</div>`}
function orderRow(i){return`<div class="repeat-row order-item-row"><div class="field"><label>מתכון</label><select class="oi-r" required><option value="">בחירה</option>${state.recipes.map(r=>`<option value="${r.id}" ${i.recipeId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>כמות</label><input class="oi-q" type="number" min="1" value="${i.qty||1}"></div><div></div><div></div><button type="button" class="btn small danger" onclick="this.closest('.order-item-row').remove()">הסר</button></div>`}
function orderForm(o={id:'',customer:'',phone:'',dueAt:'',delivery:'איסוף עצמי',status:'חדשה',paid:false,notes:'',items:[]}){modal(o.id?'עריכת הזמנה':'הזמנה חדשה',`<form id="orderForm"><input type="hidden" name="id" value="${esc(o.id)}"><div class="form-grid"><div class="field"><label>שם הלקוחה</label><input name="customer" required value="${esc(o.customer)}"></div><div class="field"><label>טלפון</label><input name="phone" value="${esc(o.phone)}"></div><div class="field"><label>מועד אספקה</label><input name="dueAt" type="datetime-local" required value="${esc((o.dueAt||'').slice(0,16))}"></div><div class="field"><label>מסירה</label><select name="delivery">${['איסוף עצמי','משלוח'].map(x=>`<option ${o.delivery===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>סטטוס</label><select name="status">${STATUSES.map(x=>`<option ${o.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>תשלום</label><select name="paid"><option value="false" ${!o.paid?'selected':''}>לא שולם</option><option value="true" ${o.paid?'selected':''}>שולם</option></select></div><div class="field full"><label>מוצרים</label><div id="orderItems">${(o.items.length?o.items:[{recipeId:'',qty:1}]).map(orderRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addOrderItem()">+ מוצר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(o.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('orderForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.orders.find(x=>x.id===f.get('id')),items=[...document.querySelectorAll('.order-item-row')].map(r=>({recipeId:r.querySelector('.oi-r').value,qty:Number(r.querySelector('.oi-q').value||0)})).filter(x=>x.recipeId&&x.qty);if(!items.length)return alert('יש להוסיף מוצר');const x={id:f.get('id')||id('ord'),customer:f.get('customer'),phone:f.get('phone'),dueAt:f.get('dueAt'),delivery:f.get('delivery'),status:f.get('status'),paid:f.get('paid')==='true',notes:f.get('notes'),items,createdAt:ex?.createdAt||new Date().toISOString()};if(ex)Object.assign(ex,x);else state.orders.push(x);await persist();close();render()}}
const FRACTION_VALUES={'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875,'חצי':.5,'רבע':.25,'שליש':1/3};
const UNIT_ALIASES=[
  {re:/^(?:ק[״\"]?ג|קילו(?:גרם)?|קילוגרם|קילוגרמים)(?=\s|$)/i,unit:'ק"ג'},
  {re:/^(?:גרם|גרמים|גר׳|ג׳|ג')(?=\s|$)/i,unit:'גרם'},
  {re:/^(?:מ[״\"]?ל|מיליליטר(?:ים)?)(?=\s|$)/i,unit:'מ"ל'},
  {re:/^(?:ליטר|ליטרים)(?=\s|$)/i,unit:'ליטר'},
  {re:/^(?:כוס|כוסות)(?=\s|$)/i,unit:'כוס'},
  {re:/^(?:כף|כפות)(?=\s|$)/i,unit:'כף'},
  {re:/^(?:כפית|כפיות)(?=\s|$)/i,unit:'כפית'},
  {re:/^(?:חבילה|חבילות|מארז|מארזים|שקית|שקיות)(?=\s|$)/i,unit:'חבילה'},
  {re:/^(?:יחידה|יחידות)(?=\s|$)/i,unit:'יחידה'}
];
function parseNumberToken(token){
  token=String(token||'').trim().replace(',','.');
  if(FRACTION_VALUES[token]!==undefined)return FRACTION_VALUES[token];
  if(/^\d+\/\d+$/.test(token)){const[a,b]=token.split('/').map(Number);return b?a/b:0}
  if(/^\d+\s+\d+\/\d+$/.test(token)){const[m,f]=token.split(/\s+/,2);return Number(m)+parseNumberToken(f)}
  const n=Number(token);return Number.isFinite(n)?n:0
}
function ingredientCategory(name){
  const n=cleanIngredientName(name);
  if(/חלב|חמאה|שמנת|יוגורט|גבינ|ביצה|ביצים/.test(n))return'מקרר';
  if(/קפוא|גלידה/.test(n))return'קפואים';
  if(/קופס|שקית|נייר אפייה|אריז|מדבקה|סרט/.test(n))return'אריזות';
  if(/שוקולד|אגוז|שקד|פקאן|פיסטוק|צימוק|סוכריות|תמצית|וניל|מחית|ריבה|ממרח/.test(n))return'תוספות';
  if(/קמח|סוכר|קקאו|מלח|אבקת אפייה|סודה|שמרים|קורנפלור|שיבולת|קוואקר/.test(n))return'יבשים';
  return'אחר'
}
function recipeCategoryFromText(text){const n=cleanIngredientName(text);if(/עוגיות|קוקי/.test(n))return'עוגיות';if(/עוגה|טארט|פאי/.test(n))return'עוגות';if(/לחם|חלה|לחמנ/.test(n))return'לחמים';if(/מאפין|קאפקייק/.test(n))return'מאפינס';if(/קרואסון|בורקס|מאפה/.test(n))return'מאפים';return'אחר'}
function parseIngredientLine(line){
  let s=String(line||'').trim().replace(/^[•*\-–—]+\s*/,'').replace(/\s+/g,' ');
  if(!s)return null;
  let qty=0,rest='';
  const mixed=s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞]|חצי|רבע|שליש)\s*(.*)$/i);
  if(!mixed)return null;
  qty=parseNumberToken(mixed[1]);rest=mixed[2].trim();
  if(!qty||!rest)return null;
  let unit='יחידה';
  for(const a of UNIT_ALIASES){const m=rest.match(a.re);if(m){unit=a.unit;rest=rest.slice(m[0].length).trim();break}}
  if(/^ביצ(?:ה|ים)\b/.test(rest)){unit='יחידה';rest=rest.replace(/^ביצ(?:ה|ים)\b/,'ביצה')}
  rest=rest.replace(/^של\s+/,'').replace(/[,:;.-]+$/,'').trim();
  if(!rest)return null;
  return{name:rest,qty,unit,category:ingredientCategory(rest)}
}
function inferAllergens(ingredients){
  const text=cleanIngredientName((ingredients||[]).map(i=>i.name).join(' ')),a=[];
  if(/קמח|גלוטן|חיטה|שיבולת|שיפון|שעורה/.test(text))a.push('גלוטן');
  if(/חלב|חמאה|שמנת|יוגורט|גבינ/.test(text))a.push('חלב');
  if(/ביצה|ביצים|חלבון|חלמון/.test(text))a.push('ביצים');
  if(/אגוז|שקד|פקאן|פיסטוק|לוז|קשיו/.test(text))a.push('אגוזים');
  if(/בוטנ/.test(text))a.push('בוטנים');
  if(/שומשום|טחינה/.test(text))a.push('שומשום');
  if(/סויה/.test(text))a.push('סויה');
  return a.join(', ')
}
function localParseRecipe(text){
  const raw=String(text||'').replace(/\r/g,''),lines=raw.split('\n').map(x=>x.trim()).filter(Boolean),ingredients=[],steps=[];
  let name='',inSteps=false;
  lines.forEach((line,index)=>{
    if(/^(?:אופן הכנה|הוראות|הכנה|שלבי הכנה|method|instructions)\s*:?$/i.test(line)){inSteps=true;return}
    if(/^(?:מצרכים|רכיבים|ingredients)\s*:?$/i.test(line)){inSteps=false;return}
    const ing=parseIngredientLine(line);
    if(ing&&!inSteps){ingredients.push(ing);return}
    if(!name&&index<3&&!/^(?:זמן|תפוקה|מצרכים|רכיבים)/.test(line)&&!ing){name=line.replace(/[:\-–—]+$/,'').trim();return}
    if(ingredients.length||inSteps){const clean=line.replace(/^\d+[.)]\s*/,'').replace(/^[•*\-–—]+\s*/,'').trim();if(clean&&!/^(?:מצרכים|רכיבים|תפוקה|זמן\s+הכנה|זמן\s+אפייה|טמפרטורה|חום\s+תנור)/.test(clean))steps.push({text:clean,daysBefore:0,time:''})}
  });
  const temp=raw.match(/(\d{2,3})\s*(?:°|מעלות)/),bake=raw.match(/(?:אופים?|אפייה)[^\d]{0,25}(\d+)\s*(?:דקות|דק['׳]?)/i)||raw.match(/(\d+)\s*(?:דקות|דק['׳]?)\s+(?:אפייה|בתנור)/i),prep=raw.match(/זמן\s+הכנה[^\d]{0,10}(\d+)/),yieldM=raw.match(/(?:תפוקה|יוצא|מתקבל(?:ות|ים)?)[^\d]{0,15}(\d+)\s*(?:יחידות|עוגיות|מאפים|מנות)?/i);
  return{name:name||'מתכון מיובא',category:recipeCategoryFromText(name+' '+raw),yieldUnits:yieldM?Number(yieldM[1]):12,unitWeight:0,prepMin:prep?Number(prep[1]):30,restMin:0,bakeMin:bake?Number(bake[1]):0,ovenTemp:temp?Number(temp[1]):0,traysPerBatch:1,unitsPerTray:12,shelfLifeDays:4,packagingCost:0,wastePct:5,evaporationPct:12,salePrice:0,allergens:inferAllergens(ingredients),notes:'',ingredients,steps}
}
function sanitizeImportedRecipe(data,text){
  const base=localParseRecipe(text),x=data&&typeof data==='object'?data:{};
  return{...base,...x,id:'',name:String(x.name||base.name||'מתכון מיובא'),category:String(x.category||base.category||'אחר'),yieldUnits:Math.max(1,Number(x.yieldUnits||base.yieldUnits||12)),unitWeight:0,prepMin:Math.max(0,Number(x.prepMin??base.prepMin??0)),restMin:Math.max(0,Number(x.restMin??base.restMin??0)),bakeMin:Math.max(0,Number(x.bakeMin??base.bakeMin??0)),ovenTemp:Math.max(0,Number(x.ovenTemp??base.ovenTemp??0)),traysPerBatch:Math.max(1,Number(x.traysPerBatch||1)),unitsPerTray:Math.max(1,Number(x.unitsPerTray||12)),shelfLifeDays:Math.max(0,Number(x.shelfLifeDays??4)),packagingCost:0,wastePct:5,evaporationPct:12,salePrice:0,allergens:String(x.allergens||inferAllergens(x.ingredients||base.ingredients)),notes:String(x.notes||''),ingredients:(Array.isArray(x.ingredients)?x.ingredients:base.ingredients).map(i=>({name:String(i.name||'').trim(),qty:Math.max(0,Number(i.qty||0)),unit:UNITS.includes(i.unit)?i.unit:'גרם',category:CATS.includes(i.category)?i.category:ingredientCategory(i.name)})).filter(i=>i.name&&i.qty),steps:(Array.isArray(x.steps)?x.steps:base.steps).map(s=>({text:String(s.text||s||'').trim(),daysBefore:Math.max(0,Number(s.daysBefore||0)),time:String(s.time||'')})).filter(s=>s.text)}
}
async function parseRecipeWithAI(text){
  if(!cloud.client||!cloud.user)return null;
  try{const {data,error}=await cloud.client.functions.invoke('parse-recipe',{body:{text}});if(error)throw error;return data?.recipe||data}catch(e){console.warn('AI recipe import unavailable; using local parser.',e);return null}
}
function importRecipeModal(){
  modal('הדבקת מתכון חכמה',`<div class="field"><label>הדביקי כאן את המתכון המלא</label><textarea id="recipeImportText" class="recipe-import-text" placeholder="שם המתכון\n\n250 גרם קמח\n150 גרם חמאה\n...\n\nאופן הכנה:\nמערבבים...\nאופים 12 דקות ב־175 מעלות."></textarea><div class="hint">כאשר חיבור ה־AI פעיל, המתכון יעבור ניתוח מאובטח דרך Supabase. בלי החיבור, יופעל מנתח מקומי וניתן לתקן הכול לפני השמירה.</div></div><div id="recipeImportStatus"></div><div class="actions" style="margin-top:14px"><button class="btn secondary" type="button" onclick="App.analyzeRecipeImport()">ניתוח ופתיחת המתכון</button><button class="btn ghost" type="button" onclick="App.close()">ביטול</button></div>`);
  setTimeout(()=>document.getElementById('recipeImportText')?.focus(),50)
}
async function analyzeRecipeImport(){
  const text=document.getElementById('recipeImportText')?.value.trim(),status=document.getElementById('recipeImportStatus');
  if(!text)return alert('יש להדביק מתכון');
  if(status)status.innerHTML='<div class="notice" style="margin-top:12px">מנתחת את המתכון…</div>';
  const ai=await parseRecipeWithAI(text),parsed=sanitizeImportedRecipe(ai||localParseRecipe(text),text);
  close();recipeForm(parsed)
}
function recipeBookCard(r){const w=calculateRecipeWeight(r);return`<article class="recipe-card" data-search="${esc((r.name+' '+r.category).toLowerCase())}" data-category="${esc(r.category||'אחר')}"><button class="recipe-card-main" onclick="App.openBookRecipe('${r.id}')"><div class="recipe-card-kicker">${esc(r.category||'מתכון')}</div><h3>${esc(r.name)}</h3><div class="recipe-card-meta"><span>◷ ${fmt(Number(r.prepMin||0)+Number(r.bakeMin||0),0)} דק׳</span><span>◌ ${fmt(r.yieldUnits,0)} יחידות</span><span>⚖ ${showQty(w.finalWeight,'גרם')}</span></div></button><div class="recipe-card-actions"><button class="btn small secondary" onclick="App.openBookRecipe('${r.id}')">פתיחת מתכון</button><button class="btn small ghost" onclick="App.weightCalc('${r.id}')">משקל רצוי</button></div></article>`}
function renderRecipeBook(){
  const cats=[...new Set(state.recipes.map(r=>r.category||'אחר'))].sort((a,b)=>a.localeCompare(b,'he'));
  document.getElementById('view-recipebook').innerHTML=`<div class="card recipe-book-shell"><div class="section-head"><div><h2>ספר המתכונים</h2><div class="hint">תצוגה נקייה ורציפה לעבודה במטבח.</div></div><button class="btn secondary" onclick="App.importRecipe()">✨ הדבקת מתכון</button></div><div class="recipe-book-toolbar"><div class="field"><label>חיפוש</label><input id="recipeBookSearch" type="search" placeholder="שם מתכון או קטגוריה" oninput="App.filterRecipeBook()"></div><div class="field"><label>קטגוריה</label><select id="recipeBookCategory" onchange="App.filterRecipeBook()"><option value="">הכול</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div></div><div id="recipeBookGrid" class="recipe-book-grid">${state.recipes.map(recipeBookCard).join('')||'<div class="empty">עדיין אין מתכונים בספר.</div>'}</div></div>`
}
function filterRecipeBook(){
  const q=String(document.getElementById('recipeBookSearch')?.value||'').toLowerCase().trim(),cat=document.getElementById('recipeBookCategory')?.value||'';
  document.querySelectorAll('#recipeBookGrid .recipe-card').forEach(card=>{const okQ=!q||card.dataset.search.includes(q),okC=!cat||card.dataset.category===cat;card.hidden=!(okQ&&okC)})
}
function recipePlainText(r){const w=calculateRecipeWeight(r);return`${r.name}\n${r.category||''}\n\nתפוקה: ${fmt(r.yieldUnits,0)} יחידות\nמשקל סופי משוער: ${showQty(w.finalWeight,'גרם')}\nזמן הכנה: ${fmt(r.prepMin,0)} דקות\nזמן אפייה: ${fmt(r.bakeMin,0)} דקות ב־${fmt(r.ovenTemp,0)}°\n\nמצרכים:\n${(r.ingredients||[]).map(i=>`• ${fmt(i.qty)} ${i.unit} ${i.name}`).join('\n')}\n\nאופן הכנה:\n${(r.steps||[]).map((s,n)=>`${n+1}. ${s.text}`).join('\n')}\n\nאלרגנים: ${r.allergens||'לא צוינו'}\n${r.notes||''}`}
function openBookRecipe(recipeId){
  const r=recipe(recipeId);if(!r)return;
  const w=calculateRecipeWeight(r),groups={};(r.ingredients||[]).forEach(i=>(groups[i.category||'אחר']??=[]).push(i));
  modal(r.name,`<article class="recipe-sheet"><header class="recipe-sheet-hero"><div><div class="recipe-card-kicker">${esc(r.category||'מתכון')}</div><h2>${esc(r.name)}</h2><p>${esc(r.notes||'')}</p></div><div class="recipe-sheet-stats"><div><strong>${fmt(r.yieldUnits,0)}</strong><span>יחידות</span></div><div><strong>${showQty(w.finalWeight,'גרם')}</strong><span>משקל סופי</span></div><div><strong>${fmt(r.prepMin,0)}+${fmt(r.bakeMin,0)}</strong><span>דקות</span></div><div><strong>${fmt(r.ovenTemp,0)}°</strong><span>אפייה</span></div></div></header><div class="recipe-sheet-grid"><section><h3>מצרכים</h3>${Object.entries(groups).map(([cat,items])=>`<div class="ingredient-group"><h4>${esc(cat)}</h4>${items.map(i=>`<div class="ingredient-line"><span>${esc(i.name)}</span><strong>${fmt(i.qty)} ${esc(i.unit)}</strong></div>`).join('')}</div>`).join('')||'<div class="empty">לא הוזנו מצרכים</div>'}</section><section><h3>אופן הכנה</h3><ol class="recipe-steps">${(r.steps||[]).map(s=>`<li>${esc(s.text)}</li>`).join('')||'<li>לא הוזנו שלבי הכנה.</li>'}</ol></section></div><footer class="recipe-sheet-footer"><div><strong>אלרגנים:</strong> ${esc(r.allergens||'לא צוינו')}</div><div><strong>חיי מדף:</strong> ${fmt(r.shelfLifeDays,0)} ימים</div><div><strong>אידוי משוער:</strong> ${showQty(w.evaporationLoss,'גרם')}</div></footer><div class="actions" style="margin-top:18px"><button class="btn secondary" onclick="App.weightCalc('${r.id}')">התאמה למשקל רצוי</button><button class="btn ghost" onclick="App.copyRecipe('${r.id}')">העתקה</button><button class="btn ghost" onclick="App.printRecipe('${r.id}')">הדפסה</button><button class="btn ghost" onclick="App.editRecipe('${r.id}')">עריכה</button></div></article>`)
}
async function copyRecipe(recipeId){const r=recipe(recipeId);if(!r)return;try{await navigator.clipboard.writeText(recipePlainText(r));setStatus('✓ המתכון הועתק')}catch(e){alert(recipePlainText(r))}}
function printRecipe(recipeId){const r=recipe(recipeId);if(!r)return;const w=window.open('','_blank','width=800,height=900');if(!w)return alert('הדפדפן חסם את חלון ההדפסה');w.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(r.name)}</title><style>body{font-family:Tahoma,Arial;max-width:760px;margin:30px auto;line-height:1.6;color:#2a160d}h1{border-bottom:3px solid #2a160d;padding-bottom:10px}.meta{display:flex;gap:20px;flex-wrap:wrap;background:#f7f0e6;padding:12px}.grid{display:grid;grid-template-columns:1fr 1.3fr;gap:30px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:7px 0}li{margin-bottom:10px}@media print{body{margin:0}.grid{grid-template-columns:1fr 1.3fr}}</style></head><body><h1>${esc(r.name)}</h1><div class="meta"><span>תפוקה: ${fmt(r.yieldUnits,0)}</span><span>משקל סופי: ${showQty(calculateRecipeWeight(r).finalWeight,'גרם')}</span><span>אפייה: ${fmt(r.bakeMin,0)} דק׳ · ${fmt(r.ovenTemp,0)}°</span></div><div class="grid"><section><h2>מצרכים</h2>${(r.ingredients||[]).map(i=>`<div class="line"><span>${esc(i.name)}</span><b>${fmt(i.qty)} ${esc(i.unit)}</b></div>`).join('')}</section><section><h2>אופן הכנה</h2><ol>${(r.steps||[]).map(s=>`<li>${esc(s.text)}</li>`).join('')}</ol></section></div><p><b>אלרגנים:</b> ${esc(r.allergens||'לא צוינו')}</p><p>${esc(r.notes||'')}</p><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}
function renderRecipes(){
  document.getElementById('view-recipes').innerHTML=`<div class="card"><div class="section-head"><div><h2>מתכונים וכרטיסי ייצור</h2><div class="hint">המשקל מחושב אוטומטית. האידוי מופחת רק מתכולת המים המשוערת ברכיבים.</div></div><div class="actions"><button class="btn secondary" onclick="App.importRecipe()">✨ הדבקת מתכון חכמה</button><button class="btn" onclick="App.newRecipe()">+ מתכון חדש</button></div></div>${state.recipes.length?`<div class="grid two">${state.recipes.map(r=>{const c=recipeCost(r),w=calculateRecipeWeight(r);return`<div class="list-item"><div class="item-row"><div><div class="title">${esc(r.name)}</div><div class="meta">${fmt(r.yieldUnits,0)} יחידות · ${fmt(w.finalWeight/(Number(r.yieldUnits)||1))} גרם ליחידה · ${fmt(r.prepMin,0)} דק' הכנה · ${fmt(r.bakeMin,0)} דק' אפייה</div></div><span class="badge gold">${money(c.perUnit)} ליחידה</span></div><div class="kpi-line"><span>משקל לפני אפייה</span><strong>${showQty(w.rawWeight,'גרם')}</strong></div><div class="kpi-line"><span>אידוי משוער</span><strong>${showQty(w.evaporationLoss,'גרם')}</strong></div><div class="kpi-line"><span>משקל סופי משוער</span><strong>${showQty(w.finalWeight,'גרם')}</strong></div><div class="kpi-line"><span>מחיר מכירה</span><strong>${money(r.salePrice)}</strong></div><div class="kpi-line"><span>רווח משוער ליחידה</span><strong>${money(Number(r.salePrice)-c.perUnit)}</strong></div>${w.excludedCount?`<div class="hint">יש ${w.excludedCount} רכיבים שלא נכללו במשקל משום שלא נמצאה להם המרה אמינה.</div>`:''}<div class="actions" style="margin-top:10px"><button class="btn small secondary" onclick="App.weightCalc('${r.id}')">התאמה למשקל רצוי</button><button class="btn small ghost" onclick="App.openBookRecipe('${r.id}')">תצוגת מתכון</button><button class="btn small ghost" onclick="App.editRecipe('${r.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteRecipe('${r.id}')">מחיקה</button></div></div>`}).join('')}</div>`:'<div class="empty">עדיין אין מתכונים. אפשר להדביק מתכון שלם והמערכת תחלק אותו לשדות.</div>'}</div>`
}
function ingredientRow(i){return`<div class="repeat-row ingredient-row"><div class="field"><label>רכיב</label><input class="ri-n" value="${esc(i.name||'')}"></div><div class="field"><label>כמות</label><input class="ri-q" type="number" min="0" step=".01" value="${i.qty??''}"></div><div class="field"><label>יחידה</label><select class="ri-u">${UNITS.map(u=>`<option ${i.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>קטגוריה</label><select class="ri-c">${CATS.map(c=>`<option ${i.category===c?'selected':''}>${c}</option>`).join('')}</select></div><button type="button" class="btn small danger" onclick="App.removeIngredient(this)">הסר</button></div>`}
function stepRow(s){return`<div class="repeat-row step-row"><div class="field"><label>תיאור</label><input class="rs-t" value="${esc(s.text||'')}"></div><div class="field"><label>ימים לפני</label><input class="rs-d" type="number" min="0" value="${s.daysBefore||0}"></div><div class="field"><label>שעה</label><input class="rs-h" type="time" value="${esc(s.time||'')}"></div><div></div><button type="button" class="btn small danger" onclick="this.closest('.step-row').remove()">הסר</button></div>`}
function recipeForm(r={id:'',name:'',category:'עוגיות',yieldUnits:12,unitWeight:0,prepMin:30,restMin:60,bakeMin:12,ovenTemp:175,traysPerBatch:1,unitsPerTray:12,shelfLifeDays:4,packagingCost:1,wastePct:5,evaporationPct:12,salePrice:12,allergens:'',notes:'',ingredients:[],steps:[]}){if(r.evaporationPct===undefined)r.evaporationPct=12;modal(r.id?'עריכת מתכון':'מתכון חדש',`<form id="recipeForm"><input type="hidden" name="id" value="${esc(r.id)}"><div class="form-grid three"><div class="field"><label>שם המתכון</label><input name="name" required value="${esc(r.name)}"></div><div class="field"><label>קטגוריה</label><input name="category" value="${esc(r.category)}"></div><div class="field"><label>תפוקה ביחידות</label><input name="yieldUnits" type="number" min="1" value="${r.yieldUnits}"></div><div class="field"><label>משקל יחידה — מחושב</label><input name="unitWeight" type="number" readonly value="${r.unitWeight||0}"></div><div class="field"><label>אחוז אידוי מהמים באפייה</label><input name="evaporationPct" type="number" min="0" max="100" step=".1" value="${r.evaporationPct}"><div class="hint">האחוז חל רק על המים שהמנוע מזהה ברכיבים, לא על קמח, סוכר או שוקולד.</div></div><div class="field"><label>זמן הכנה פעיל</label><input name="prepMin" type="number" min="0" value="${r.prepMin}"></div><div class="field"><label>מנוחה/קירור</label><input name="restMin" type="number" min="0" value="${r.restMin}"></div><div class="field"><label>זמן אפייה</label><input name="bakeMin" type="number" min="0" value="${r.bakeMin}"></div><div class="field"><label>טמפרטורה</label><input name="ovenTemp" type="number" value="${r.ovenTemp}"></div><div class="field"><label>מגשים לכפולה</label><input name="traysPerBatch" type="number" min="1" value="${r.traysPerBatch}"></div><div class="field"><label>יחידות במגש</label><input name="unitsPerTray" type="number" min="1" value="${r.unitsPerTray}"></div><div class="field"><label>חיי מדף</label><input name="shelfLifeDays" type="number" min="0" value="${r.shelfLifeDays}"></div><div class="field"><label>עלות אריזה ליחידה</label><input name="packagingCost" type="number" step=".01" min="0" value="${r.packagingCost}"></div><div class="field"><label>אחוז בזבוז</label><input name="wastePct" type="number" min="0" value="${r.wastePct}"></div><div class="field"><label>מחיר מכירה ליחידה</label><input name="salePrice" type="number" step=".01" min="0" value="${r.salePrice}"></div><div class="field"><label>אלרגנים</label><input name="allergens" value="${esc(r.allergens)}"></div><div class="field full"><label>רכיבים</label><div id="recipeIngredients">${(r.ingredients.length?r.ingredients:[{name:'',qty:'',unit:'גרם',category:'יבשים'}]).map(ingredientRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addIngredient()">+ רכיב</button></div><div class="field full"><div id="recipeWeightPreview" class="notice"></div></div><div class="field full"><label>שלבי עבודה</label><div id="recipeSteps">${(r.steps.length?r.steps:[{text:'',daysBefore:0,time:''}]).map(stepRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addStep()">+ שלב</button></div><div class="field full"><label>הערות ואחסון</label><textarea name="notes">${esc(r.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);const form=document.getElementById('recipeForm');form.addEventListener('input',updateRecipeWeightPreview);form.addEventListener('change',updateRecipeWeightPreview);updateRecipeWeightPreview();form.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.recipes.find(x=>x.id===f.get('id')),ingredients=readRecipeFormIngredients(),steps=[...document.querySelectorAll('.step-row')].map(x=>({text:x.querySelector('.rs-t').value.trim(),daysBefore:Number(x.querySelector('.rs-d').value||0),time:x.querySelector('.rs-h').value})).filter(x=>x.text),evaporationPct=Number(f.get('evaporationPct')||0),yieldUnits=Number(f.get('yieldUnits')||1),weight=calculateRecipeWeight({evaporationPct},ingredients),obj={id:f.get('id')||id('rec'),name:f.get('name'),category:f.get('category'),yieldUnits,unitWeight:weight.finalWeight/(yieldUnits||1),evaporationPct,prepMin:Number(f.get('prepMin')||0),restMin:Number(f.get('restMin')||0),bakeMin:Number(f.get('bakeMin')||0),ovenTemp:Number(f.get('ovenTemp')||0),traysPerBatch:Number(f.get('traysPerBatch')||1),unitsPerTray:Number(f.get('unitsPerTray')||1),shelfLifeDays:Number(f.get('shelfLifeDays')||0),packagingCost:Number(f.get('packagingCost')||0),wastePct:Number(f.get('wastePct')||0),salePrice:Number(f.get('salePrice')||0),allergens:f.get('allergens'),notes:f.get('notes'),ingredients,steps};if(ex)Object.assign(ex,obj);else state.recipes.push(obj);await persist();close();render()}}
function weightCalculator(r){if(!r)return;const base=calculateRecipeWeight(r);if(!base.finalWeight)return alert('לא ניתן לחשב משקל סופי לפני הזנת רכיבים עם כמויות ויחידות ניתנות להמרה.');const defaultKg=Math.round(base.finalWeight/10)/100;modal(`התאמת ${r.name} למשקל סופי`,`<div class="form-grid"><div class="field"><label>משקל סופי רצוי</label><input id="targetWeightValue" type="number" min=".01" step=".01" value="${defaultKg}"></div><div class="field"><label>יחידה</label><select id="targetWeightUnit"><option value="kg">ק"ג</option><option value="g">גרם</option></select></div></div><div id="weightScaleSummary" class="notice" style="margin-top:12px"></div><div id="weightScaleResults" style="margin-top:12px"></div><div class="actions" style="margin-top:14px"><button class="btn secondary" id="copyWeightPlan" type="button">העתקת רשימת מצרכים</button><button class="btn ghost" type="button" onclick="App.close()">סגירה</button></div>`);const value=document.getElementById('targetWeightValue'),unit=document.getElementById('targetWeightUnit'),summary=document.getElementById('weightScaleSummary'),results=document.getElementById('weightScaleResults'),copy=document.getElementById('copyWeightPlan');let copyText='';const update=()=>{const targetGrams=Number(value.value||0)*(unit.value==='kg'?1000:1),factor=targetGrams/base.finalWeight;if(!targetGrams||!isFinite(factor)){summary.textContent='הכניסי משקל סופי רצוי.';results.innerHTML='';return}const rows=(r.ingredients||[]).map(i=>({...i,scaledQty:Number(i.qty||0)*factor}));summary.innerHTML=`המתכון הבסיסי נותן <strong>${showQty(base.finalWeight,'גרם')}</strong>. כדי לקבל <strong>${showQty(targetGrams,'גרם')}</strong> יש להכפיל את המתכון פי <strong>${fmt(factor,3)}</strong>.`;results.innerHTML=`<div class="table-wrap"><table><thead><tr><th>רכיב</th><th>כמות חדשה</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.name)}</td><td><strong>${fmt(i.scaledQty,2)} ${esc(i.unit)}</strong></td></tr>`).join('')}</tbody></table></div>`;copyText=`${r.name}\nמשקל סופי רצוי: ${showQty(targetGrams,'גרם')}\nמקדם: ${fmt(factor,3)}\n\n`+rows.map(i=>`${i.name}: ${fmt(i.scaledQty,2)} ${i.unit}`).join('\n')};value.addEventListener('input',update);unit.addEventListener('change',update);copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copyText);copy.textContent='✓ הועתק'}catch(e){alert(copyText)}});update()}

function renderProduction(){const ts=tasks(),g={},d=demand().byRecipe;ts.forEach(t=>(g[t.date]||(g[t.date]=[])).push(t));document.getElementById('view-production').innerHTML=`<div class="grid two"><div class="card"><h2>כמויות וכפולות</h2>${Object.entries(d).map(([rid,q])=>{const r=recipe(rid),b=Math.ceil(q/(Number(r?.yieldUnits)||1)),left=b*(Number(r?.yieldUnits)||1)-q;return`<div class="kpi-line"><span>${esc(r?.name||'מתכון')}</span><strong>${fmt(q,0)} יח' · ${b} כפולות · עודף ${fmt(left,0)}</strong></div>`}).join('')||'<div class="empty">אין ייצור מתוכנן</div>'}</div><div class="card"><h2>עומס תנור ומגשים</h2>${Object.entries(d).map(([rid,q])=>{const r=recipe(rid);if(!r)return'';const b=Math.ceil(q/(r.yieldUnits||1));return`<div class="kpi-line"><span>${esc(r.name)}</span><strong>${b*(r.traysPerBatch||1)} מגשים · ${b*(r.bakeMin||0)} דק' תנור</strong></div>`}).join('')||'<div class="empty">אין עומס מחושב</div>'}</div></div><div class="card" style="margin-top:14px"><div class="section-head"><h2>סדר עבודה לפי יום</h2><button class="btn small ghost" onclick="window.print()">הדפסה</button></div>${Object.keys(g).length?Object.keys(g).sort().map(day=>`<div><div class="day-title">${new Date(day+'T12:00').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})}</div>${g[day].map(taskHtml).join('')}</div>`).join(''):'<div class="empty">הוסיפי הזמנות כדי ליצור תוכנית</div>'}</div>`}
function renderShopping(){const items=shopping(),g={},opts=supplierOptions(),best=opts[0];items.forEach(i=>(g[i.category]||(g[i.category]=[])).push(i));document.getElementById('view-shopping').innerHTML=`<div class="grid two"><div class="card"><div class="section-head"><h2>רשימת קניות מאוחדת</h2><button class="btn small ghost" onclick="window.print()">הדפסה</button></div>${items.length?Object.entries(g).map(([cat,a])=>`<h3>${esc(cat)}</h3>${a.map(i=>`<div class="task ${i.checked?'done':''}"><input type="checkbox" ${i.checked?'checked':''} onchange="App.toggleShopping('${esc(i.key)}')"><div class="task-text"><strong>${esc(i.name)}</strong><div class="meta">דרוש ${showQty(i.required,i.unit)} · במלאי ${showQty(i.available,i.unit)} · לקנייה ${showQty(i.need,i.unit)}</div></div></div>`).join('')}`).join(''):'<div class="empty">אין חוסרים</div>'}</div><div class="card"><h2>המלצת סל</h2>${best?`<div class="notice"><strong>${esc(best.supplier.name)}</strong><br>פריטים ${money(best.itemsCost)} · משלוח ${money(best.delivery)} · נסיעה ${money(best.distanceCost)}<br><strong>סה"כ ${money(best.total)}</strong></div><div class="hint" style="margin-top:10px">מבוסס על המחירים והמרחקים שהזנת, לא על סריקה חיה.</div>`:'<div class="empty">הוסיפי ספקים ומחירים</div>'}${opts.length?`<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>ספק</th><th>כיסוי</th><th>סה"כ</th></tr></thead><tbody>${opts.map(o=>`<tr><td>${esc(o.supplier.name)}</td><td>${o.covered}/${items.length}</td><td class="money">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`:''}</div></div>`}
function renderInventory(){
  const soon=addDays(new Date(),7);
  document.getElementById('view-inventory').innerHTML=`<div class="card"><div class="section-head"><div><h2>מלאי</h2><div class="hint">הזיני מספר אריזות ואת המשקל או הנפח של כל אריזה. הסכום הכולל מחושב אוטומטית.</div></div><button class="btn secondary" onclick="App.newInventory()">+ פריט מלאי</button></div>${state.inventory.length?`<div class="table-wrap"><table><thead><tr><th>רכיב</th><th>כמות יחידות</th><th>בכל יחידה</th><th>סה״כ במלאי</th><th>מינימום</th><th>תפוגה</th><th>מיקום</th><th>עלות ליחידה</th><th></th></tr></thead><tbody>${state.inventory.map(i=>{const count=inventoryPackageCount(i),per=inventoryAmountPerPackage(i),total=inventoryTotal(i),minCount=inventoryMinPackageCount(i),low=total<=inventoryMinTotal(i),exp=i.expiry&&new Date(i.expiry)<=soon;return`<tr><td><strong>${esc(i.name)}</strong>${low?'<div><span class="badge red">מלאי נמוך</span></div>':''}</td><td>${fmt(count,0)}</td><td>${showQty(per,i.unit)}</td><td><strong>${showQty(total,i.unit)}</strong></td><td>${fmt(minCount,0)} יחידות</td><td>${i.expiry?dateText(i.expiry):'—'} ${exp?'<span class="badge gold">קרוב</span>':''}</td><td>${esc(i.location||'')}</td><td>${money(inventoryPackCost(i))}</td><td><div class="actions"><button class="btn small ghost" onclick="App.editInventory('${i.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteInventory('${i.id}')">מחיקה</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">אין פריטי מלאי</div>'}</div>`
}
function inventoryForm(i={id:'',name:'',packageCount:0,amountPerPackage:0,unit:'גרם',minPackageCount:0,expiry:'',location:'',costPerPackage:0,supplierId:''}){
  const legacy=i.packageCount===undefined;
  const packageCount=legacy?(Number(i.qty||0)>0?1:0):inventoryPackageCount(i);
  const amountPerPackage=legacy?Number(i.qty||0):inventoryAmountPerPackage(i);
  const minPackageCount=legacy?(amountPerPackage>0?Math.ceil(Number(i.minQty||0)/amountPerPackage):0):inventoryMinPackageCount(i);
  const costPerPackage=inventoryPackCost(i);
  modal(i.id?'עריכת מלאי':'פריט מלאי חדש',`<form id="invForm"><input type="hidden" name="id" value="${esc(i.id)}"><div class="form-grid"><div class="field"><label>רכיב</label><input name="name" required value="${esc(i.name)}"></div><div class="field"><label>כמות יחידות</label><input name="packageCount" type="number" inputmode="numeric" step="1" min="0" value="${packageCount}"><div class="hint">מספר שלם בלבד, למשל 4 חבילות.</div></div><div class="field"><label>כמות בכל יחידה</label><input name="amountPerPackage" type="number" inputmode="decimal" step=".01" min="0" value="${amountPerPackage}"></div><div class="field"><label>יחידת מידה לכל יחידה</label><select name="unit">${UNITS.map(u=>`<option ${i.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>מינימום יחידות</label><input name="minPackageCount" type="number" inputmode="numeric" step="1" min="0" value="${minPackageCount}"></div><div class="field"><label>עלות לאריזה / יחידה</label><input name="costPerPackage" type="number" step=".01" min="0" value="${costPerPackage}"></div><div class="field"><label>תפוגה</label><input name="expiry" type="date" value="${esc(i.expiry)}"></div><div class="field"><label>מיקום אחסון</label><input name="location" value="${esc(i.location)}"></div><div class="field"><label>ספק</label><select name="supplierId"><option value="">ללא</option>${state.suppliers.map(s=>`<option value="${s.id}" ${i.supplierId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field full"><div id="inventoryTotalPreview" class="notice"></div></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);
  const form=document.getElementById('invForm');
  const update=()=>{const count=Math.max(0,Math.floor(Number(form.elements.packageCount.value)||0)),per=Math.max(0,Number(form.elements.amountPerPackage.value)||0),unit=form.elements.unit.value;form.elements.packageCount.value=count;document.getElementById('inventoryTotalPreview').innerHTML=`סה״כ במלאי: <strong>${showQty(count*per,unit)}</strong> (${fmt(count,0)} × ${showQty(per,unit)})`};
  form.addEventListener('input',update);form.addEventListener('change',update);update();
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.inventory.find(x=>x.id===f.get('id')),count=Math.max(0,Math.floor(Number(f.get('packageCount'))||0)),per=Math.max(0,Number(f.get('amountPerPackage'))||0),minCount=Math.max(0,Math.floor(Number(f.get('minPackageCount'))||0)),unit=f.get('unit'),cost=Math.max(0,Number(f.get('costPerPackage'))||0),x={id:f.get('id')||id('inv'),name:f.get('name'),packageCount:count,amountPerPackage:per,unit,minPackageCount:minCount,costPerPackage:cost,qty:count*per,minQty:minCount*per,unitCost:cost,expiry:f.get('expiry'),location:f.get('location'),supplierId:f.get('supplierId')};if(ex)Object.assign(ex,x);else state.inventory.push(x);await persist();close();render()}
}
function renderSuppliers(){const opts=supplierOptions();document.getElementById('view-suppliers').innerHTML=`<div class="grid two"><div class="card"><div class="section-head"><div><h2>ספקים וחנויות</h2><div class="hint">מחיר, מרחק ומשלוח לחישוב עלות אמיתית.</div></div><button class="btn secondary" onclick="App.newSupplier()">+ ספק</button></div>${state.suppliers.length?`<div class="list">${state.suppliers.map(s=>`<div class="list-item"><div class="item-row"><div><div class="title">${esc(s.name)}</div><div class="meta">${fmt(s.distanceKm)} ק"מ · משלוח ${money(s.deliveryCost)} · ${(s.prices||[]).length} מחירים</div></div><div class="actions"><button class="btn small ghost" onclick="App.editSupplier('${s.id}')">עריכה</button><button class="btn small danger" onclick="App.deleteSupplier('${s.id}')">מחיקה</button></div></div>${s.address?`<div style="margin-top:8px"><a class="btn small ghost" target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}">ניווט</a></div>`:''}</div>`).join('')}</div>`:'<div class="empty">אין ספקים</div>'}</div><div class="card"><h2>השוואת סל נוכחי</h2>${opts.length?`<div class="table-wrap"><table><thead><tr><th>ספק</th><th>כיסוי</th><th>פריטים</th><th>משלוח</th><th>נסיעה</th><th>סה"כ</th></tr></thead><tbody>${opts.map(o=>`<tr><td>${esc(o.supplier.name)}</td><td>${o.covered}</td><td>${money(o.itemsCost)}</td><td>${money(o.delivery)}</td><td>${money(o.distanceCost)}</td><td class="money">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">אין מספיק נתונים</div>'}<div class="notice" style="margin-top:12px">סריקת מחירים אוטומטית דורשת API או מקור נתונים מאושר לכל רשת. כאן המחירים מוזנים ידנית.</div></div></div>`}
function priceRow(p){return`<div class="repeat-row price-row"><div class="field"><label>רכיב</label><input class="sp-i" value="${esc(p.ingredient||'')}"></div><div class="field"><label>כמות בחבילה</label><input class="sp-q" type="number" min="0" step=".01" value="${p.packQty||0}"></div><div class="field"><label>יחידה</label><select class="sp-u">${UNITS.map(u=>`<option ${p.unit===u?'selected':''}>${u}</option>`).join('')}</select></div><div class="field"><label>מחיר חבילה</label><input class="sp-p" type="number" min="0" step=".01" value="${p.packPrice||0}"></div><button type="button" class="btn small danger" onclick="this.closest('.price-row').remove()">הסר</button></div>`}
function supplierForm(s={id:'',name:'',address:'',distanceKm:0,deliveryCost:0,notes:'',prices:[]}){modal(s.id?'עריכת ספק':'ספק חדש',`<form id="supForm"><input type="hidden" name="id" value="${esc(s.id)}"><div class="form-grid"><div class="field"><label>שם ספק/חנות</label><input name="name" required value="${esc(s.name)}"></div><div class="field"><label>כתובת</label><input name="address" value="${esc(s.address)}"></div><div class="field"><label>מרחק בק"מ</label><input name="distanceKm" type="number" step=".1" min="0" value="${s.distanceKm}"></div><div class="field"><label>עלות משלוח</label><input name="deliveryCost" type="number" step=".01" min="0" value="${s.deliveryCost}"></div><div class="field full"><label>מחירי אריזות</label><div id="supplierPrices">${(s.prices.length?s.prices:[{ingredient:'',packQty:1,unit:'ק"ג',packPrice:0}]).map(priceRow).join('')}</div><button type="button" class="btn small secondary" onclick="App.addPrice()">+ מחיר</button></div><div class="field full"><label>הערות</label><textarea name="notes">${esc(s.notes)}</textarea></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירה</button><button type="button" class="btn ghost" onclick="App.close()">ביטול</button></div></form>`);document.getElementById('supForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),ex=state.suppliers.find(x=>x.id===f.get('id')),prices=[...document.querySelectorAll('.price-row')].map(r=>({ingredient:r.querySelector('.sp-i').value.trim(),packQty:Number(r.querySelector('.sp-q').value||0),unit:r.querySelector('.sp-u').value,packPrice:Number(r.querySelector('.sp-p').value||0),updatedAt:new Date().toISOString()})).filter(x=>x.ingredient&&x.packQty),obj={id:f.get('id')||id('sup'),name:f.get('name'),address:f.get('address'),distanceKm:Number(f.get('distanceKm')||0),deliveryCost:Number(f.get('deliveryCost')||0),notes:f.get('notes'),prices};if(ex)Object.assign(ex,obj);else state.suppliers.push(obj);await persist();close();render()}}

function renderSettings(){
  const c=getCloud()||{};
  document.getElementById('view-settings').innerHTML=`<div class="grid two"><div class="card"><h2>הגדרות העסק</h2><form id="settingsForm"><div class="form-grid"><div class="field"><label>שם העסק</label><input name="businessName" value="${esc(state.settings.businessName||'Bakery OS')}"></div><div class="field"><label>מטבע</label><input name="currency" value="${esc(state.settings.currency||'₪')}"></div><div class="field"><label>שכר עבודה לשעה</label><input name="laborRate" type="number" min="0" step=".01" value="${Number(state.settings.laborRate||0)}"></div><div class="field"><label>עלות נסיעה לק״מ</label><input name="distanceCostPerKm" type="number" min="0" step=".01" value="${Number(state.settings.distanceCostPerKm||0)}"></div><div class="field"><label>מספר תנורים</label><input name="ovens" type="number" min="1" step="1" value="${Number(state.settings.ovens||1)}"></div><div class="field"><label>מגשים בכל תנור</label><input name="ovenTrays" type="number" min="1" step="1" value="${Number(state.settings.ovenTrays||1)}"></div><div class="field"><label>תחילת יום עבודה</label><input name="workStart" type="time" value="${esc(state.settings.workStart||'08:00')}"></div><div class="field"><label>סיום יום עבודה</label><input name="workEnd" type="time" value="${esc(state.settings.workEnd||'18:00')}"></div></div><div class="actions" style="margin-top:14px"><button class="btn">שמירת הגדרות</button></div></form></div><div class="card"><h2>שמירה בענן</h2>${cloud.user?`<div class="notice"><strong>מחוברת:</strong> ${esc(cloud.user.email||'')}</div><div class="actions" style="margin-top:12px"><button class="btn secondary" onclick="App.pullCloud()">רענון מהענן</button><button class="btn ghost" onclick="App.logout()">התנתקות</button></div>`:`<div class="form-grid"><div class="field full"><label>Project URL</label><input id="cloudUrl" dir="ltr" value="${esc(c.url||'')}"></div><div class="field full"><label>Publishable / Anon Key</label><input id="cloudKey" type="password" dir="ltr" value="${esc(c.key||'')}"></div><div class="field"><label>אימייל</label><input id="cloudEmail" type="email" dir="ltr"></div><div class="field"><label>סיסמה</label><input id="cloudPassword" type="password" dir="ltr"></div></div><div class="actions" style="margin-top:12px"><button class="btn" onclick="App.cloudLogin()">כניסה</button><button class="btn secondary" onclick="App.cloudSignup()">יצירת חשבון</button></div>`}<div class="hint" style="margin-top:12px">הנתונים נשמרים גם במכשיר וגם ב-Supabase כאשר את מחוברת.</div></div><div class="card"><h2>ייבוא מתכונים חכם</h2><div class="notice">המנתח המקומי פעיל תמיד. ניתוח AI מלא מופעל כאשר קיימת ב-Supabase פונקציה בשם <strong>parse-recipe</strong> עם הסוד OPENAI_API_KEY.</div><div class="hint" style="margin-top:10px">מפתח ה-AI אינו נשמר באתר ואינו נשלח ל-GitHub.</div></div><div class="card"><h2>גיבוי ותחזוקה</h2><div class="actions"><button class="btn secondary" onclick="App.exportData()">הורדת גיבוי</button><button class="btn ghost" onclick="document.getElementById('importFile').click()">ייבוא גיבוי</button><button class="btn danger" onclick="App.resetAll()">מחיקת כל הנתונים</button></div></div></div>`;
  const form=document.getElementById('settingsForm');
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);state.settings={...state.settings,businessName:f.get('businessName')||'Bakery OS',currency:f.get('currency')||'₪',laborRate:Number(f.get('laborRate')||0),distanceCostPerKm:Number(f.get('distanceCostPerKm')||0),ovens:Math.max(1,Math.floor(Number(f.get('ovens'))||1)),ovenTrays:Math.max(1,Math.floor(Number(f.get('ovenTrays'))||1)),workStart:f.get('workStart')||'08:00',workEnd:f.get('workEnd')||'18:00'};await persist();render()}
}
function renderReports(){const os=state.orders.filter(o=>o.status!=='בוטלה'),rev=os.reduce((s,o)=>s+revenue(o),0);let cost=0,by={};os.forEach(o=>(o.items||[]).forEach(i=>{const r=recipe(i.recipeId);if(r)cost+=recipeCost(r).perUnit*Number(i.qty);by[i.recipeId]=(by[i.recipeId]||0)+Number(i.qty)}));const profit=rev-cost;document.getElementById('view-reports').innerHTML=`<div class="grid four"><div class="metric"><div class="label">הכנסות</div><div class="value">${money(rev)}</div></div><div class="metric"><div class="label">עלות משוערת</div><div class="value">${money(cost)}</div></div><div class="metric"><div class="label">רווח גולמי</div><div class="value">${money(profit)}</div></div><div class="metric"><div class="label">שיעור רווח</div><div class="value">${rev?fmt(profit/rev*100,1):0}%</div></div></div><div class="grid two" style="margin-top:14px"><div class="card"><h2>מוצרים נמכרים</h2>${Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([rid,q])=>`<div class="kpi-line"><span>${esc(recipe(rid)?.name||'מתכון')}</span><strong>${fmt(q,0)} יחידות</strong></div>`).join('')||'<div class="empty">אין נתונים</div>'}</div><div class="card"><h2>רווחיות מתכונים</h2>${state.recipes.map(r=>{const c=recipeCost(r);return`<div class="kpi-line"><span>${esc(r.name)}</span><strong>${money(Number(r.salePrice)-c.perUnit)} ליחידה</strong></div>`}).join('')||'<div class="empty">אין מתכונים</div>'}</div></div><div class="card" style="margin-top:14px"><div class="notice">זהו אומדן ניהולי. שכירות, מסים, עמלות, פחת והוצאות קבועות אינן נכללות אלא אם הזנת אותן במחירים ובשכר העבודה.</div></div>`}
function getCloud(){try{return JSON.parse(localStorage.getItem(CLOUD_KEY)||'null')}catch(e){return null}}
function hasBusinessData(x){return !!((x.recipes&&x.recipes.length)||(x.orders&&x.orders.length)||(x.inventory&&x.inventory.length)||(x.suppliers&&x.suppliers.length))}
function initCloud(){
  const c=getCloud();
  if(!c?.url||!c?.key||!window.supabase)return false;
  cloud.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return true
}
function remoteIsNewer(updatedAt){
  const remoteTime=Date.parse(updatedAt||0)||0;
  const localTime=Date.parse(state.updatedAt||0)||0;
  return remoteTime>localTime+250;
}
function applyRemote(data,updatedAt,show=true){
  if(!data)return;
  if(updatedAt&&!remoteIsNewer(updatedAt)&&hasBusinessData(state))return;
  state={...empty(),...data,updatedAt:updatedAt||data.updatedAt||new Date().toISOString()};
  localStorage.setItem(LS_KEY,JSON.stringify(state));
  if(show){setStatus('✓ התעדכן מהענן');setTimeout(()=>setStatus(''),1400)}
  render()
}
async function cloudAuth(mode){
  const url=document.getElementById('cloudUrl')?.value.trim(),key=document.getElementById('cloudKey')?.value.trim(),email=document.getElementById('cloudEmail')?.value.trim(),password=document.getElementById('cloudPassword')?.value;
  if(!url||!key||!email||!password)return alert('יש למלא את כל פרטי החיבור');
  localStorage.setItem(CLOUD_KEY,JSON.stringify({url,key}));
  if(!initCloud())return alert('פרטי Supabase אינם תקינים');
  const res=mode==='signup'?await cloud.client.auth.signUp({email,password}):await cloud.client.auth.signInWithPassword({email,password});
  if(res.error)return alert(res.error.message);
  cloud.user=res.data.user;
  if(!cloud.user)return alert('נשלח אימייל אימות. אשרי אותו ואז התחברי.');
  await initialCloudSync();
  startCloudSync();
  render()
}
async function initialCloudSync(){
  if(!cloud.user||!cloud.client)return;
  setStatus('מסנכרן…');
  const {data,error}=await cloud.client.from('bakery_os_data').select('data,updated_at').eq('user_id',cloud.user.id).maybeSingle();
  if(error){setStatus('⚠ שגיאת סנכרון');throw error}
  if(data?.data){
    const localHas=hasBusinessData(state);
    const remoteHas=hasBusinessData(data.data);
    const localTime=Date.parse(state.updatedAt||0)||0;
    const remoteTime=Date.parse(data.updated_at||data.data.updatedAt||0)||0;
    if(localHas&&(!remoteHas||localTime>remoteTime+250)){
      await pushCloud();
      setStatus('✓ הנתונים מהמכשיר נשמרו בענן')
    }else{
      state={...empty(),...data.data,updatedAt:data.updated_at||data.data.updatedAt};
      localStorage.setItem(LS_KEY,JSON.stringify(state));
      setStatus('✓ נטען מהענן')
    }
  }else if(hasBusinessData(state)){
    await pushCloud()
  }else{
    state.updatedAt=new Date().toISOString();
    await pushCloud()
  }
}
async function pushCloud(){
  if(!cloud.user||!cloud.client)return false;
  const stamp=state.updatedAt||new Date().toISOString();
  state.updatedAt=stamp;
  const {error}=await cloud.client.from('bakery_os_data').upsert({user_id:cloud.user.id,data:state,updated_at:stamp},{onConflict:'user_id'});
  if(error){console.error(error);setStatus('⚠ השמירה בענן נכשלה');return false}
  return true
}
async function pullCloud(show=true){
  if(!cloud.user||!cloud.client)return;
  if(show)setStatus('טוען מהענן…');
  const {data,error}=await cloud.client.from('bakery_os_data').select('data,updated_at').eq('user_id',cloud.user.id).maybeSingle();
  if(error){if(show)setStatus('⚠ שגיאת טעינה');console.error(error);return}
  if(data?.data){
    if(remoteIsNewer(data.updated_at)||!hasBusinessData(state))applyRemote(data.data,data.updated_at,show);
    else if(show){setStatus('✓ כבר מעודכן');setTimeout(()=>setStatus(''),1200)}
  }
}
function stopCloudSync(){
  if(cloud.channel&&cloud.client)cloud.client.removeChannel(cloud.channel);
  cloud.channel=null;
  if(cloud.timer)clearInterval(cloud.timer);
  cloud.timer=null
}
function startCloudSync(){
  stopCloudSync();
  if(!cloud.user||!cloud.client)return;
  cloud.channel=cloud.client.channel('bakery-os-'+cloud.user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'bakery_os_data',filter:'user_id=eq.'+cloud.user.id},payload=>{
      const row=payload.new;
      if(row?.data&&remoteIsNewer(row.updated_at))applyRemote(row.data,row.updated_at,true)
    }).subscribe();
  cloud.timer=setInterval(()=>{if(document.visibilityState==='visible')pullCloud(false)},15000)
}
async function initSession(){
  if(!initCloud())return;
  const {data}=await cloud.client.auth.getSession();
  cloud.user=data?.session?.user||null;
  if(cloud.user){
    await initialCloudSync();
    startCloudSync()
  }
}
function exportData(){const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bakery-os-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href)}
async function importData(f){try{state={...empty(),...JSON.parse(await f.text())};await persist();render();alert('הנתונים יובאו')}catch(e){alert('קובץ לא תקין')}}
window.App={
  go,close,
  newOrder:()=>orderForm(),editOrder:x=>orderForm(state.orders.find(o=>o.id===x)),deleteOrder:async x=>{if(confirm('למחוק את ההזמנה?')){state.orders=state.orders.filter(o=>o.id!==x);await persist();render()}},addOrderItem:()=>document.getElementById('orderItems').insertAdjacentHTML('beforeend',orderRow({recipeId:'',qty:1})),
  newRecipe:()=>recipeForm(),editRecipe:x=>recipeForm(state.recipes.find(r=>r.id===x)),deleteRecipe:async x=>{if(confirm('למחוק את המתכון?')){state.recipes=state.recipes.filter(r=>r.id!==x);await persist();render()}},addIngredient:()=>{document.getElementById('recipeIngredients').insertAdjacentHTML('beforeend',ingredientRow({name:'',qty:'',unit:'גרם',category:'אחר'}));updateRecipeWeightPreview()},removeIngredient:b=>{b.closest('.ingredient-row').remove();updateRecipeWeightPreview()},addStep:()=>document.getElementById('recipeSteps').insertAdjacentHTML('beforeend',stepRow({text:'',daysBefore:0,time:''})),weightCalc:x=>weightCalculator(state.recipes.find(r=>r.id===x)),
  importRecipe:importRecipeModal,analyzeRecipeImport,filterRecipeBook,openBookRecipe,copyRecipe,printRecipe,
  toggleTask:async k=>{state.checkedTasks[k]=!state.checkedTasks[k];await persist();render()},toggleShopping:async k=>{state.checkedShopping[k]=!state.checkedShopping[k];await persist();render()},
  newInventory:()=>inventoryForm(),editInventory:x=>inventoryForm(state.inventory.find(i=>i.id===x)),deleteInventory:async x=>{if(confirm('למחוק את הפריט?')){state.inventory=state.inventory.filter(i=>i.id!==x);await persist();render()}},
  newSupplier:()=>supplierForm(),editSupplier:x=>supplierForm(state.suppliers.find(s=>s.id===x)),deleteSupplier:async x=>{if(confirm('למחוק את הספק?')){state.suppliers=state.suppliers.filter(s=>s.id!==x);await persist();render()}},addPrice:()=>document.getElementById('supplierPrices').insertAdjacentHTML('beforeend',priceRow({ingredient:'',packQty:1,unit:'ק"ג',packPrice:0})),
  exportData,cloudLogin:()=>cloudAuth('login'),cloudSignup:()=>cloudAuth('signup'),pullCloud,logout:async()=>{stopCloudSync();if(cloud.client)await cloud.client.auth.signOut();cloud.user=null;render()},resetAll:async()=>{if(confirm('למחוק את כל הנתונים?')){state=empty();await persist(false);render()}}
};
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.view));document.getElementById('modalClose').onclick=close;document.getElementById('modal').onclick=e=>{if(e.target.id==='modal')close()};document.getElementById('backupBtn').onclick=exportData;document.getElementById('cloudBtn').onclick=()=>go('settings');document.getElementById('importFile').onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=''};document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloud.user)pullCloud(false)});
window.addEventListener('focus',()=>{if(cloud.user)pullCloud(false)});
window.addEventListener('online',()=>{if(cloud.user)pullCloud(false)});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{}));
initSession().finally(render);
})();
