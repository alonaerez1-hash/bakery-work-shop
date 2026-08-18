(() => {
'use strict';
const BASE_KEY='bakery_os_state_v1', META_KEY='bakery_profitability_v1', RETURN_KEY='bakery_profitability_return_v1';
const Core=window.BakeryProfitCore;
if(!Core){console.error('BakeryProfitCore is missing');return}

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
function base(){try{return JSON.parse(localStorage.getItem(BASE_KEY)||'{}')}catch(_e){return{}}}
function meta(){try{const raw=JSON.parse(localStorage.getItem(META_KEY)||'{}');return{settings:{...Core.DEFAULTS,...(raw.settings||{})},recipes:raw.recipes||{},orders:raw.orders||{}}}catch(_e){return{settings:{...Core.DEFAULTS},recipes:{},orders:{}}}}
function saveMeta(next){localStorage.setItem(META_KEY,JSON.stringify(next))}
function currency(state){return state?.settings?.currency||'₪'}
function money(v,state){return `${num(v).toLocaleString('he-IL',{maximumFractionDigits:2})} ${currency(state)}`}
function pct(v){return v===null||!Number.isFinite(Number(v))?'—':`${Number(v).toLocaleString('he-IL',{maximumFractionDigits:1})}%`}
function dateText(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('he-IL')}
function activeOrders(state){return(state.orders||[]).filter(o=>!['נמסרה','בוטלה'].includes(o.status))}

function setActive(){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-profitability'));document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view==='profitability'));}
function open(){setActive();render();window.scrollTo({top:0,behavior:'smooth'})}

function render(){
  const root=document.getElementById('view-profitability');if(!root)return;
  const state=base(),m=meta(),recipes=state.recipes||[],orders=activeOrders(state),port=Core.portfolio(state,m,orders);
  const costs=recipes.map(r=>({recipe:r,cost:Core.recipeTrueCost(state,m,r)}));
  const underpriced=costs.filter(x=>x.cost.margin!==null&&x.cost.margin<Number(x.cost.targetMargin)).length;
  const missing=costs.filter(x=>x.cost.missing.length).length;
  root.innerHTML=`
  <section class="profit-hero">
    <div><span class="profit-eyebrow">PROFITABILITY ENGINE</span><h2>תדעי מה כל הזמנה <em>באמת</em> משאירה לך.</h2><p>חומרי גלם, עבודה, אריזה והוצאות תקורה מתחברים למחיר המכירה כדי להראות עלות אמיתית, מחיר מומלץ ורווח צפוי.</p></div>
    <div class="profit-hero-metric"><span>רווח צפוי מהזמנות פעילות</span><strong>${money(port.profit,state)}</strong><small>מרווח ${pct(port.margin)}</small></div>
  </section>
  <section class="profit-summary-grid">
    ${metric('הכנסות צפויות',money(port.revenue,state),'מהזמנות פעילות')}
    ${metric('עלות אמיתית',money(port.cost,state),'מוצרים + עלויות נוספות')}
    ${metric('רווח צפוי',money(port.profit,state),`מרווח ${pct(port.margin)}`,'accent')}
    ${metric('דורש תשומת לב',String(underpriced),`${missing} מתכונים עם מחירים חסרים`,underpriced?'warning':'')}
  </section>
  <section class="profit-grid-two">
    <form class="profit-card" onsubmit="return Profitability.saveSettings(event)">
      <div class="profit-card-head"><div><span class="profit-kicker">BUSINESS NUMBERS</span><h3>המספרים של העסק</h3></div><span class="profit-status ${configured(m)?'ready':''}">${configured(m)?'✓ מוגדר':'להשלמה'}</span></div>
      <p class="profit-help">הגדרות אלה משמשות בכל המתכונים, אלא אם הגדרת למתכון ערך אחר.</p>
      <div class="profit-form-grid">
        ${field('שכר לשעת עבודה','hourlyRate',m.settings.hourlyRate,'₪ לשעה')}
        ${field('תקורה לכל שעת עבודה','overheadPerHour',m.settings.overheadPerHour,'₪ לשעה')}
        ${field('יעד מרווח ברירת מחדל','targetMargin',m.settings.targetMargin,'%')}
        ${field('אריזה ליחידה','defaultPackagingPerUnit',m.settings.defaultPackagingPerUnit,'₪ ליחידה')}
      </div>
      <button class="btn secondary" type="submit">שמירת הגדרות רווחיות</button>
    </form>
    <div class="profit-card profit-flow-card"><span class="profit-kicker">ORDER → PROFIT</span><h3>החיבור שהאתר מבטיח</h3><div class="profit-flow"><span>הזמנה</span><b>←</b><span>מתכון</span><b>←</b><span>עלות אמיתית</span><b>←</b><span>רווח</span></div><p>מחיר הספקים שכבר הזנת משמש לחומרי הגלם. כאן מתווספים עבודה, אריזה ותקורה.</p></div>
  </section>
  <section class="profit-card">
    <div class="profit-card-head"><div><span class="profit-kicker">TRUE RECIPE COST</span><h3>תמחור מתכונים</h3></div><span>${recipes.length} מתכונים</span></div>
    ${recipes.length?recipeTable(costs,state):'<div class="empty">הוסיפי מתכון כדי להתחיל לחשב רווחיות.</div>'}
  </section>
  <section class="profit-card">
    <div class="profit-card-head"><div><span class="profit-kicker">ORDER PROFITABILITY</span><h3>רווחיות לפי הזמנה</h3></div><span>${orders.length} פעילות</span></div>
    ${orders.length?orderTable(port.orders,state):'<div class="empty">אין כרגע הזמנות פעילות.</div>'}
  </section>`;
}
function configured(m){return num(m.settings.hourlyRate)>0||num(m.settings.overheadPerHour)>0||num(m.settings.defaultPackagingPerUnit)>0}
function metric(label,value,meta,kind=''){return`<div class="profit-metric ${kind}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`}
function field(label,name,value,suffix){return`<label class="profit-field"><span>${esc(label)}</span><div><input name="${esc(name)}" type="number" min="0" step="0.01" value="${num(value)}"><small>${esc(suffix)}</small></div></label>`}
function recipeTable(costs,state){return`<div class="profit-table-wrap"><table class="profit-table"><thead><tr><th>מוצר</th><th>חומרים</th><th>עבודה</th><th>אריזה</th><th>תקורה</th><th>עלות אמיתית ליחידה</th><th>מחיר נוכחי</th><th>מחיר מומלץ</th><th>מרווח</th><th></th></tr></thead><tbody>${costs.map(({recipe:r,cost:c})=>`<tr><td><strong>${esc(r.name)}</strong><small>${c.yieldUnits?`${c.yieldUnits} ${esc(r.salesUnit||'יחידות')}`:'⚠ חסרה תפוקה'}${c.missing.length?` · ⚠ ${c.missing.length} מחירים חסרים`:''}</small></td><td>${money(c.ingredients,state)}</td><td>${money(c.labor,state)}</td><td>${money(c.packaging,state)}</td><td>${money(c.overhead,state)}</td><td><strong>${c.perUnit===null?'—':money(c.perUnit,state)}</strong></td><td>${money(c.salePrice,state)}</td><td>${c.suggestedPrice===null?'—':money(c.suggestedPrice,state)}</td><td><span class="profit-pill ${c.margin!==null&&c.margin<c.targetMargin?'bad':'good'}">${pct(c.margin)}</span></td><td><button class="btn small secondary" onclick="Profitability.editRecipe('${esc(r.id)}')">תמחור</button></td></tr>`).join('')}</tbody></table></div>`}
function orderTable(rows,state){return`<div class="profit-table-wrap"><table class="profit-table"><thead><tr><th>לקוחה</th><th>מועד</th><th>הכנסה</th><th>עלות אמיתית</th><th>רווח</th><th>מרווח</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.order.customer||'לקוחה')}</strong><small>${esc(x.order.status||'')}</small></td><td>${dateText(x.order.dueAt)}</td><td>${money(x.revenue,state)}</td><td>${money(x.cost,state)}</td><td><strong class="${x.profit<0?'profit-negative':''}">${money(x.profit,state)}</strong></td><td>${pct(x.margin)}</td><td><button class="btn small secondary" onclick="Profitability.editOrder('${esc(x.order.id)}')">מחיר והוצאות</button></td></tr>`).join('')}</tbody></table></div>`}

function showModal(title,html){let box=document.getElementById('profitModal');if(box)box.remove();box=document.createElement('div');box.id='profitModal';box.className='profit-modal';box.innerHTML=`<div class="profit-modal-card"><div class="profit-modal-head"><h3>${esc(title)}</h3><button type="button" onclick="Profitability.closeModal()">×</button></div>${html}</div>`;document.body.appendChild(box);requestAnimationFrame(()=>box.classList.add('show'));box.addEventListener('click',e=>{if(e.target===box)closeModal()})}
function closeModal(){document.getElementById('profitModal')?.remove()}
function editRecipe(id){const state=base(),m=meta(),r=(state.recipes||[]).find(x=>x.id===id);if(!r)return;const rm=m.recipes[id]||{},c=Core.recipeTrueCost(state,m,r);showModal(`תמחור — ${r.name}`,`<form onsubmit="return Profitability.saveRecipe(event,'${esc(id)}')"><div class="profit-modal-snapshot"><div><span>עלות נוכחית</span><strong>${c.perUnit===null?'—':money(c.perUnit,state)}</strong></div><div><span>מחיר מומלץ</span><strong>${c.suggestedPrice===null?'—':money(c.suggestedPrice,state)}</strong></div><div><span>מרווח נוכחי</span><strong>${pct(c.margin)}</strong></div></div><div class="profit-form-grid">${field('זמן עבודה פעיל למתכון','laborMinutes',rm.laborMinutes||c.laborMinutes,'דקות')}${field('עלות אריזה ליחידה','packagingPerUnit',rm.packagingPerUnit??m.settings.defaultPackagingPerUnit,'₪')}${field('תקורה קבועה למתכון','fixedOverheadPerBatch',rm.fixedOverheadPerBatch||0,'₪')}${field('יעד מרווח','targetMargin',rm.targetMargin??m.settings.targetMargin,'%')}${field('מחיר מכירה ליחידה','salePrice',r.salePrice||0,'₪')}</div>${c.missing.length?`<div class="profit-warning">חסרים מחירי ספק עבור: ${c.missing.map(esc).join(', ')}. החישוב שלהם כרגע 0 עד שתקשרי מחיר.</div>`:''}<div class="profit-modal-actions"><button class="btn secondary">שמירה וחישוב מחדש</button><button type="button" class="btn ghost" onclick="Profitability.closeModal()">ביטול</button></div></form>`)}
function saveRecipe(event,id){event.preventDefault();const fd=new FormData(event.currentTarget),m=meta(),state=base();m.recipes[id]={...(m.recipes[id]||{}),laborMinutes:Math.max(0,num(fd.get('laborMinutes'))),packagingPerUnit:Math.max(0,num(fd.get('packagingPerUnit'))),fixedOverheadPerBatch:Math.max(0,num(fd.get('fixedOverheadPerBatch'))),targetMargin:Math.min(95,Math.max(0,num(fd.get('targetMargin'))))};saveMeta(m);const r=(state.recipes||[]).find(x=>x.id===id),price=Math.max(0,num(fd.get('salePrice')));let reload=false;if(r&&num(r.salePrice)!==price){r.salePrice=price;state.updatedAt=new Date().toISOString();localStorage.setItem(BASE_KEY,JSON.stringify(state));reload=true}closeModal();if(reload){sessionStorage.setItem(RETURN_KEY,'1');location.reload()}else render();return false}
function editOrder(id){const state=base(),m=meta(),o=(state.orders||[]).find(x=>x.id===id);if(!o)return;const om=m.orders[id]||{},recipes=new Map((state.recipes||[]).map(r=>[r.id,r]));showModal(`רווחיות הזמנה — ${o.customer||''}`,`<form onsubmit="return Profitability.saveOrder(event,'${esc(id)}')"><div class="profit-order-lines">${(o.items||[]).map(i=>{const r=recipes.get(i.recipeId);return`<label><span>${esc(r?.name||'מוצר')} × ${num(i.qty)}</span><div><input type="number" min="0" step="0.01" name="price_${esc(i.recipeId)}" value="${num(om.unitPrices?.[i.recipeId]??r?.salePrice)}"><small>₪ ליחידה</small></div></label>`}).join('')}</div><div class="profit-form-grid">${field('דמי משלוח שנגבו','deliveryCharge',om.deliveryCharge||0,'₪')}${field('הנחה להזמנה','discount',om.discount||0,'₪')}${field('הוצאה נוספת להזמנה','extraCost',om.extraCost||0,'₪')}</div><div class="profit-modal-actions"><button class="btn secondary">שמירה</button><button type="button" class="btn ghost" onclick="Profitability.closeModal()">ביטול</button></div></form>`)}
function saveOrder(event,id){event.preventDefault();const fd=new FormData(event.currentTarget),state=base(),m=meta(),o=(state.orders||[]).find(x=>x.id===id);if(!o)return false;const unitPrices={};for(const i of o.items||[])unitPrices[i.recipeId]=Math.max(0,num(fd.get(`price_${i.recipeId}`)));m.orders[id]={...(m.orders[id]||{}),unitPrices,deliveryCharge:Math.max(0,num(fd.get('deliveryCharge'))),discount:Math.max(0,num(fd.get('discount'))),extraCost:Math.max(0,num(fd.get('extraCost')))};saveMeta(m);closeModal();render();injectDashboard(true);return false}
function saveSettings(event){event.preventDefault();const fd=new FormData(event.currentTarget),m=meta();m.settings={...m.settings,hourlyRate:Math.max(0,num(fd.get('hourlyRate'))),overheadPerHour:Math.max(0,num(fd.get('overheadPerHour'))),targetMargin:Math.min(95,Math.max(0,num(fd.get('targetMargin')))),defaultPackagingPerUnit:Math.max(0,num(fd.get('defaultPackagingPerUnit')))};saveMeta(m);render();injectDashboard(true);return false}

function injectDashboard(force=false){const root=document.getElementById('view-dashboard');if(!root)return;if(force)root.querySelector('#profitDashboardStrip')?.remove();if(root.querySelector('#profitDashboardStrip'))return;const state=base(),m=meta(),port=Core.portfolio(state,m,activeOrders(state));const strip=document.createElement('section');strip.id='profitDashboardStrip';strip.className='profit-dashboard-strip';strip.innerHTML=`<div><span>PROFIT SNAPSHOT</span><h3>${configured(m)?'מה ההזמנות הפעילות צפויות להשאיר?':'הגדירי עלות עבודה כדי לראות רווח אמיתי'}</h3></div><div class="profit-dashboard-values"><div><small>הכנסה</small><strong>${money(port.revenue,state)}</strong></div><div><small>עלות אמיתית</small><strong>${money(port.cost,state)}</strong></div><div><small>רווח צפוי</small><strong>${money(port.profit,state)}</strong></div><div><small>מרווח</small><strong>${pct(port.margin)}</strong></div></div><button class="btn secondary" onclick="Profitability.open()">פתיחת רווחיות</button>`;root.appendChild(strip)}
function bind(){const tab=document.querySelector('#tabs button[data-view="profitability"]');if(tab)tab.addEventListener('click',()=>setTimeout(open,0));const dash=document.getElementById('view-dashboard');if(dash){new MutationObserver(()=>{if(!document.getElementById('profitDashboardStrip'))injectDashboard()}).observe(dash,{childList:true});injectDashboard()}if(sessionStorage.getItem(RETURN_KEY)==='1'){sessionStorage.removeItem(RETURN_KEY);setTimeout(open,100)}}

window.Profitability={open,render,saveSettings,editRecipe,saveRecipe,editOrder,saveOrder,closeModal,injectDashboard};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
