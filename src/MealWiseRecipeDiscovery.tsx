import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type PreferenceSummary = {
  dietary_plan: string | null;
  allergies: string[];
  disliked_foods: string[];
  max_cook_minutes: number | null;
};

type RecipeResult = {
  result_key: string;
  provider: string;
  provider_recipe_uri: string | null;
  title: string;
  image_url: string | null;
  source_name: string | null;
  source_url: string | null;
  servings: number | null;
  total_time_minutes: number | null;
  calories_per_serving: number | null;
  diet_labels: string[];
  health_labels: string[];
  cautions: string[];
  ingredient_lines: string[];
  meal_types: string[];
  dish_types: string[];
};

type SearchResponse = {
  provider: string;
  configured: boolean;
  attribution_required?: boolean;
  attribution_url?: string;
  preference_summary: PreferenceSummary;
  applied_filters?: {
    diet: string | null;
    health: string[];
    excluded: string[];
    max_cook_minutes: number | null;
  };
  query?: string;
  results?: RecipeResult[];
  error?: string;
};

function label(value: string | null | undefined) {
  if (!value) return "None";
  return value.replaceAll("-", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function MealWiseRecipeDiscovery({ householdId }: { householdId: string }) {
  const [query, setQuery] = useState("dinner");
  const [status, setStatus] = useState<SearchResponse | null>(null);
  const [results, setResults] = useState<RecipeResult[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void loadStatus(); }, [householdId]);

  async function call(body: Record<string, unknown>) {
    const { data, error: invokeError } = await supabase.functions.invoke("recipe-discovery", {
      body: { household_id: householdId, ...body },
    });
    if (invokeError) {
      let payload: any = null;
      try {
        const response = (invokeError as any)?.context;
        if (response?.json) payload = await response.json();
      } catch {}
      const e = new Error(payload?.error || invokeError.message) as Error & { payload?: any };
      e.payload = payload;
      throw e;
    }
    return data as SearchResponse;
  }

  async function loadStatus() {
    setLoading(true); setError("");
    try {
      const data = await call({ action: "status" });
      setStatus(data);
    } catch (e: any) {
      setError(e?.payload?.error ?? e?.message ?? "Unable to load recipe discovery status.");
    } finally {
      setLoading(false);
    }
  }

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setError(""); setSelectedKey(null);
    try {
      const data = await call({ action: "search", query: query.trim(), limit: 12 });
      setStatus(data);
      setResults(data.results ?? []);
    } catch (e: any) {
      setResults([]);
      setError(e?.payload?.error ?? e?.message ?? "Recipe search failed.");
    } finally {
      setSearching(false);
    }
  }

  const preferences = status?.preference_summary;
  const chips = useMemo(() => {
    const values: string[] = [];
    if (preferences?.dietary_plan) values.push(label(preferences.dietary_plan));
    for (const allergy of preferences?.allergies ?? []) values.push(`${allergy} free`);
    for (const disliked of preferences?.disliked_foods ?? []) values.push(`No ${disliked}`);
    if (preferences?.max_cook_minutes) values.push(`≤ ${preferences.max_cook_minutes} min`);
    return values;
  }, [preferences]);

  if (loading) return <div className="mw-empty">Loading recipe discovery…</div>;

  return <div className="mw-feature">
    <div className="mw-feature-title">
      <div>
        <h2>Discover Recipes</h2>
        <p>Search internet recipes that match your saved diet, allergies, dislikes, and cooking-time limit.</p>
      </div>
    </div>

    <section className="mw-discovery-rules">
      <strong>MealWise will automatically apply:</strong>
      <div className="mw-discovery-chips">
        {chips.length ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>No diet restrictions saved</span>}
      </div>
      <small>Change these rules anytime under Setup → Food preferences.</small>
    </section>

    {!status?.configured && <div className="mw-alert">
      <strong>Recipe search is ready, but the internet recipe provider still needs its API credentials.</strong>
      <div>Once the provider is connected, this page will return live diet-matched recipes without exposing the provider key in the browser.</div>
    </div>}

    <form className="mw-discovery-search" onSubmit={search}>
      <label>
        What would you like to eat?
        <div className="mw-discovery-search-row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chicken, soup, tacos, salmon…" />
          <button className="mw-primary" disabled={searching || !status?.configured}>{searching ? "Searching…" : "Search Recipes"}</button>
        </div>
      </label>
    </form>

    {error && <div className="mw-alert error">{error}</div>}

    {results.length > 0 && <div className="mw-recipe-results">
      {results.map((recipe) => {
        const selected = selectedKey === recipe.result_key;
        return <article className={`mw-internet-recipe ${selected ? "selected" : ""}`} key={recipe.result_key}>
          {recipe.image_url && <img src={recipe.image_url} alt="" loading="lazy" />}
          <div className="mw-internet-recipe-body">
            <div className="mw-internet-source">{recipe.source_name ?? "Internet recipe"}</div>
            <h3>{recipe.title}</h3>
            <div className="mw-internet-meta">
              {recipe.total_time_minutes && <span>{recipe.total_time_minutes} min</span>}
              {recipe.servings && <span>{recipe.servings} servings</span>}
              {recipe.calories_per_serving && <span>{recipe.calories_per_serving} cal/serving</span>}
            </div>
            <div className="mw-discovery-chips compact">
              {[...recipe.diet_labels, ...recipe.health_labels].slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            {selected && <div className="mw-selected-recipe">
              <strong>Selected</strong>
              <p>MealWise found this recipe using your household rules. The cooking instructions stay with the original publisher.</p>
              {recipe.ingredient_lines.length > 0 && <details><summary>Preview ingredients</summary><ul>{recipe.ingredient_lines.slice(0, 12).map((line) => <li key={line}>{line}</li>)}</ul></details>}
            </div>}
            <div className="mw-internet-actions">
              <button type="button" className={selected ? "mw-primary" : "mw-secondary"} onClick={() => setSelectedKey(selected ? null : recipe.result_key)}>{selected ? "Selected ✓" : "Select Recipe"}</button>
              {recipe.source_url && <a className="mw-secondary mw-link-button" href={recipe.source_url} target="_blank" rel="noreferrer">View Original Recipe</a>}
            </div>
          </div>
        </article>;
      })}
    </div>}

    {status?.provider === "edamam" && <div className="mw-provider-attribution">
      Recipe search powered by <a href="https://developer.edamam.com/" target="_blank" rel="noreferrer">Edamam</a>. Original cooking instructions remain on the publisher's website.
    </div>}
  </div>;
}
