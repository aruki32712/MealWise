import { FormEvent, useState } from "react";
import { supabase } from "./lib/supabase";

type Nutrient = { name:string; unit:string|null; value:number|null };
type Food = {
  fdc_id:number|null;
  description:string|null;
  data_type:string|null;
  brand_owner:string|null;
  brand_name:string|null;
  gtin_upc:string|null;
  serving_size:number|null;
  serving_size_unit:string|null;
  household_serving_full_text:string|null;
  nutrient_summary:{
    calories?:Nutrient|null;
    protein?:Nutrient|null;
    carbs?:Nutrient|null;
    fat?:Nutrient|null;
    fiber?:Nutrient|null;
    sugars?:Nutrient|null;
    sodium?:Nutrient|null;
  };
};

function value(n:Nutrient|null|undefined){
  if(!n||n.value==null)return "—";
  return `${Math.round(n.value*10)/10} ${n.unit??""}`.trim();
}

async function invokeMessage(error:any){
  try{
    const response=error?.context;
    if(response?.json){
      const payload=await response.json();
      if(payload?.error)return String(payload.error);
    }
  }catch{}
  return error?.message||"USDA FoodData Central request failed.";
}

export default function MealWiseNutritionLookup(){
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<Food[]>([]);
  const [selected,setSelected]=useState<Food|null>(null);
  const [usingDemo,setUsingDemo]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function search(e:FormEvent){
    e.preventDefault();
    if(!query.trim())return;
    setBusy(true);setError("");setSelected(null);
    const {data,error:invokeError}=await supabase.functions.invoke("usda-fooddata",{
      body:{action:"search",query:query.trim(),page_size:12}
    });
    if(invokeError){
      setError(await invokeMessage(invokeError));
      setResults([]);
      setBusy(false);
      return;
    }
    setUsingDemo(Boolean(data?.using_demo_key));
    setResults(Array.isArray(data?.results)?data.results:[]);
    setBusy(false);
  }

  async function details(food:Food){
    if(!food.fdc_id)return;
    setBusy(true);setError("");
    const {data,error:invokeError}=await supabase.functions.invoke("usda-fooddata",{
      body:{action:"food_details",fdc_id:food.fdc_id}
    });
    if(invokeError){
      setError(await invokeMessage(invokeError));
      setBusy(false);
      return;
    }
    setUsingDemo(Boolean(data?.using_demo_key));
    setSelected(data?.food??food);
    setBusy(false);
  }

  return <section className="mw-shopping-section">
    <h3>USDA Nutrition Lookup</h3>
    <div className="mw-generator-note">
      Nutrition data comes from USDA FoodData Central. Search a food or branded product to inspect calories, protein, carbohydrates, fat, fiber, sugar and sodium from the USDA record.
    </div>

    {usingDemo&&<div className="mw-alert">
      <strong>Development key active.</strong>
      <div>MealWise is using USDA's low-limit DEMO_KEY until the production FoodData Central API key is added.</div>
    </div>}

    <form className="mw-discovery-search" onSubmit={search}>
      <label>
        Search USDA FoodData Central
        <div className="mw-discovery-search-row">
          <input
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
            placeholder="Banana, chicken breast, Greek yogurt…"
          />
          <button className="mw-primary" disabled={busy}>{busy?"Searching…":"Search USDA"}</button>
        </div>
      </label>
    </form>

    {error&&<div className="mw-alert error">{error}</div>}

    {results.length>0&&<div className="mw-shopping-list">
      {results.map((food)=><button
        type="button"
        className="mw-shopping-item"
        key={String(food.fdc_id)}
        onClick={()=>void details(food)}
        style={{width:"100%",textAlign:"left"}}
      >
        <div>
          <strong>{food.description||"USDA food"}</strong>
          <div className="mw-meta">
            {food.data_type&&<span>{food.data_type}</span>}
            {(food.brand_name||food.brand_owner)&&<span>{food.brand_name||food.brand_owner}</span>}
            {food.gtin_upc&&<span>UPC {food.gtin_upc}</span>}
          </div>
        </div>
        <div className="mw-quantity-flow">
          <span>Calories</span>
          <strong>{value(food.nutrient_summary?.calories)}</strong>
        </div>
      </button>)}
    </div>}

    {selected&&<div className="mw-card">
      <strong>{selected.description}</strong>
      <div className="mw-shopping-summary" style={{marginTop:12}}>
        <div><span>Calories</span><strong>{value(selected.nutrient_summary?.calories)}</strong></div>
        <div><span>Protein</span><strong>{value(selected.nutrient_summary?.protein)}</strong></div>
        <div><span>Carbs</span><strong>{value(selected.nutrient_summary?.carbs)}</strong></div>
        <div><span>Fat</span><strong>{value(selected.nutrient_summary?.fat)}</strong></div>
        <div><span>Fiber</span><strong>{value(selected.nutrient_summary?.fiber)}</strong></div>
        <div><span>Sugars</span><strong>{value(selected.nutrient_summary?.sugars)}</strong></div>
        <div><span>Sodium</span><strong>{value(selected.nutrient_summary?.sodium)}</strong></div>
      </div>
      {(selected.serving_size||selected.household_serving_full_text)&&
        <div className="mw-generator-note">
          <strong>Serving:</strong> {selected.household_serving_full_text||`${selected.serving_size} ${selected.serving_size_unit??""}`}
        </div>
      }
    </div>}

    {results.length===0&&!busy&&query&&
      <div className="mw-generator-note">No USDA results are currently displayed. Try a broader food name.</div>
    }

    <div className="mw-provider-attribution">
      Nutrition source: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central.
    </div>
  </section>;
}
