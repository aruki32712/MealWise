import { FormEvent, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type Retailer = "walmart" | "amazon";
type JobKind = "walmart_search" | "amazon_keyword";

type ResultRow = {
  retailer?: string;
  title?: string | null;
  url?: string | null;
  brand?: string | null;
  initial_price?: number | null;
  final_price?: number | null;
  currency?: string | null;
  availability?: string | boolean | null;
  seller_name?: string | null;
  product_id?: string | null;
  asin?: string | null;
};

async function invokeMessage(error:any){
  try{
    const response=error?.context;
    if(response?.json){
      const payload=await response.json();
      if(payload?.error)return String(payload.error);
    }
  }catch{}
  return error?.message||"Bright Data request failed.";
}

function money(value:number|null|undefined,currency:string|null|undefined){
  if(value==null)return "—";
  const code=(currency||"USD").toUpperCase();
  try{return new Intl.NumberFormat(undefined,{style:"currency",currency:code}).format(value)}
  catch{return `${value.toFixed(2)} ${code}`}
}

export default function MealWiseBrightDataLookup({zipcode}:{zipcode:string|null}){
  const [configured,setConfigured]=useState<boolean|null>(null);
  const [retailer,setRetailer]=useState<Retailer>("walmart");
  const [query,setQuery]=useState("");
  const [snapshotId,setSnapshotId]=useState("");
  const [jobKind,setJobKind]=useState<JobKind|null>(null);
  const [jobStatus,setJobStatus]=useState("");
  const [results,setResults]=useState<ResultRow[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{void loadStatus()},[]);

  async function loadStatus(){
    const {data,error:invokeError}=await supabase.functions.invoke("bright-data-retail",{body:{action:"status"}});
    if(invokeError){
      setConfigured(false);
      return;
    }
    setConfigured(Boolean(data?.configured));
  }

  async function search(e:FormEvent){
    e.preventDefault();
    if(!query.trim())return;
    setBusy(true);setError("");setResults([]);setJobStatus("");setSnapshotId("");

    const action:JobKind=retailer==="walmart"?"walmart_search":"amazon_keyword";
    const {data,error:invokeError}=await supabase.functions.invoke("bright-data-retail",{
      body:{action,query:query.trim(),zipcode:zipcode??undefined}
    });

    if(invokeError){
      setError(await invokeMessage(invokeError));
      setBusy(false);
      return;
    }

    if(!data?.snapshot_id){
      setError(data?.error||"Bright Data did not return a snapshot ID.");
      setBusy(false);
      return;
    }

    setSnapshotId(String(data.snapshot_id));
    setJobKind(action);
    setJobStatus("starting");
    setBusy(false);
  }

  async function checkResults(){
    if(!snapshotId||!jobKind)return;
    setBusy(true);setError("");

    const progress=await supabase.functions.invoke("bright-data-retail",{
      body:{action:"progress",snapshot_id:snapshotId}
    });
    if(progress.error){
      setError(await invokeMessage(progress.error));
      setBusy(false);
      return;
    }

    const status=String(progress.data?.status??"");
    setJobStatus(status);

    if(status==="failed"){
      setError("Bright Data reported that this collection failed.");
      setBusy(false);
      return;
    }
    if(status!=="ready"){
      setBusy(false);
      return;
    }

    const snap=await supabase.functions.invoke("bright-data-retail",{
      body:{action:"snapshot",snapshot_id:snapshotId,kind:jobKind}
    });
    if(snap.error){
      setError(await invokeMessage(snap.error));
      setBusy(false);
      return;
    }
    setResults(Array.isArray(snap.data?.results)?snap.data.results:[]);
    setBusy(false);
  }

  return <section className="mw-shopping-section">
    <h3>Retail Price Discovery — Bright Data</h3>
    <div className="mw-generator-note">
      Bright Data is a fallback discovery source for retailer product and price data. Walmart is the primary use here. For Amazon affiliate-facing links, MealWise should prefer your official Amazon Creators API when available.
    </div>

    {configured===false&&<div className="mw-alert">
      <strong>Bright Data is installed but not connected yet.</strong>
      <div>Add the BRIGHT_DATA_API_TOKEN secret in Supabase before running retailer searches.</div>
    </div>}

    {configured&&<form className="mw-discovery-search" onSubmit={search}>
      <label>Retailer
        <select value={retailer} onChange={(e)=>setRetailer(e.target.value as Retailer)}>
          <option value="walmart">Walmart</option>
          <option value="amazon">Amazon fallback</option>
        </select>
      </label>
      <label>
        Product search
        <div className="mw-discovery-search-row">
          <input
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
            placeholder="Chicken breast, olive oil, coffee…"
          />
          <button className="mw-primary" disabled={busy}>
            {busy?"Working…":"Search Retailer"}
          </button>
        </div>
      </label>
      {zipcode&&<small>Household ZIP: {zipcode}. Localized product-detail pricing can use this ZIP after a product is selected.</small>}
    </form>}

    {snapshotId&&<div className="mw-card-actions">
      <button type="button" className="mw-secondary" disabled={busy} onClick={()=>void checkResults()}>
        {busy?"Checking…":"Check Bright Data Results"}
      </button>
      <small>Job: {snapshotId} · {jobStatus||"submitted"}</small>
    </div>}

    {error&&<div className="mw-alert error">{error}</div>}

    {results.length>0&&<div className="mw-price-breakdown">
      {results.slice(0,20).map((row,i)=><div key={`${row.url??row.product_id??row.asin??i}`}>
        <span>{row.title||"Product"}</span>
        <span>{row.brand||row.seller_name||row.retailer||"Retailer"}</span>
        <span>{row.availability==null?"Availability unknown":String(row.availability)}</span>
        <strong>{money(row.final_price??row.initial_price,row.currency)}</strong>
      </div>)}
    </div>}

    {jobStatus==="ready"&&results.length===0&&!error&&
      <div className="mw-generator-note">Bright Data completed the job but returned no matching product records.</div>
    }

    <div className="mw-generator-footnote">
      Bright Data searches can consume provider credits. MealWise only starts a Bright Data job when you press Search Retailer.
    </div>
  </section>;
}
