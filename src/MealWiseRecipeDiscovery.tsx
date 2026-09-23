import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { normalizeUnit, parseMeasure } from "./lib/measurements";\nimport MealWiseNutritionLookup from "./MealWiseNutritionLookup";

type PreferenceSummary = {
  dietary_plan: string | null;
  allergies: string[];
  disliked_foods: string[];
  max_cook_minutes: number | null;
};

type RecipeIngredient = {
  name: string;
  measure: string;
  line: string;
};

type RecipeResult = {
  result_key: string;
  provider: string;
  provider_recipe_uri: string | null;
  title: string;
  image_url: string | null;
  source_name: string | null;
  source_url: string | null;
  provider_url?: string | null;
  servings: number | null;
  total_time_minutes: number | null;
  calories_per_serving: number | null;
  diet_labels: string[];
  health_labels: string[];
  cautions: string[];
  ingredient_lines: string[];
  ingredients: RecipeIngredient[];
  instructions?: string | null;
  meal_types: string[];
  dish_types: string[];
  tags?: string[];
  youtube_url?: string | null;
};

type SearchResponse = {
  provider: string;
  configured: boolean;
  using_developer_key?: boolean;
  production_key_required_for_public_appstore_release?: boolean;
  attribution_required?: boolean;
  attribution_url?: string;
  preference_summary: PreferenceSummary;
  applied_filters?: {
    diet: string | null;
    allergies?: string[];
    excluded: string[];
    max_cook_minutes: number | null;
    max_cook_minutes_note?: string | null;
    method?: string;
  };
  screening_warning?: string | null;
  nutrition_warning?: string | null;
  query?: string;
  rejected_count?: number;
  results?: RecipeResult[];
  error?: string;
};

