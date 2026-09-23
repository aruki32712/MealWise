import { FormEvent, useState } from "react";
import { supabase } from "./lib/supabase";

type Product = {
  found:boolean;
  barcode?:string;
  product_name?:string|null;
  generic_name?:string|null;
  brands?:string|null;
  quantity?:string|null;
  image_url?:string|null;
  nutriscore_grade?:string|null;
};

type PriceRow = {
  id?:number|null;
  product_name?:string|null;
  price:number|null;
  price_without_discount?:number|null;
  price_is_discounted?:boolean;
  currency?:string|null;
  date?:string|null;
  price_per?:string|null;
  location?:{
    name?:string|null;
    brand?:string|null;
    display_name?:string|null;
    city?:string|null;
    postcode?:string|null;
  }|null;
};

type Bundle = {
  barcode:string;
  product?:Product;
  price_data?:{
    count?:number;
    prices?:PriceRow[];
    error?:string;
  };
};

type LocationRow = {
  id?:number|null;
  distance_km?:number|null;
  name?:string|null;
  brand?:string|null;
  display_name?:string|null;
  city?:string|null;
  postcode?:string|null;
  price_count?:number;
};

function money(value:number|null|undefined,currency:string|null|undefined){
  if(value==null)return "—";
  const code=(currency||"USD").toUpperCase();
  try{return new Intl.NumberFormat(undefined,{style:"currency",currency:code}).format(value)}
  catch{return `${value.toFixed(2)} ${code}`}
}

async function invokeErrorMessage(error:any){
  try{
    const response=error?.context;
    if(response?.json){
      const payload=await response.json();
      if(payload?.error)return String(payload.error);
    }
  }catch{}
  return error?.message||"Open food-data lookup failed.";
}

export default function MealWiseOpenFoodLookup({
  latitude,
  longitude,
  radiusMiles,
}:{
  latitude:number|null;
  longitude:number|null;
  radiusMiles:number;
}){
  const [barcode,setBarcode]=useState("");
  const [bundle,setBundle]=useState<Bundle|null>(null);
  const [locations,setLocations]=useState<LocationRow[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function lookup(e:FormEvent){
    e.preventDefault();
    const clean=barcode.replace(/\D/g,"");
    if(clean.length<8||clean.length>14){
      setError("Enter a valid 8–14 digit UPC/EAN barcode.");
      return;
    }
    setBusy(true);setError("");setBundle(null);setLocations([]);

    const jobs=[
      supabase.functions.invoke("open-food-data",{body:{action:"barcode_bundle",barcode:clean,size:20}})
    ] as any[];

    if(latitude!=null&&longitude!=null){
      jobs.push(
        supabase.functions.invoke("open-food-data",{
          body:{
            action:"nearby_price_locations",
            latitude,
            longitude,
            radius_km:Math.max(1,Number(radiusMiles||10))*1.609344,
            size:25,
          }
        })
      );
    }

    const results=await Promise.all(jobs);
    const main=results[0];
    if(main.error){
      setError(await invokeErrorMessage(main.error));
      setBusy(false);
      return;
    }
    setBundle(main.data as Bundle);

    const nearby=results[1];
    if(nearby&&!nearby.error){
      setLocations(Array.isArray(nearby.data?.locations)?nearby.data.locations:[]);
    }
    setBusy(false);
  }

  const product=bundle?.product;
  const prices=(bundle?.price_data?.prices??[]).slice(0,10);

  return <section className="mw-shopping-section">
    <h3>Open product & price lookup</h3>
    <div className="mw-generator-note">
      Uses Open Food Facts for product identity and Open Prices for crowdsourced price evidence. A missing price means no verified Open Prices record was returned; MealWise does not invent one.
    </div>

    <form className="mw-form" onSubmit={lookup}>
      <div className="mw-grid">
        <label>UPC / EAN barcode
          <input
            inputMode="numeric"
            value={barcode}
            onChange={(e)=>setBarcode(e.target.value)}
            placeholder="Enter barcode from package"
          />
        </label>
      </div>
      <div className="mw-card-actions">
        <button className="mw-secondary" disabled={busy}>
          {busy?"Looking up…":"Look Up Product"}
        </button>
      </div>
    </form>

    {error&&<div className="mw-alert error">{error}</div>}

    {bundle&&product?.found&&<div className="mw-shopping-list">
      <div className="mw-shopping-item">
        <div>
          <strong>{product.product_name||product.generic_name||"Product found"}</strong>
          <div className="mw-meta">
            {product.brands&&<span>{product.brands}</span>}
            {product.quantity&&<span>{product.quantity}</span>}
            {product.nutriscore_grade&&<span>Nutri-Score {product.nutriscore_grade.toUpperCase()}</span>}
          </div>
        </div>
        <div className="mw-quantity-flow">
          <span>Barcode</span>
          <strong>{bundle.barcode}</strong>
        </div>
      </div>
    </div>}

    {bundle&&product&&!product.found&&
      <div className="mw-generator-note"><strong>Product not found in Open Food Facts.</strong> The barcode can still be used with retailer-specific providers later.</div>
    }

    {bundle&&<div className="mw-price-breakdown">
      {prices.map((p,i)=><div key={String(p.id??i)}>
        <span>{p.location?.brand||p.location?.name||p.location?.display_name||"Open Prices location"}</span>
        <span>{p.date||"Date unknown"}</span>
        <span>{p.price_per||"unit"}</span>
        <strong>{money(p.price,p.currency)}</strong>
      </div>)}
    </div>}

    {bundle&&prices.length===0&&
      <div className="mw-generator-note"><strong>No Open Prices sightings returned for this barcode.</strong> This is expected for many U.S. products because Open Prices is crowdsourced.</div>
    }

    {locations.length>0&&
      <div className="mw-generator-note">
        <strong>Nearby Open Prices coverage:</strong> {locations.slice(0,5).map(l=>`${l.brand||l.name||l.display_name||"Store"}${l.distance_km!=null?` (${l.distance_km.toFixed(1)} km)`:""}`).join(", ")}
      </div>
    }
  </section>;
}
