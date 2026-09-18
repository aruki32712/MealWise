import { FormEvent, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { normalizeUnit } from "./lib/measurements";

type IngredientDraft = {
  ingredient_name: string;
  quantity: string;
  unit: string;
  category: string;
  optional: boolean;
  notes: string;
};

type MealRow = {
  id: string;
  name: string;
  description: string | null;
  meal_type: string | null;
  servings: number;
  instructions: string | null;
  favorite: boolean;
  prep_minutes: number | null;
  cook_minutes: number | null;
  tags: string[];
  updated_at: string;
};

type PantryRow = {
  id: string;
  item_name: string;
  quantity: number | null;
  unit: string | null;
  storage_location: "pantry" | "refrigerator" | "freezer" | "other";
  brand: string | null;
  expires_on: string | null;
  do_not_substitute: boolean;
  notes: string | null;
};

const emptyIngredient = (): IngredientDraft => ({
  ingredient_name: "",
  quantity: "",
  unit: "",
  category: "",
  optional: false,
  notes: "",
});

const parseCsv = (value: string) =>
  value.split(",").map((item) => item.trim()).filter(Boolean);

export function MyRecipes({ householdId }: { householdId: string }) {
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mealType, setMealType] = useState("dinner");
  const [servings, setServings] = useState("4");
  const [prepMinutes, setPrepMinutes] = useState("");
  const [cookMinutes, setCookMinutes] = useState("");
  const [tags, setTags] = useState("");
  const [instructions, setInstructions] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([emptyIngredient()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void loadMeals(); }, [householdId]);

  async function loadMeals() {
    setError("");
    const { data, error: loadError } = await supabase
      .from("meals")
      .select("id,name,description,meal_type,servings,instructions,favorite,prep_minutes,cook_minutes,tags,updated_at")
      .eq("household_id", householdId)
      .order("favorite", { ascending: false })
      .order("updated_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setMeals((data ?? []) as MealRow[]);
  }

  function resetForm() {
    setEditingId(null); setName(""); setDescription(""); setMealType("dinner");
    setServings("4"); setPrepMinutes(""); setCookMinutes(""); setTags("");
    setInstructions(""); setFavorite(false); setIngredients([emptyIngredient()]);
    setMessage(""); setError("");
  }

  async function editMeal(meal: MealRow) {
    setEditingId(meal.id); setName(meal.name); setDescription(meal.description ?? "");
    setMealType(meal.meal_type ?? "dinner"); setServings(String(meal.servings ?? 4));
    setPrepMinutes(meal.prep_minutes == null ? "" : String(meal.prep_minutes));
    setCookMinutes(meal.cook_minutes == null ? "" : String(meal.cook_minutes));
    setTags((meal.tags ?? []).join(", ")); setInstructions(meal.instructions ?? "");
    setFavorite(Boolean(meal.favorite)); setMessage(""); setError("");

    const { data, error: ingredientError } = await supabase
      .from("meal_ingredients")
      .select("ingredient_name,quantity,unit,category,optional,notes")
      .eq("meal_id", meal.id)
      .order("created_at", { ascending: true });
    if (ingredientError) { setError(ingredientError.message); return; }
    setIngredients(data?.length ? data.map((item) => ({
      ingredient_name: item.ingredient_name ?? "",
      quantity: item.quantity == null ? "" : String(item.quantity),
      unit: item.unit ?? "",
      category: item.category ?? "",
      optional: Boolean(item.optional),
      notes: item.notes ?? "",
    })) : [emptyIngredient()]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateIngredient<K extends keyof IngredientDraft>(index: number, key: K, value: IngredientDraft[K]) {
    setIngredients((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  async function saveRecipe(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    if (!name.trim()) { setError("Give the recipe a name."); setBusy(false); return; }
    const validIngredients = ingredients.filter((i) => i.ingredient_name.trim());
    if (!validIngredients.length) { setError("Add at least one ingredient."); setBusy(false); return; }

    const mealPayload = {
      household_id: householdId,
      name: name.trim(), description: description.trim() || null, meal_type: mealType,
      servings: Math.max(1, Number(servings || 1)), instructions: instructions.trim() || null,
      favorite, prep_minutes: prepMinutes ? Math.max(0, Number(prepMinutes)) : null,
      cook_minutes: cookMinutes ? Math.max(0, Number(cookMinutes)) : null,
      tags: parseCsv(tags), source: "user", updated_at: new Date().toISOString(),
    };

    let mealId = editingId;
    if (editingId) {
      const { error: mealError } = await supabase.from("meals").update(mealPayload).eq("id", editingId).eq("household_id", householdId);
      if (mealError) { setError(mealError.message); setBusy(false); return; }
      const { error: clearError } = await supabase.from("meal_ingredients").delete().eq("meal_id", editingId);
      if (clearError) { setError(clearError.message); setBusy(false); return; }
    } else {
      const { data, error: mealError } = await supabase.from("meals").insert(mealPayload).select("id").single();
      if (mealError) { setError(mealError.message); setBusy(false); return; }
      mealId = data.id;
    }

    const ingredientPayload = validIngredients.map((i) => ({
      meal_id: mealId,
      ingredient_name: i.ingredient_name.trim(),
      normalized_name: i.ingredient_name.trim().toLowerCase(),
      quantity: i.quantity ? Number(i.quantity) : null,
      unit: normalizeUnit(i.unit),
      category: i.category.trim() || null,
      optional: i.optional,
      notes: i.notes.trim() || null,
    }));

    const { error: ingredientError } = await supabase.from("meal_ingredients").insert(ingredientPayload);
    if (ingredientError) { setError(ingredientError.message); setBusy(false); return; }

    await loadMeals(); resetForm(); setMessage(editingId ? "Recipe updated." : "Recipe saved to My Recipes."); setBusy(false);
  }

  async function toggleFavorite(meal: MealRow) {
    const { error: favoriteError } = await supabase.from("meals").update({ favorite: !meal.favorite, updated_at: new Date().toISOString() }).eq("id", meal.id).eq("household_id", householdId);
    if (favoriteError) setError(favoriteError.message); else await loadMeals();
  }

  async function deleteMeal(meal: MealRow) {
    if (!window.confirm(`Delete "${meal.name}" from My Recipes?`)) return;
    const { error: childError } = await supabase.from("meal_ingredients").delete().eq("meal_id", meal.id);
    if (childError) { setError(childError.message); return; }
    const { error: mealError } = await supabase.from("meals").delete().eq("id", meal.id).eq("household_id", householdId);
    if (mealError) setError(mealError.message);
    else { if (editingId === meal.id) resetForm(); setMessage("Recipe deleted."); await loadMeals(); }
  }

  return <div className="mw-feature">
    <div className="mw-feature-title"><div><h2>My Recipes</h2><p>Save your own meals so MealWise can use them in future weekly plans.</p></div>{editingId && <button type="button" className="mw-secondary" onClick={resetForm}>New recipe</button>}</div>
    <form className="mw-form mw-feature-form" onSubmit={saveRecipe}>
      <div className="mw-grid">
        <label>Recipe name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mom's chicken casserole" required /></label>
        <label>Meal type<select value={mealType} onChange={(e) => setMealType(e.target.value)}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></label>
        <label>Servings<input type="number" min={1} step="0.5" value={servings} onChange={(e) => setServings(e.target.value)} /></label>
        <label>Prep time<input type="number" min={0} value={prepMinutes} onChange={(e) => setPrepMinutes(e.target.value)} placeholder="15 minutes" /></label>
        <label>Cook time<input type="number" min={0} value={cookMinutes} onChange={(e) => setCookMinutes(e.target.value)} placeholder="30 minutes" /></label>
        <label>Tags<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="High protein, low carb, quick" /></label>
      </div>
      <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description of the meal" /></label>
      <div className="mw-subsection">
        <div className="mw-feature-title"><div><h3>Ingredients</h3><p>These feed directly into the future shopping list.</p></div><button type="button" className="mw-secondary" onClick={() => setIngredients((current) => [...current, emptyIngredient()])}>+ Add ingredient</button></div>
        <div className="mw-ingredient-list">{ingredients.map((ingredient, index) => <div className="mw-ingredient-card" key={index}>
          <div className="mw-ingredient-head"><strong>Ingredient {index + 1}</strong>{ingredients.length > 1 && <button type="button" className="mw-link-danger" onClick={() => setIngredients((current) => current.filter((_, i) => i !== index))}>Remove</button>}</div>
          <div className="mw-grid mw-grid-ingredients">
            <label>Item<input value={ingredient.ingredient_name} onChange={(e) => updateIngredient(index, "ingredient_name", e.target.value)} placeholder="Chicken breast" /></label>
            <label>Quantity<input type="number" min={0} step="0.01" value={ingredient.quantity} onChange={(e) => updateIngredient(index, "quantity", e.target.value)} placeholder="2" /></label>
            <label>Unit<input value={ingredient.unit} onChange={(e) => updateIngredient(index, "unit", e.target.value)} placeholder="lb, cups, oz" /></label>
            <label>Category<input value={ingredient.category} onChange={(e) => updateIngredient(index, "category", e.target.value)} placeholder="Meat, produce" /></label>
          </div>
          <div className="mw-checkline"><label className="mw-checkbox"><input type="checkbox" checked={ingredient.optional} onChange={(e) => updateIngredient(index, "optional", e.target.checked)} />Optional ingredient</label><input value={ingredient.notes} onChange={(e) => updateIngredient(index, "notes", e.target.value)} placeholder="Ingredient note" /></div>
        </div>)}</div>
      </div>
      <label>Instructions<textarea className="mw-tall" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="1. Preheat oven…" /></label>
      <label className="mw-checkbox mw-favorite-check"><input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />Save as a favorite</label>
      {error && <div className="mw-alert error">{error}</div>}{message && <div className="mw-alert success">{message}</div>}
      <button className="mw-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Update Recipe" : "Save Recipe"}</button>
    </form>
    <div className="mw-saved-section"><h3>Saved recipes</h3>{!meals.length ? <div className="mw-empty">No recipes saved yet.</div> : <div className="mw-list">{meals.map((meal) => <article className="mw-list-card" key={meal.id}>
      <div className="mw-list-main"><div className="mw-list-title"><span>{meal.favorite ? "★" : "☆"}</span><strong>{meal.name}</strong></div><div className="mw-meta"><span>{meal.meal_type ?? "meal"}</span><span>{meal.servings} servings</span>{(meal.prep_minutes || meal.cook_minutes) && <span>{(meal.prep_minutes ?? 0) + (meal.cook_minutes ?? 0)} min</span>}</div>{meal.tags?.length > 0 && <div className="mw-tags">{meal.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</div>
      <div className="mw-card-actions"><button type="button" className="mw-secondary" onClick={() => toggleFavorite(meal)}>{meal.favorite ? "Unfavorite" : "Favorite"}</button><button type="button" className="mw-secondary" onClick={() => editMeal(meal)}>Edit</button><button type="button" className="mw-danger" onClick={() => deleteMeal(meal)}>Delete</button></div>
    </article>)}</div>}</div>
  </div>;
}

export function MyPantry({ householdId }: { householdId: string }) {
  const [items, setItems] = useState<PantryRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState<PantryRow["storage_location"]>("pantry");
  const [brand, setBrand] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [doNotSubstitute, setDoNotSubstitute] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void loadPantry(); }, [householdId]);

  async function loadPantry() {
    const { data, error: loadError } = await supabase.from("pantry_items")
      .select("id,item_name,quantity,unit,storage_location,brand,expires_on,do_not_substitute,notes")
      .eq("household_id", householdId).order("storage_location", { ascending: true }).order("item_name", { ascending: true });
    if (loadError) setError(loadError.message); else setItems((data ?? []) as PantryRow[]);
  }

  function resetPantryForm() {
    setEditingId(null); setItemName(""); setQuantity(""); setUnit(""); setLocation("pantry");
    setBrand(""); setExpiresOn(""); setDoNotSubstitute(false); setNotes(""); setMessage(""); setError("");
  }

  function editPantry(item: PantryRow) {
    setEditingId(item.id); setItemName(item.item_name); setQuantity(item.quantity == null ? "" : String(item.quantity));
    setUnit(item.unit ?? ""); setLocation(item.storage_location); setBrand(item.brand ?? "");
    setExpiresOn(item.expires_on ?? ""); setDoNotSubstitute(item.do_not_substitute); setNotes(item.notes ?? "");
    setError(""); setMessage(""); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePantryItem(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (!itemName.trim()) { setError("Enter an item name."); setBusy(false); return; }
    const payload = {
      household_id: householdId, item_name: itemName.trim(), normalized_name: itemName.trim().toLowerCase(),
      quantity: quantity ? Number(quantity) : null, unit: normalizeUnit(unit), storage_location: location,
      brand: brand.trim() || null, expires_on: expiresOn || null, do_not_substitute: doNotSubstitute,
      notes: notes.trim() || null, updated_at: new Date().toISOString(),
    };
    const result = editingId
      ? await supabase.from("pantry_items").update(payload).eq("id", editingId).eq("household_id", householdId)
      : await supabase.from("pantry_items").insert(payload);
    if (result.error) { setError(result.error.message); setBusy(false); return; }
    await loadPantry(); resetPantryForm(); setMessage(editingId ? "Pantry item updated." : "Item added to your pantry."); setBusy(false);
  }

  async function deletePantryItem(item: PantryRow) {
    if (!window.confirm(`Remove "${item.item_name}" from your inventory?`)) return;
    const { error: deleteError } = await supabase.from("pantry_items").delete().eq("id", item.id).eq("household_id", householdId);
    if (deleteError) setError(deleteError.message);
    else { if (editingId === item.id) resetPantryForm(); setMessage("Pantry item removed."); await loadPantry(); }
  }

  return <div className="mw-feature">
    <div className="mw-feature-title"><div><h2>My Pantry</h2><p>Tell MealWise what you already have so future plans buy less and waste less.</p></div>{editingId && <button type="button" className="mw-secondary" onClick={resetPantryForm}>New item</button>}</div>
    <form className="mw-form mw-feature-form" onSubmit={savePantryItem}>
      <div className="mw-grid">
        <label>Item<input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Olive oil" required /></label>
        <label>Brand<input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Optional" /></label>
        <label>Quantity<input type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1" /></label>
        <label>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bottle, oz, lb, cups" /></label>
        <label>Stored in<select value={location} onChange={(e) => setLocation(e.target.value as PantryRow["storage_location"])}><option value="pantry">Pantry</option><option value="refrigerator">Refrigerator</option><option value="freezer">Freezer</option><option value="other">Other</option></select></label>
        <label>Expiration date<input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label>
      </div>
      <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Half full, unopened, etc." /></label>
      <label className="mw-checkbox mw-protect-check"><input type="checkbox" checked={doNotSubstitute} onChange={(e) => setDoNotSubstitute(e.target.checked)} />Do not substitute this item/brand</label>
      {error && <div className="mw-alert error">{error}</div>}{message && <div className="mw-alert success">{message}</div>}
      <button className="mw-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Update Pantry Item" : "Add to Pantry"}</button>
    </form>
    <div className="mw-saved-section"><h3>Current inventory</h3>{!items.length ? <div className="mw-empty">Your pantry is empty in MealWise.</div> : <div className="mw-list">{items.map((item) => <article className="mw-list-card" key={item.id}>
      <div className="mw-list-main"><div className="mw-list-title"><strong>{item.item_name}</strong>{item.do_not_substitute && <span className="mw-lock">Do not substitute</span>}</div><div className="mw-meta"><span>{item.storage_location}</span>{(item.quantity != null || item.unit) && <span>{item.quantity ?? ""} {item.unit ?? ""}</span>}{item.brand && <span>{item.brand}</span>}{item.expires_on && <span>Expires {item.expires_on}</span>}</div></div>
      <div className="mw-card-actions"><button type="button" className="mw-secondary" onClick={() => editPantry(item)}>Edit</button><button type="button" className="mw-danger" onClick={() => deletePantryItem(item)}>Remove</button></div>
    </article>)}</div>}</div>
  </div>;
}