function label(value: string | null | undefined) {
  if (!value) return "None";
  return value.replaceAll("-", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

const normalizedName = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export default function MealWiseRecipeDiscovery({ householdId }: { householdId: string }) {
  const [query, setQuery] = useState("dinner");
  const [status, setStatus] = useState<SearchResponse | null>(null);
  const [results, setResults] = useState<RecipeResult[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
    setSearching(true); setError(""); setMessage(""); setSelectedKey(null);
    try {
      const data = await call({ action: "search", query: query.trim(), limit: 12 });
      setStatus(data);
      setResults(data.results ?? []);
      if (!(data.results ?? []).length) {
        setMessage("No recipes passed your current MealWise diet/allergy screening. Try another food or review your saved restrictions.");
      }
    } catch (e: any) {
      setResults([]);
      setError(e?.payload?.error ?? e?.message ?? "Recipe search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function saveRecipe(recipe: RecipeResult) {
    setSavingKey(recipe.result_key); setError(""); setMessage("");
    try {
      const tags = [...new Set([
        ...(recipe.tags ?? []),
        ...(recipe.meal_types ?? []),
        ...(status?.preference_summary?.dietary_plan ? [status.preference_summary.dietary_plan] : []),
      ].filter(Boolean))];

      const { data: meal, error: mealError } = await supabase.from("meals").insert({
        household_id: householdId,
        name: recipe.title,
        description: [
          recipe.meal_types?.[0] ? `${recipe.meal_types[0]} recipe` : "Internet recipe",
          recipe.dish_types?.[0] ? `from ${recipe.dish_types[0]}` : "",
          "imported from TheMealDB",
        ].filter(Boolean).join(" · "),
        meal_type: "dinner",
        servings: 1,
        estimated_cost: null,
        instructions: recipe.instructions ?? null,
        nutrition: {},
        source: "themealdb",
        favorite: false,
        prep_minutes: null,
        cook_minutes: null,
        tags,
        source_url: recipe.source_url ?? recipe.provider_url ?? "https://www.themealdb.com/",
        imported_source_text: JSON.stringify({
          provider: "themealdb",
          provider_recipe_id: recipe.provider_recipe_uri,
          ingredients: recipe.ingredients,
          servings_unknown: true,
          imported_at: new Date().toISOString(),
        }),
        do_not_suggest: false,
      }).select("id").single();

      if (mealError) throw mealError;

      const ingredientRows = (recipe.ingredients ?? []).map((ingredient) => {
        const parsed = parseMeasure(ingredient.measure);
        const notes = [
          ingredient.measure ? `Original measure: ${ingredient.measure}` : null,
          parsed.descriptor ? `Descriptor: ${parsed.descriptor}` : null,
          parsed.approximate ? "Approximate/range amount; MealWise uses the upper amount for shopping." : null,
          !parsed.parsed && ingredient.measure ? "Could not structure this amount automatically." : null,
        ].filter(Boolean).join(" · ") || null;

        return {
          meal_id: meal.id,
          ingredient_name: ingredient.name,
          normalized_name: normalizedName(ingredient.name),
          quantity: parsed.quantity,
          unit: normalizeUnit(parsed.unit),
          category: null,
          optional: false,
          notes,
        };
      });

      if (ingredientRows.length) {
        const { error: ingredientError } = await supabase.from("meal_ingredients").insert(ingredientRows);
        if (ingredientError) {
          await supabase.from("meals").delete().eq("id", meal.id);
          throw ingredientError;
        }
      }

      setSavedKeys((current) => new Set(current).add(recipe.result_key));
      setSelectedKey(recipe.result_key);
      setMessage(`${recipe.title} was saved to My Recipes with structured ingredient amounts for pantry and Smart Basket conversion.`);
    } catch (e: any) {
      setError(e?.message ?? "Unable to save this recipe.");
    } finally {
      setSavingKey(null);
    }
  }

  const preferences = status?.preference_summary;
  const chips = useMemo(() => {
    const values: string[] = [];
    if (preferences?.dietary_plan) values.push(`Diet: ${label(preferences.dietary_plan)}`);
    for (const allergy of preferences?.allergies ?? []) values.push(`Avoid ${allergy}`);
    for (const disliked of preferences?.disliked_foods ?? []) values.push(`No ${disliked}`);
    if (preferences?.max_cook_minutes) values.push(`Cook-time preference: ≤ ${preferences.max_cook_minutes} min`);
    return values;
  }, [preferences]);

  if (loading) return <div className="mw-empty">Loading recipe discovery…</div>;

  return <div className="mw-feature">
    <div className="mw-feature-title">
      <div>
        <h2>Discover Recipes</h2>
        <p>Browse TheMealDB recipes and let MealWise screen their listed ingredients against your household rules.</p>
      </div>
    </div>

    <section className="mw-discovery-rules">
      <strong>MealWise screening rules:</strong>
      <div className="mw-discovery-chips">
        {chips.length ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>No diet restrictions saved</span>}
      </div>
      <small>Diet, allergy and dislike screening uses listed ingredients. Change your household rules under Setup → Food preferences.</small>
      {preferences?.max_cook_minutes && <small><b>Cook-time note:</b> TheMealDB does not provide reliable cook-time fields, so MealWise cannot enforce your maximum cooking time on these internet recipes yet.</small>}
    </section>

    {status?.using_developer_key && <div className="mw-alert">
      <strong>TheMealDB development access is active.</strong>
      <div>MealWise can use the free developer key while we build and test. Before a public app-store release, we will switch to a supporter production key.</div>
    </div>}

    <form className="mw-discovery-search" onSubmit={search}>
      <label>
        What would you like to eat?
        <div className="mw-discovery-search-row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chicken, soup, tacos, salmon…" />
          <button className="mw-primary" disabled={searching}>{searching ? "Searching…" : "Search Recipes"}</button>
        </div>
      </label>
    </form>

    {status?.screening_warning && <div className="mw-alert error"><strong>Allergy caution</strong><div>{status.screening_warning}</div></div>}
    {status?.nutrition_warning && <div className="mw-alert"><strong>Diet-screening note</strong><div>{status.nutrition_warning}</div></div>}
    {error && <div className="mw-alert error">{error}</div>}
    {message && <div className="mw-alert success">{message}</div>}

    {results.length > 0 && <div className="mw-recipe-results">
      {results.map((recipe) => {
        const selected = selectedKey === recipe.result_key;
        const saved = savedKeys.has(recipe.result_key);
        return <article className={`mw-internet-recipe ${selected ? "selected" : ""}`} key={recipe.result_key}>
          {recipe.image_url && <img src={recipe.image_url} alt="" loading="lazy" />}
          <div className="mw-internet-recipe-body">
            <div className="mw-internet-source">TheMealDB {recipe.meal_types?.[0] ? `· ${recipe.meal_types[0]}` : ""}</div>
            <h3>{recipe.title}</h3>
            <div className="mw-internet-meta">
              {recipe.dish_types?.[0] && <span>{recipe.dish_types[0]}</span>}
              {recipe.ingredient_lines?.length > 0 && <span>{recipe.ingredient_lines.length} ingredients</span>}
            </div>
            <div className="mw-discovery-chips compact">
              {[...recipe.diet_labels, ...recipe.health_labels].slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
            </div>

            {selected && <div className="mw-selected-recipe">
              <strong>Selected</strong>
              <p>MealWise screened the listed ingredients using your saved household rules. For serious allergies, verify the original recipe and package labels.</p>
              {recipe.ingredient_lines.length > 0 && <details open><summary>Ingredients</summary><ul>{recipe.ingredient_lines.map((line, i) => <li key={`${line}-${i}`}>{line}</li>)}</ul></details>}
              {recipe.instructions && <details><summary>Cooking instructions</summary><p>{recipe.instructions}</p></details>}
            </div>}

            <div className="mw-internet-actions">
              <button type="button" className={selected ? "mw-primary" : "mw-secondary"} onClick={() => setSelectedKey(selected ? null : recipe.result_key)}>
                {selected ? "Selected ✓" : "Select Recipe"}
              </button>
              <button type="button" className="mw-primary" disabled={savingKey === recipe.result_key || saved} onClick={() => saveRecipe(recipe)}>
                {savingKey === recipe.result_key ? "Saving…" : saved ? "Saved ✓" : "Save to My Recipes"}
              </button>
              {recipe.source_url && <a className="mw-secondary mw-link-button" href={recipe.source_url} target="_blank" rel="noreferrer">Original Source</a>}
            </div>
          </div>
        </article>;
      })}
    </div>}

    <MealWiseNutritionLookup />\n\n    <div className="mw-provider-attribution">
      Recipe data powered by <a href="https://www.themealdb.com/" target="_blank" rel="noreferrer">TheMealDB</a>. MealWise applies its own ingredient-based household screening.
    </div>
  </div>;
}
