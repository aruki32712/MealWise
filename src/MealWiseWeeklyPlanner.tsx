import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type Meal = { id:string; name:string; description:string|null; meal_type:"breakfast"|"lunch"|"dinner"|"snack"|null; servings:number; instructions:string|null; source_url:string|null; favorite:boolean; prep_minutes:number|null; cook_minutes:number|null; tags:string[]; do_not_suggest:boolean };
type Ingredient = { meal_id:string; ingredient_name:string; normalized_name:string|null; quantity:number|null; unit:string|null; notes:string|null; optional:boolean };
type Pantry = { item_name:string; normalized_name:string|null };
type Entry = { mealId:string|null; name:string; date:string; slot:"breakfast"|"lunch"|"dinner"|"snack"; kind:"meal"|"leftover"|"takeout"; selected:boolean; pantryMatches:number };
type Prefs = { allergies:string[]; disliked_foods:string[]; dietary_plan:string|null; max_cook_minutes:number|null };

const norm=(v:string|null|undefined)=>(v??"").trim().toLowerCase();
const iso=(d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
function monday(){const d=new Date();const day=d.getDay();d.setDate(d.getDate()+(day===0?-6:1-day));return iso(d)}
function addDays(date:string,n:number){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+n);return iso(d)}
function matches(a:string,b:string){const x=norm(a),y=norm(b);return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))}

