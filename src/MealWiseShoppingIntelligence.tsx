import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { convertQuantity, measureGroupKey, normalizeUnit, roundMeasure, unitsCompatible } from "./lib/measurements";
import MealWiseOpenFoodLookup from "./MealWiseOpenFoodLookup";

type Household = { weekly_budget:number|null; zip_code:string|null; latitude:number|null; longitude:number|null; shopping_radius_miles:number };
type Preferences = { min_savings_for_extra_stop:number; preferred_stop_limit:number; excluded_stores:string[] };
type Plan = { id:string; week_start:string; budget_target:number|null };
type PlanMeal = { meal_id:string; selected:boolean };
type Ingredient = { meal_id:string; ingredient_name:string; normalized_name:string|null; quantity:number|null; unit:string|null; category:string|null; optional:boolean };
type PantryItem = { item_name:string; normalized_name:string|null; quantity:number|null; unit:string|null; container_size:number|null; container_unit:string|null };
type Store = { id:string; retailer_name:string; location_name:string|null; zip_code:string|null; latitude:number|null; longitude:number|null };
type Price = { id:string; store_id:string; product_name:string; normalized_product_name:string|null; package_size:number|null; package_unit:string|null; price:number; sale_price:number|null; observed_at:string; expires_at:string|null };
type Item = { key:string; name:string; normalizedName:string; quantity:number|null; unit:string|null; category:string|null; pantryUsed:number; quantityToBuy:number|null; pantryCovered:boolean; verifyPantry:boolean };
type Offer = { itemKey:string; store:Store; row:Price; packages:number; total:number };
type Strategy = { id:"cheapest"|"one-stop"|"balance"; title:string; total:number|null; stores:Store[]; offers:Offer[]; missing:Item[]; complete:boolean; note:string };

const norm=(v:string|null|undefined)=>(v??"").trim().toLowerCase().replace(/\s+/g," ");
const foodNorm=(v:string|null|undefined)=>norm(v)
  .replace(/\btomatos\b/g,"tomatoes")
  .replace(/\btinned\b/g,"")
  .replace(/\bcanned\b/g,"")
  .replace(/\bsesame seed oil\b/g,"sesame oil")
  .replace(/\bspring onions?\b/g,"green onions")
  .replace(/\bchicken bouillon powder\b/g,"chicken bouillon")
  .replace(/\s+/g," ")
  .trim();
