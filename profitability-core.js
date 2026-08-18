(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BakeryProfitCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DEFAULTS={hourlyRate:0,overheadPerHour:0,targetMargin:45,defaultPackagingPerUnit:0};
  const WEIGHT={"גרם":1,"ג":1,"ק\"ג":1000,"קג":1000,"קילו":1000};
  const VOLUME={"מ\"ל":1,"מל":1,"ליטר":1000,"ל":1000};

  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,n(v)));
  function normalizeName(value){return String(value||'').toLowerCase().replace(/[״']/g,'"').replace(/[^a-z0-9א-ת\s]/gi,' ').replace(/\s+/g,' ').trim()}
  function normalizeUnit(value){const u=String(value||'').trim().replace(/״/g,'"');if(WEIGHT[u])return u;if(VOLUME[u])return u;if(/^(יחידה|יחידות)$/.test(u))return'יחידה';if(/^(חבילה|אריזה)$/.test(u))return'חבילה';return u}
  function canonical(qty,unit){const u=normalizeUnit(unit);if(WEIGHT[u])return{qty:n(qty)*WEIGHT[u],unit:'גרם'};if(VOLUME[u])return{qty:n(qty)*VOLUME[u],unit:'מ"ל'};return{qty:n(qty),unit:u||'יחידה'}}
  function namesMatch(a,b){const x=normalizeName(a),y=normalizeName(b);if(!x||!y)return false;if(x===y)return true;if(Math.min(x.length,y.length)>=5&&(x.includes(y)||y.includes(x)))return true;return false}
  function supplierPrices(state,name){const out=[];for(const s of state?.suppliers||[])for(const p of s.prices||[])if(namesMatch(p.ingredient,name))out.push({...p,supplierName:s.name||''});return out}
  function bestIngredientCost(state,ingredient){const wanted=canonical(ingredient?.qty,ingredient?.unit);let best=null;for(const p of supplierPrices(state,ingredient?.name)){const pack=canonical(p.packQty,p.unit);if(!pack.qty||pack.unit!==wanted.unit)continue;const cost=n(p.packPrice)/pack.qty*wanted.qty;if(!best||cost<best.cost)best={cost,price:p};}return best}

  function weightLike(qty,unit){const c=canonical(qty,unit);if(c.unit==='גרם')return c.qty;if(c.unit==='מ"ל')return c.qty;return 0}
  function subRecipeYieldWeight(sub){let total=0;for(const i of sub?.ingredients||[])total+=weightLike(i.qty,i.unit);return total}
  function expandIngredients(recipe){const out=[];for(const i of recipe?.ingredients||[]){const sub=(recipe.subRecipes||[]).find(s=>s.id===i.linkedSubRecipeId||normalizeName(s.name)===normalizeName(i.name));if(!sub){out.push({...i});continue}const used=weightLike(i.qty,i.unit)||n(sub.usedQtyGrams),yieldWeight=subRecipeYieldWeight(sub);if(!used||!yieldWeight){out.push({...i});continue}const factor=used/yieldWeight;for(const si of sub.ingredients||[])out.push({...si,qty:n(si.qty)*factor,sourceSubRecipe:sub.name});}return out}
  function recipeYield(recipe){const manual=Math.max(0,Math.round(n(recipe?.yieldUnits)));if(manual)return manual;if(String(recipe?.salesUnit||'')==='שקיות'){let grams=0;for(const i of recipe?.ingredients||[])grams+=weightLike(i.qty,i.unit);const pack=Math.max(1,n(recipe?.packageWeight||recipe?.unitWeight||200));return Math.max(0,Math.floor(grams/pack));}return 0}
  function laborMinutes(recipe,recipeMeta){if(n(recipeMeta?.laborMinutes)>0)return n(recipeMeta.laborMinutes);const taskMinutes=(recipe?.productionTasks||[]).reduce((s,t)=>s+n(t.activeMin||t.durationMin),0);return taskMinutes>0?taskMinutes:Math.max(0,n(recipe?.prepMin));}

  function recipeTrueCost(state,meta,recipe){
    const settings={...DEFAULTS,...(meta?.settings||{})};
    const rm=meta?.recipes?.[recipe?.id]||{};
    const rows=[];let ingredients=0;const missing=[];
    for(const i of expandIngredients(recipe)){if(i.asNeeded)continue;const best=bestIngredientCost(state,i);const cost=best?.cost||0;ingredients+=cost;rows.push({...i,cost,supplierName:best?.price?.supplierName||'',matched:!!best});if(!best)missing.push(i.name);}
    ingredients*=1+Math.max(0,n(recipe?.wastePct))/100;
    const yieldUnits=recipeYield(recipe);
    const minutes=laborMinutes(recipe,rm);
    const labor=minutes/60*Math.max(0,n(settings.hourlyRate));
    const packagingPerUnit=Math.max(0,n(rm.packagingPerUnit??settings.defaultPackagingPerUnit));
    const packaging=packagingPerUnit*yieldUnits;
    const overhead=minutes/60*Math.max(0,n(settings.overheadPerHour))+Math.max(0,n(rm.fixedOverheadPerBatch));
    const total=ingredients+labor+packaging+overhead;
    const perUnit=yieldUnits?total/yieldUnits:null;
    const salePrice=Math.max(0,n(recipe?.salePrice));
    const targetMargin=clamp(rm.targetMargin??settings.targetMargin,0,95);
    const suggestedPrice=perUnit===null?null:perUnit/(1-targetMargin/100);
    const unitProfit=perUnit===null?null:salePrice-perUnit;
    const margin=salePrice>0&&unitProfit!==null?unitProfit/salePrice*100:null;
    return{ingredients,labor,packaging,overhead,total,perUnit,yieldUnits,laborMinutes:minutes,packagingPerUnit,salePrice,targetMargin,suggestedPrice,unitProfit,margin,missing:[...new Set(missing.filter(Boolean))],rows};
  }

  function orderProfitability(state,meta,order){
    const om=meta?.orders?.[order?.id]||{},recipes=new Map((state?.recipes||[]).map(r=>[r.id,r]));
    let productRevenue=0,productCost=0;const rows=[];
    for(const item of order?.items||[]){const recipe=recipes.get(item.recipeId);if(!recipe)continue;const qty=Math.max(0,n(item.qty));const c=recipeTrueCost(state,meta,recipe);const unitPrice=Math.max(0,n(om.unitPrices?.[item.recipeId]??recipe.salePrice));const revenue=unitPrice*qty,cost=(c.perUnit||0)*qty;productRevenue+=revenue;productCost+=cost;rows.push({recipeId:item.recipeId,name:recipe.name||'',qty,unitPrice,revenue,cost,profit:revenue-cost,trueUnitCost:c.perUnit,missing:c.missing});}
    const deliveryCharge=Math.max(0,n(om.deliveryCharge)),discount=Math.max(0,n(om.discount)),extraCost=Math.max(0,n(om.extraCost));
    const revenue=Math.max(0,productRevenue+deliveryCharge-discount),cost=productCost+extraCost,profit=revenue-cost,margin=revenue?profit/revenue*100:null;
    return{revenue,cost,profit,margin,productRevenue,productCost,deliveryCharge,discount,extraCost,rows};
  }
  function portfolio(state,meta,orders){const list=(orders||state?.orders||[]).filter(o=>o.status!=='בוטלה').map(o=>({order:o,...orderProfitability(state,meta,o)}));const revenue=list.reduce((s,x)=>s+x.revenue,0),cost=list.reduce((s,x)=>s+x.cost,0),profit=revenue-cost;return{orders:list,revenue,cost,profit,margin:revenue?profit/revenue*100:null};}

  return{DEFAULTS,normalizeName,normalizeUnit,canonical,namesMatch,expandIngredients,recipeYield,recipeTrueCost,orderProfitability,portfolio};
});