export default function MealWiseWeeklyPlanner({householdId,initialRecipeId}:{householdId:string;initialRecipeId?:string|null}){
  const [weekStart,setWeekStart]=useState(monday());
  const [budget,setBudget]=useState("");
  const [dinners,setDinners]=useState(7);
  const [leftovers,setLeftovers]=useState(1);
  const [takeout,setTakeout]=useState(1);
  const [meals,setMeals]=useState<Meal[]>([]);
  const [ingredients,setIngredients]=useState<Ingredient[]>([]);
  const [pantry,setPantry]=useState<Pantry[]>([]);
  const [prefs,setPrefs]=useState<Prefs>({allergies:[],disliked_foods:[],dietary_plan:null,max_cook_minutes:null});
  const [plan,setPlan]=useState<Entry[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [viewMealId,setViewMealId]=useState<string|null>(null);

  useEffect(()=>{void load()},[householdId]);
  useEffect(()=>{
    if(initialRecipeId&&meals.some(m=>m.id===initialRecipeId))setViewMealId(initialRecipeId);
  },[initialRecipeId,meals]);

  async function load(){
    setLoading(true);setError("");
    const [h,p,m,pa]=await Promise.all([
      supabase.from("households").select("weekly_budget").eq("id",householdId).single(),
      supabase.from("household_preferences").select("allergies,disliked_foods,dietary_plan,max_cook_minutes").eq("household_id",householdId).maybeSingle(),
      supabase.from("meals").select("id,name,description,meal_type,servings,instructions,source_url,favorite,prep_minutes,cook_minutes,tags,do_not_suggest").eq("household_id",householdId),
      supabase.from("pantry_items").select("item_name,normalized_name").eq("household_id",householdId),
    ]);
    const e=h.error||p.error||m.error||pa.error;if(e){setError(e.message);setLoading(false);return}
    setBudget(h.data?.weekly_budget==null?"":String(h.data.weekly_budget));
    setPrefs({allergies:p.data?.allergies??[],disliked_foods:p.data?.disliked_foods??[],dietary_plan:p.data?.dietary_plan??null,max_cook_minutes:p.data?.max_cook_minutes??null});
    const mealRows=(m.data??[]) as Meal[];setMeals(mealRows);setPantry((pa.data??[]) as Pantry[]);
    if(mealRows.length){const r=await supabase.from("meal_ingredients").select("meal_id,ingredient_name,normalized_name,quantity,unit,notes,optional").in("meal_id",mealRows.map(x=>x.id));if(r.error)setError(r.error.message);else setIngredients((r.data??[]) as Ingredient[])}
    setLoading(false);
  }

  const byMeal=useMemo(()=>{const map=new Map<string,Ingredient[]>();for(const i of ingredients)map.set(i.meal_id,[...(map.get(i.meal_id)??[]),i]);return map},[ingredients]);
  const pantryNames=useMemo(()=>pantry.flatMap(p=>[norm(p.item_name),norm(p.normalized_name)]).filter(Boolean),[pantry]);
  const viewMeal=useMemo(()=>meals.find(m=>m.id===viewMealId)??null,[meals,viewMealId]);
  const viewIngredients=useMemo(()=>viewMealId?(byMeal.get(viewMealId)??[]):[],[byMeal,viewMealId]);

  function allowed(meal:Meal){
    if(meal.do_not_suggest)return false;
    const minutes=(meal.prep_minutes??0)+(meal.cook_minutes??0);if(prefs.max_cook_minutes&&minutes>prefs.max_cook_minutes)return false;
    const blocked=[...prefs.allergies,...prefs.disliked_foods];
    return !(byMeal.get(meal.id)??[]).some(i=>blocked.some(b=>matches(`${i.ingredient_name} ${i.normalized_name??""}`,b)));
  }
  function pantryMatches(mealId:string){return (byMeal.get(mealId)??[]).filter(i=>pantryNames.some(p=>matches(i.normalized_name||i.ingredient_name,p))).length}
  function rankedDinners(exclude=new Set<string>()){
    return meals.filter(m=>m.meal_type==="dinner"&&allowed(m)).map(m=>({meal:m,score:(m.favorite?10:0)+pantryMatches(m.id)*3+(prefs.dietary_plan&&m.tags?.some(t=>norm(t)===norm(prefs.dietary_plan))?2:0)-(exclude.has(m.id)?20:0)})).sort((a,b)=>b.score-a.score||a.meal.name.localeCompare(b.meal.name));
  }

  function generate(e?:FormEvent){e?.preventDefault();setError("");setMessage("");
    if(leftovers+takeout>dinners){setError("Leftover nights plus takeout nights cannot exceed dinner nights.");return}
    const recipeCount=Math.max(0,dinners-leftovers-takeout), ranked=rankedDinners(), entries:Entry[]=[];
    for(let day=0;day<dinners;day++){
      if(day<recipeCount){const choice=ranked[day%Math.max(1,ranked.length)];if(choice)entries.push({mealId:choice.meal.id,name:choice.meal.name,date:addDays(weekStart,day),slot:"dinner",kind:"meal",selected:true,pantryMatches:pantryMatches(choice.meal.id)})}
      else if(day<recipeCount+leftovers)entries.push({mealId:null,name:"Leftovers",date:addDays(weekStart,day),slot:"dinner",kind:"leftover",selected:true,pantryMatches:0});
      else entries.push({mealId:null,name:"Takeout / Restaurant",date:addDays(weekStart,day),slot:"dinner",kind:"takeout",selected:true,pantryMatches:0});
    }
    setPlan(entries);setMessage(ranked.length?"Weekly plan generated from your saved recipes, restrictions, favorites, and pantry.":"No eligible dinner recipes were found. Add recipes or review restrictions.");
  }

  function swap(index:number){const current=plan[index];if(!current.mealId)return;const used=new Set(plan.filter((_,i)=>i!==index).map(x=>x.mealId).filter(Boolean) as string[]);const next=rankedDinners(used).find(x=>x.meal.id!==current.mealId&&!used.has(x.meal.id))??rankedDinners().find(x=>x.meal.id!==current.mealId);if(!next){setError("No other eligible dinner recipe is available to swap.");return}setPlan(p=>p.map((x,i)=>i===index?{...x,mealId:next.meal.id,name:next.meal.name,selected:true,pantryMatches:pantryMatches(next.meal.id)}:x));setMessage(`Swapped in ${next.meal.name}.`)}

  function recipeUrl(mealId:string){
    const url=new URL(window.location.origin);
    url.searchParams.set("recipe",mealId);
    return url.toString();
  }
  function openRecipe(mealId:string){
    setViewMealId(mealId);
    const url=new URL(window.location.href);
    url.searchParams.set("recipe",mealId);
    window.history.replaceState({}, "", url.toString());
  }
  function closeRecipe(){
    setViewMealId(null);
    const url=new URL(window.location.href);
    url.searchParams.delete("recipe");
    window.history.replaceState({}, "", url.toString());
  }
  function escapeIcs(value:string){
    return value.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
  }
  function dateToIcs(date:string){return date.replace(/-/g,"")}
  function utcStamp(){return new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}
  async function exportCalendar(){
    const selectedEntries=plan.filter(entry=>entry.selected);
    if(!selectedEntries.length){setError("There are no selected meals to add to the calendar.");return}
    const events=selectedEntries.map(entry=>{
      const meal=entry.mealId?meals.find(m=>m.id===entry.mealId):null;
      const start=dateToIcs(entry.date);
      const end=dateToIcs(addDays(entry.date,1));
      const title=`${entry.slot.charAt(0).toUpperCase()+entry.slot.slice(1)}: ${entry.name}`;
      const link=entry.mealId?recipeUrl(entry.mealId):"";
      const description=meal
        ? [meal.description||"",link?`View recipe in MealWise: ${link}`:""].filter(Boolean).join("\n\n")
        : entry.kind==="leftover"?"MealWise planned leftovers.":"MealWise planned takeout / restaurant.";
      return [
        "BEGIN:VEVENT",
        `UID:mealwise-${entry.mealId??entry.kind}-${entry.date}@mealwise`,
        `DTSTAMP:${utcStamp()}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${escapeIcs(title)}`,
        `DESCRIPTION:${escapeIcs(description)}`,
        ...(link?[`URL:${link}`]:[]),
        "END:VEVENT"
      ].join("\r\n");
    });
    const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//MealWise//Weekly Meal Plan//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",...events,"END:VCALENDAR"].join("\r\n");
    const blob=new Blob([ics],{type:"text/calendar;charset=utf-8"});
    const file=new File([blob],`MealWise-${weekStart}.ics`,{type:"text/calendar"});
    try{
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        await navigator.share({title:"MealWise Weekly Plan",text:"Add this MealWise weekly meal plan to your calendar.",files:[file]});
        setMessage("Calendar file ready to add to your calendar.");
        return;
      }
    }catch(error){
      if((error as DOMException)?.name==="AbortError")return;
    }
    const href=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=href;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
    setMessage("Calendar file created. Open the downloaded .ics file to add the week to your calendar.");
  }

  async function save(){if(!plan.length){setError("Generate a plan first.");return}setBusy(true);setError("");
    const p=await supabase.from("meal_plans").upsert({household_id:householdId,week_start:weekStart,budget_target:budget?Number(budget):null,status:"active",breakfast_count:0,lunch_count:0,dinner_count:dinners,snack_count:0,leftover_nights:leftovers,takeout_nights:takeout,use_leftovers:leftovers>0,updated_at:new Date().toISOString()},{onConflict:"household_id,week_start"}).select("id").single();
    if(p.error){setError(p.error.message);setBusy(false);return}const id=p.data.id;const clear=await supabase.from("meal_plan_meals").delete().eq("meal_plan_id",id);if(clear.error){setError(clear.error.message);setBusy(false);return}
    const rows=plan.filter(x=>x.kind==="meal"&&x.mealId).map((x,i)=>({meal_plan_id:id,meal_id:x.mealId,planned_date:x.date,slot:x.slot,selected:x.selected,position:i+1}));
    if(rows.length){const r=await supabase.from("meal_plan_meals").insert(rows);if(r.error){setError(r.error.message);setBusy(false);return}}
    setMessage("Weekly plan saved. Smart Basket can now combine the selected recipe ingredients.");setBusy(false);
  }

  if(loading)return <div className="mw-empty">Loading weekly planner…</div>;
  return <div className="mw-feature">
    <div className="mw-feature-title"><div><h2>Weekly Plan</h2><p>Build this week from saved recipes, pantry overlap, food restrictions, leftovers, and takeout.</p></div></div>
    <form className="mw-form mw-feature-form" onSubmit={generate}><div className="mw-grid">
      <label>Week starts<input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)} /></label>
      <label>Weekly grocery budget<input type="number" min={0} step="0.01" value={budget} onChange={e=>setBudget(e.target.value)} /></label>
      <label>Dinner nights<input type="number" min={0} max={7} value={dinners} onChange={e=>setDinners(Number(e.target.value))} /></label>
      <label>Leftover nights<input type="number" min={0} max={7} value={leftovers} onChange={e=>setLeftovers(Number(e.target.value))} /></label>
      <label>Takeout nights<input type="number" min={0} max={7} value={takeout} onChange={e=>setTakeout(Number(e.target.value))} /></label>
    </div><div className="mw-generator-note"><strong>Generator rules:</strong> excluded meals, allergies/dislikes and cooking-time limits are respected. Favorites, pantry overlap and matching diet tags score higher.</div><button className="mw-primary">Generate Weekly Plan</button></form>
    {error&&<div className="mw-alert error">{error}</div>}{message&&<div className="mw-alert success">{message}</div>}
    {plan.length>0&&<div className="mw-saved-section"><div className="mw-feature-title"><div><h3>Generated week</h3><p>{plan.filter(x=>x.kind==="meal"&&x.selected).length} selected recipe dinner(s)</p></div><div className="mw-card-actions"><button type="button" className="mw-secondary" onClick={exportCalendar}>Add Week to Calendar</button><button className="mw-primary" disabled={busy} onClick={save}>{busy?"Saving…":"Save Weekly Plan"}</button></div></div><div className="mw-week-grid">{Array.from({length:7},(_,day)=>{const date=addDays(weekStart,day),entries=plan.filter(x=>x.date===date);return <section className="mw-day-card" key={date}><h4>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</h4>{entries.length?entries.map((entry,i)=><article className={`mw-plan-meal ${entry.selected?"":"mw-plan-removed"}`} key={`${entry.date}-${i}`}><div><span className="mw-slot">{entry.slot}</span>{entry.kind==="meal"&&entry.mealId
  ? <button type="button" className="mw-recipe-link" onClick={()=>openRecipe(entry.mealId!)}>{entry.name}<span>View recipe</span></button>
  : <strong>{entry.name}</strong>}
{entry.pantryMatches>0&&<small>{entry.pantryMatches} pantry match(es)</small>}</div>{entry.kind==="meal"&&<div className="mw-plan-actions"><button type="button" className="mw-secondary" onClick={()=>setPlan(p=>p.map((x,j)=>j===plan.indexOf(entry)?{...x,selected:!x.selected}:x))}>{entry.selected?"Remove":"Keep"}</button><button type="button" className="mw-secondary" onClick={()=>swap(plan.indexOf(entry))}>Swap</button></div>}</article>):<p className="mw-day-empty">No dinner planned</p>}</section>})}</div></div>}
    {viewMeal&&<div className="mw-recipe-viewer-backdrop" role="presentation" onClick={closeRecipe}>
      <section className="mw-recipe-viewer" role="dialog" aria-modal="true" aria-label={viewMeal.name} onClick={e=>e.stopPropagation()}>
        <div className="mw-recipe-viewer-head"><div><span className="mw-slot">Recipe</span><h3>{viewMeal.name}</h3></div><button type="button" className="mw-secondary" onClick={closeRecipe}>Close</button></div>
        <div className="mw-meta"><span>{viewMeal.servings} serving{viewMeal.servings===1?"":"s"}</span>{(viewMeal.prep_minutes||viewMeal.cook_minutes)&&<span>{(viewMeal.prep_minutes??0)+(viewMeal.cook_minutes??0)} min</span>}</div>
        {viewMeal.description&&<p className="mw-recipe-description">{viewMeal.description}</p>}
        <div className="mw-recipe-viewer-section"><h4>Ingredients</h4><div className="mw-recipe-ingredients">{viewIngredients.map((ingredient,i)=><div key={`${ingredient.ingredient_name}-${i}`}><strong>{ingredient.ingredient_name}</strong><span>{[ingredient.quantity,ingredient.unit].filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").join(" ")||"As needed"}{ingredient.optional?" · optional":""}{ingredient.notes?` · ${ingredient.notes}`:""}</span></div>)}</div></div>
        <div className="mw-recipe-viewer-section"><h4>Instructions</h4><p className="mw-recipe-instructions">{viewMeal.instructions||"No instructions were saved for this recipe."}</p></div>
        {viewMeal.source_url&&<a className="mw-primary mw-recipe-source" href={viewMeal.source_url} target="_blank" rel="noreferrer">Open original recipe</a>}
      </section>
    </div>}
  </div>;
}