const money=(v:number|null)=>v==null?"—":new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"}).format(v);
const round2=(v:number)=>Math.round(v*100)/100;
function sameFood(a:string,b:string){
  const x=foodNorm(a),y=foodNorm(b);
  if(!x||!y)return false;
  if(x===y||x.includes(y)||y.includes(x))return true;
  const important=(v:string)=>v.split(" ").filter(t=>t.length>=3&&!["the","and","with","for","flavored","flavour"].includes(t));
  const xt=important(x),yt=new Set(important(y));
  return xt.length>0&&xt.every(t=>yt.has(t));
}
function unitsMatch(a:string|null,b:string|null){return unitsCompatible(a,b)}
function haversine(lat1:number,lon1:number,lat2:number,lon2:number){const r=(n:number)=>n*Math.PI/180,R=3958.8,dLat=r(lat2-lat1),dLon=r(lon2-lon1);const a=Math.sin(dLat/2)**2+Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function combos<T>(a:T[],max:number){const out:T[][]=[];const walk=(start:number,c:T[])=>{if(c.length){out.push([...c]);if(c.length===max)return}for(let i=start;i<a.length;i++){c.push(a[i]);walk(i+1,c);c.pop()}};walk(0,[]);return out}

export default function MealWiseShoppingIntelligence({householdId}:{householdId:string}){
  const [household,setHousehold]=useState<Household|null>(null);
  const [prefs,setPrefs]=useState<Preferences>({min_savings_for_extra_stop:10,preferred_stop_limit:1,excluded_stores:[]});
  const [plan,setPlan]=useState<Plan|null>(null);
  const [ingredients,setIngredients]=useState<Ingredient[]>([]);
  const [pantry,setPantry]=useState<PantryItem[]>([]);
  const [stores,setStores]=useState<Store[]>([]);
  const [prices,setPrices]=useState<Price[]>([]);
  const [selectedId,setSelectedId]=useState<Strategy["id"]>("balance");
  const [busy,setBusy]=useState(false); const [priceBusy,setPriceBusy]=useState(false); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const [message,setMessage]=useState("");

  useEffect(()=>{void load()},[householdId]);

  async function load(){
    setLoading(true);setError("");setMessage("");
    const [h,p,pl,pa,st]=await Promise.all([
      supabase.from("households").select("weekly_budget,zip_code,latitude,longitude,shopping_radius_miles").eq("id",householdId).single(),
      supabase.from("household_preferences").select("min_savings_for_extra_stop,preferred_stop_limit,excluded_stores").eq("household_id",householdId).maybeSingle(),
      supabase.from("meal_plans").select("id,week_start,budget_target").eq("household_id",householdId).eq("status","active").order("week_start",{ascending:false}).limit(1).maybeSingle(),
      supabase.from("pantry_items").select("item_name,normalized_name,quantity,unit,container_size,container_unit").eq("household_id",householdId),
      supabase.from("stores").select("id,retailer_name,location_name,zip_code,latitude,longitude").eq("active",true).limit(500),
    ]);
    const first=h.error||p.error||pl.error||pa.error||st.error;if(first){setError(first.message);setLoading(false);return}
    const hh=h.data as Household;setHousehold(hh);setPrefs({min_savings_for_extra_stop:Number(p.data?.min_savings_for_extra_stop??10),preferred_stop_limit:Number(p.data?.preferred_stop_limit??1),excluded_stores:p.data?.excluded_stores??[]});setPlan((pl.data??null) as Plan|null);setPantry((pa.data??[]) as PantryItem[]);
    const local=(st.data??[] as Store[]).filter(s=>{
      if((p.data?.excluded_stores??[]).some((x:string)=>norm(s.retailer_name)===norm(x)))return false;
      if(hh.latitude!=null&&hh.longitude!=null&&s.latitude!=null&&s.longitude!=null)return haversine(hh.latitude,hh.longitude,s.latitude,s.longitude)<=Number(hh.shopping_radius_miles??10);
      if(hh.zip_code&&s.zip_code)return norm(hh.zip_code)===norm(s.zip_code);
      return false;
    });
    setStores(local);
    if(!pl.data){setIngredients([]);setPrices([]);setLoading(false);return}
    const pm=await supabase.from("meal_plan_meals").select("meal_id,selected").eq("meal_plan_id",pl.data.id).eq("selected",true);if(pm.error){setError(pm.error.message);setLoading(false);return}
    const mealIds=[...new Set(((pm.data??[]) as PlanMeal[]).map(x=>x.meal_id))];
    if(!mealIds.length){setIngredients([]);setPrices([]);setLoading(false);return}
    const ing=await supabase.from("meal_ingredients").select("meal_id,ingredient_name,normalized_name,quantity,unit,category,optional").in("meal_id",mealIds).eq("optional",false);if(ing.error){setError(ing.error.message);setLoading(false);return}setIngredients((ing.data??[]) as Ingredient[]);
    if(local.length){const now=new Date().toISOString(),cutoff=new Date(Date.now()-14*24*60*60*1000).toISOString();const pr=await supabase.from("store_prices").select("id,store_id,product_name,normalized_product_name,package_size,package_unit,price,sale_price,observed_at,expires_at").in("store_id",local.map(s=>s.id)).gte("observed_at",cutoff).or(`expires_at.is.null,expires_at.gt.${now}`).limit(5000);if(pr.error)setError(pr.error.message);else setPrices((pr.data??[]) as Price[])} else setPrices([]);
    setLoading(false);
  }

  const items=useMemo<Item[]>(()=>{
    const map=new Map<string,{name:string;normalizedName:string;quantity:number|null;unit:string|null;category:string|null}>();
    for(const i of ingredients){
      const n=foodNorm(i.normalized_name||i.ingredient_name), normalizedUnit=normalizeUnit(i.unit), group=measureGroupKey(normalizedUnit), key=`${n}|${group}`;
      const incomingQty=i.quantity==null?null:Number(i.quantity);
      const old=map.get(key);
      if(!old){
        map.set(key,{name:i.ingredient_name,normalizedName:n,quantity:incomingQty,unit:normalizedUnit,category:i.category});
        continue;
      }
      if(old.quantity==null||incomingQty==null){old.quantity=null;continue}
      const converted=convertQuantity(incomingQty,normalizedUnit,old.unit);
      if(converted==null&&normalizeUnit(normalizedUnit)!==normalizeUnit(old.unit)){
        // Keep incompatible/unknown measures separate instead of inventing a conversion.
        const fallbackKey=`${n}|unit:${normalizedUnit??"unknown"}`;
        const fallback=map.get(fallbackKey);
        if(!fallback)map.set(fallbackKey,{name:i.ingredient_name,normalizedName:n,quantity:incomingQty,unit:normalizedUnit,category:i.category});
        else fallback.quantity=fallback.quantity==null?null:fallback.quantity+incomingQty;
      }else old.quantity+=converted??incomingQty;
    }
    return [...map.entries()].map(([key,x])=>{
      const matches=pantry.filter(p=>sameFood(p.normalized_name||p.item_name,x.normalizedName));
      let pantryUsed=0,verify=false;
      if(x.quantity!=null){
        for(const p of matches){
          if(p.quantity==null){verify=true;continue}
          const converted=convertQuantity(Number(p.quantity),p.unit,x.unit);
          if(converted!=null)pantryUsed+=converted;
          else if(normalizeUnit(p.unit)===normalizeUnit(x.unit)&&x.unit!=null)pantryUsed+=Number(p.quantity);
          else if(p.container_size!=null&&p.container_unit){
            const totalInside=Number(p.quantity)*Number(p.container_size);
            const convertedContainer=convertQuantity(totalInside,p.container_unit,x.unit);
            if(convertedContainer!=null)pantryUsed+=convertedContainer;
            else if(normalizeUnit(p.container_unit)===normalizeUnit(x.unit)&&x.unit!=null)pantryUsed+=totalInside;
            else verify=true;
          }else verify=true;
        }
      }else if(matches.length)verify=true;
      pantryUsed=Math.min(pantryUsed,x.quantity??pantryUsed);
      const buy=x.quantity==null?null:Math.max(0,x.quantity-pantryUsed);
      return {
        key,name:x.name,normalizedName:x.normalizedName,
        quantity:x.quantity==null?null:roundMeasure(x.quantity,4),
        unit:normalizeUnit(x.unit),category:x.category,
        pantryUsed:roundMeasure(pantryUsed,4),
        quantityToBuy:buy==null?null:roundMeasure(buy,4),
        pantryCovered:buy===0,verifyPantry:verify
      };
    })
  },[ingredients,pantry]);

  const purchaseItems=useMemo(()=>items.filter(i=>!i.pantryCovered),[items]);
  const offerMap=useMemo(()=>{const m=new Map<string,Offer[]>();for(const item of purchaseItems){const offers:Offer[]=[];for(const row of prices){if(!sameFood(row.normalized_product_name||row.product_name,item.normalizedName))continue;const store=stores.find(s=>s.id===row.store_id);if(!store)continue;let packages=1;if(item.quantityToBuy!=null&&row.package_size!=null&&Number(row.package_size)>0){const packageInItemUnit=convertQuantity(Number(row.package_size),row.package_unit,item.unit);if(packageInItemUnit!=null&&packageInItemUnit>0)packages=Math.max(1,Math.ceil(item.quantityToBuy/packageInItemUnit));else if(item.unit!=null&&normalizeUnit(row.package_unit)===normalizeUnit(item.unit))packages=Math.max(1,Math.ceil(item.quantityToBuy/Number(row.package_size)))}const unitPrice=row.sale_price!=null?Number(row.sale_price):Number(row.price);offers.push({itemKey:item.key,store,row,packages,total:round2(packages*unitPrice)})}offers.sort((a,b)=>a.total-b.total);m.set(item.key,offers)}return m},[purchaseItems,prices,stores]);

  const strategies=useMemo<Strategy[]>(()=>{
    const build=(allowed:Store[])=>{const offers:Offer[]=[],missing:Item[]=[];for(const item of purchaseItems){const candidates=(offerMap.get(item.key)??[]).filter(o=>allowed.some(s=>s.id===o.store.id));if(candidates.length)offers.push(candidates[0]);else missing.push(item)}const used=[...new Map(offers.map(o=>[o.store.id,o.store])).values()];return {offers,missing,stores:used,total:missing.length?null:round2(offers.reduce((s,o)=>s+o.total,0)),complete:missing.length===0}};
    const cheapest=build(stores);
    const oneCandidates=stores.map(s=>({store:s,...build([s])})).filter(x=>x.complete).sort((a,b)=>(a.total??Infinity)-(b.total??Infinity));
    const one=oneCandidates[0]??null;
    const stopLimit=Math.max(1,Math.min(3,prefs.preferred_stop_limit));
    const balancedCandidates=combos(stores,stopLimit).map(ss=>build(ss)).filter(x=>x.complete).sort((a,b)=>(a.total??Infinity)-(b.total??Infinity));
    const candidate=balancedCandidates[0]??null;
    let balance=candidate;
    let note="Lowest complete basket within your store-stop limit.";
    if(one){const saving=candidate?.total!=null&&one.total!=null?round2(one.total-candidate.total):0;if(!candidate||candidate.stores.length>1&&saving<prefs.min_savings_for_extra_stop){balance=one;note=`One-stop chosen because another store would save less than ${money(prefs.min_savings_for_extra_stop)}.`}else if(candidate.stores.length>1)note=`Extra stop accepted because it saves ${money(saving)}, meeting your ${money(prefs.min_savings_for_extra_stop)} rule.`;else note="One store is already the best balance."}
    const allMissing=cheapest.missing;
    return [
      {id:"cheapest",title:"Cheapest Overall",...cheapest,note:cheapest.complete?"Lowest verified item-by-item total; may use several stores.":"Some items have no current verified price."},
      {id:"balance",title:"Best Balance",...(balance??cheapest),note:balance?note:"No complete basket is currently priced."},
      {id:"one-stop",title:"One-Stop Shop",...(one??{offers:[],missing:allMissing.length?allMissing:purchaseItems,stores:[],total:null,complete:false}),note:one?`Best complete one-store basket at ${one.store.retailer_name}.`:"No single local store currently has verified prices for every item."},
    ];
  },[stores,purchaseItems,offerMap,prefs]);

  const selected=strategies.find(s=>s.id===selectedId)??strategies[1];
  const budget=plan?.budget_target??household?.weekly_budget??null;
  const over=selected?.total!=null&&budget!=null&&selected.total>Number(budget);
  const cheaper=strategies.filter(s=>s.complete&&s.total!=null&&selected?.total!=null&&s.total<selected.total).sort((a,b)=>(a.total??0)-(b.total??0))[0];

  async function refreshLivePrices(){
    setPriceBusy(true);setError("");setMessage("");
    const {data,error:invokeError}=await supabase.functions.invoke("kroger-pricing",{body:{action:"sync",household_id:householdId}});
    if(invokeError){
      let payload:any=null;
      try{const response=(invokeError as any)?.context;if(response?.json)payload=await response.json()}catch{}
      setError(payload?.error??invokeError.message??"Unable to refresh live prices.");
      setPriceBusy(false);
      return;
    }
    await load();
    if((data?.locations_found??0)===0)setMessage(data?.message??"No Kroger-family locations were returned for this household.");
    else setMessage(`Live pricing refreshed from ${data?.provider??"Kroger"}: ${data?.prices_saved??0} price records from ${data?.locations_found??0} nearby location(s).`);
    setPriceBusy(false);
  }

  async function saveList(){if(!plan){setError("Create and save a weekly plan first.");return}setBusy(true);setError("");setMessage("");
    const existing=await supabase.from("shopping_lists").select("id").eq("household_id",householdId).eq("meal_plan_id",plan.id).eq("status","active").order("updated_at",{ascending:false}).limit(1).maybeSingle();if(existing.error){setError(existing.error.message);setBusy(false);return}
    let listId=existing.data?.id as string|undefined;const payload={household_id:householdId,meal_plan_id:plan.id,name:`MealWise Week of ${plan.week_start}`,status:"active",estimated_total:selected.complete?selected.total:null,updated_at:new Date().toISOString()};
    if(listId){const u=await supabase.from("shopping_lists").update(payload).eq("id",listId);if(u.error){setError(u.error.message);setBusy(false);return}}else{const ins=await supabase.from("shopping_lists").insert(payload).select("id").single();if(ins.error){setError(ins.error.message);setBusy(false);return}listId=ins.data.id}
    const clear=await supabase.from("shopping_list_items").delete().eq("shopping_list_id",listId);if(clear.error){setError(clear.error.message);setBusy(false);return}
    const rows=items.map(item=>{const offer=selected.offers.find(o=>o.itemKey===item.key);return {shopping_list_id:listId,ingredient_name:item.name,normalized_name:item.normalizedName,quantity:item.quantityToBuy,unit:item.unit,category:item.category,pantry_have:item.pantryCovered,purchased:false,preferred_store_id:offer?.store.id??null,notes:item.pantryCovered?"Covered by pantry":item.verifyPantry?"Verify pantry amount before buying":offer?`${offer.packages} package(s) · estimated ${money(offer.total)}`:"Price not verified"}});
    if(rows.length){const r=await supabase.from("shopping_list_items").insert(rows);if(r.error){setError(r.error.message);setBusy(false);return}}
    setMessage(selected.complete?`Shopping list saved with an estimated total of ${money(selected.total)}.`:"Shopping list saved. Estimated total is blank because some prices are missing.");setBusy(false);
  }

  if(loading)return <div className="mw-empty">Loading Smart Basket…</div>;
  if(!plan)return <div className="mw-feature"><div className="mw-feature-title"><div><h2>Smart Basket</h2><p>Save a Weekly Plan first. Then MealWise can combine ingredients and compare store strategies.</p></div></div></div>;
  return <div className="mw-feature">
    <div className="mw-feature-title"><div><h2>Smart Basket</h2><p>Combines selected meals, converts compatible recipe/pantry units, subtracts what you already have, matches package sizes, and applies your extra-store savings rule.</p></div><div className="mw-card-actions"><button className="mw-secondary" type="button" disabled={priceBusy||busy} onClick={refreshLivePrices}>{priceBusy?"Refreshing…":"Refresh Live Prices"}</button><button className="mw-primary" disabled={busy||priceBusy} onClick={saveList}>{busy?"Saving…":"Save Shopping List"}</button></div></div>
    <div className="mw-shopping-summary"><div><span>Required items</span><strong>{items.length}</strong></div><div><span>Pantry-covered</span><strong>{items.filter(i=>i.pantryCovered).length}</strong></div><div><span>Budget</span><strong>{money(budget==null?null:Number(budget))}</strong></div><div><span>Selected total</span><strong>{money(selected?.total??null)}</strong></div></div>
    {!household?.zip_code&&household?.latitude==null&&<div className="mw-alert error">Add a ZIP code or location in Setup before MealWise compares local stores.</div>}
    {stores.length===0&&<div className="mw-generator-note"><strong>No verified local stores yet.</strong> Smart Basket will not invent store availability or prices.</div>}
    {error&&<div className="mw-alert error">{error}</div>}{message&&<div className="mw-alert success">{message}</div>}
    <MealWiseOpenFoodLookup latitude={household?.latitude??null} longitude={household?.longitude??null} radiusMiles={Number(household?.shopping_radius_miles??10)} />
    <section className="mw-shopping-section"><h3>Combined grocery requirements</h3><div className="mw-shopping-list">{items.map(i=><div className="mw-shopping-item" key={i.key}><div><strong>{i.name}</strong><div className="mw-meta">{i.category&&<span>{i.category}</span>}{i.verifyPantry&&<span className="mw-lock">Verify pantry</span>}</div></div><div className="mw-quantity-flow"><span>Need {i.quantity??"?"} {i.unit??""}</span>{i.pantryUsed>0&&<span className="mw-pantry-credit">Pantry −{i.pantryUsed}</span>}<strong>{i.pantryCovered?"Buy 0":`Buy ${i.quantityToBuy??"?"} ${i.unit??""}`}</strong></div></div>)}</div></section>
    <section className="mw-shopping-section"><h3>Shopping strategy</h3><div className="mw-strategy-grid">{strategies.map(s=><button type="button" key={s.id} className={`mw-strategy-card ${selectedId===s.id?"active":""}`} onClick={()=>setSelectedId(s.id)}><span>{s.title}</span><strong>{money(s.total)}</strong><small>{s.stores.length?`${s.stores.length} store${s.stores.length===1?"":"s"}`:"Incomplete"}</small><em>{s.note}</em></button>)}</div>
      {selected&&<div className="mw-price-breakdown">{selected.offers.map(o=><div key={o.itemKey}><span>{items.find(i=>i.key===o.itemKey)?.name??o.row.product_name}</span><span>{o.store.retailer_name}</span><span>{o.packages} pkg</span><strong>{money(o.total)}</strong></div>)}</div>}
      {selected?.missing.length>0&&<div className="mw-generator-note"><strong>Missing verified prices:</strong> {selected.missing.map(i=>i.name).join(", ")}. MealWise will not fabricate a total.</div>}
    </section>
    <section className="mw-shopping-section"><h3>Budget check</h3>{selected?.total==null?<div className="mw-generator-note">A complete budget comparison needs verified prices for every purchase item.</div>:!over?<div className="mw-budget-good"><strong>Within budget.</strong> {budget!=null&&<>About {money(Number(budget)-selected.total)} remains.</>}</div>:<div className="mw-budget-rescue"><div className="mw-budget-over"><strong>Over budget by {money(selected.total-Number(budget))}</strong><span>Budget Rescue only proposes changes supported by verified data.</span></div>{cheaper?<div className="mw-rescue-row"><div><strong>Switch to {cheaper.title}</strong><span>Verified store-strategy savings: {money(selected.total-(cheaper.total??selected.total))}</span></div><button className="mw-secondary" onClick={()=>setSelectedId(cheaper.id)}>Use strategy</button></div>:<div className="mw-generator-note">No verified store-only rescue is available yet. MealWise will not invent ingredient or recipe substitutions.</div>}</div>}</section>
    <div className="mw-generator-footnote">Price safety: only recent, unexpired verified provider prices are used. Compatible package units are converted before package counts are calculated; unknown conversions remain unpriced rather than guessed.</div>
  </div>;
}
