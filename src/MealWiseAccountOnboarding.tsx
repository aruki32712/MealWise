import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { MyPantry, MyRecipes } from "./MealWiseRecipesPantry";
import MealWiseWeeklyPlanner from "./MealWiseWeeklyPlanner";
import MealWiseShoppingIntelligence from "./MealWiseShoppingIntelligence";
import MealWiseDemoTest from "./MealWiseDemoTest";
import MealWiseRecipeDiscovery from "./MealWiseRecipeDiscovery";
import "./MealWiseAccountOnboarding.css";
import "./MealWiseRecipeDiscovery.css";

type FormState = {
  householdName: string;
  householdSize: number;
  weeklyBudget: string;
  zipCode: string;
  locationText: string;
  latitude: number | null;
  longitude: number | null;
  shoppingRadiusMiles: number;
  dietaryPlan: string;
  allergies: string;
  dislikedFoods: string;
  preferredStores: string;
  excludedStores: string;
  maxCookMinutes: string;
  minSavingsForExtraStop: string;
  preferredStopLimit: number;
};

type Section = "setup" | "discover" | "recipes" | "pantry" | "weekly" | "shopping" | "test";

const emptyForm: FormState = {
  householdName: "My Household", householdSize: 1, weeklyBudget: "", zipCode: "",
  locationText: "", latitude: null, longitude: null, shoppingRadiusMiles: 10,
  dietaryPlan: "", allergies: "", dislikedFoods: "", preferredStores: "",
  excludedStores: "", maxCookMinutes: "", minSavingsForExtraStop: "10", preferredStopLimit: 1,
};

const toArray = (value: string) => value.split(",").map((v) => v.trim()).filter(Boolean);
const toCsv = (value: unknown) => Array.isArray(value) ? value.join(", ") : "";

export default function MealWiseAccountOnboarding() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [activeSection, setActiveSection] = useState<Section>("setup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isAdminTester, setIsAdminTester] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setBusy(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setHouseholdId(null); setForm(emptyForm); setActiveSection("setup"); setIsAdminTester(false); return; }
    void loadProfile(user.id);
    void checkDemoTestAccess();
  }, [user?.id]);

  async function checkDemoTestAccess() {
    const { error: demoError } = await supabase.functions.invoke("mealwise-demo-test", { body: { action: "list" } });
    setIsAdminTester(!demoError);
  }

  async function loadProfile(userId: string) {
    setBusy(true); setError("");
    const { data: household, error: hError } = await supabase.from("households")
      .select("id,name,household_size,weekly_budget,location_text,zip_code,latitude,longitude,shopping_radius_miles")
      .eq("owner_user_id", userId).maybeSingle();
    if (hError) { setError(hError.message); setBusy(false); return; }
    if (!household) { setForm(emptyForm); setHouseholdId(null); setBusy(false); return; }

    setHouseholdId(household.id);
    const { data: pref, error: pError } = await supabase.from("household_preferences")
      .select("dietary_plan,allergies,disliked_foods,preferred_stores,excluded_stores,max_cook_minutes,min_savings_for_extra_stop,preferred_stop_limit")
      .eq("household_id", household.id).maybeSingle();
    if (pError) { setError(pError.message); setBusy(false); return; }

    setForm({
      householdName: household.name ?? "My Household",
      householdSize: household.household_size ?? 1,
      weeklyBudget: household.weekly_budget == null ? "" : String(household.weekly_budget),
      zipCode: household.zip_code ?? "", locationText: household.location_text ?? "",
      latitude: household.latitude ?? null, longitude: household.longitude ?? null,
      shoppingRadiusMiles: Number(household.shopping_radius_miles ?? 10),
      dietaryPlan: pref?.dietary_plan ?? "", allergies: toCsv(pref?.allergies),
      dislikedFoods: toCsv(pref?.disliked_foods), preferredStores: toCsv(pref?.preferred_stores),
      excludedStores: toCsv(pref?.excluded_stores), maxCookMinutes: pref?.max_cook_minutes == null ? "" : String(pref.max_cook_minutes),
      minSavingsForExtraStop: String(pref?.min_savings_for_extra_stop ?? 10), preferredStopLimit: Number(pref?.preferred_stop_limit ?? 1),
    });
    setBusy(false);
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (password.length < 6) { setError("Password must be at least 6 characters."); setBusy(false); return; }
    if (mode === "signup") {
      const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password });
      if (authError) setError(authError.message);
      else setMessage(data.session ? "Account created and signed in." : "Account created. Check your email to confirm it, then sign in.");
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) setError(authError.message);
    }
    setBusy(false);
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); if (!user) return;
    setBusy(true); setError(""); setMessage("");
    const householdPayload = {
      owner_user_id: user.id, name: form.householdName.trim() || "My Household",
      household_size: Math.max(1, form.householdSize), weekly_budget: form.weeklyBudget.trim() ? Number(form.weeklyBudget) : null,
      zip_code: form.zipCode.trim() || null, location_text: form.locationText.trim() || null,
      latitude: form.latitude, longitude: form.longitude, shopping_radius_miles: form.shoppingRadiusMiles,
      updated_at: new Date().toISOString(),
    };

    let id = householdId;
    if (!id) {
      const { data, error: insertError } = await supabase.from("households").insert(householdPayload).select("id").single();
      if (insertError) { setError(insertError.message); setBusy(false); return; }
      id = data.id; setHouseholdId(id);
    } else {
      const { error: updateError } = await supabase.from("households").update(householdPayload).eq("id", id);
      if (updateError) { setError(updateError.message); setBusy(false); return; }
    }

    const { error: prefError } = await supabase.from("household_preferences").upsert({
      household_id: id, dietary_plan: form.dietaryPlan || null, allergies: toArray(form.allergies),
      disliked_foods: toArray(form.dislikedFoods), preferred_stores: toArray(form.preferredStores), excluded_stores: toArray(form.excludedStores),
      max_cook_minutes: form.maxCookMinutes ? Number(form.maxCookMinutes) : null,
      min_savings_for_extra_stop: form.minSavingsForExtraStop ? Number(form.minSavingsForExtraStop) : 10,
      preferred_stop_limit: Math.max(1, form.preferredStopLimit), updated_at: new Date().toISOString(),
    }, { onConflict: "household_id" });

    if (prefError) setError(prefError.message);
    else { setMessage("MealWise household settings saved."); setActiveSection("recipes"); }
    setBusy(false);
  }

  function useCurrentLocation() {
    setError(""); setMessage("");
    if (!navigator.geolocation) { setError("Location is not available on this device. Enter a ZIP code instead."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setForm((f) => ({ ...f, latitude: p.coords.latitude, longitude: p.coords.longitude })); setMessage("Location added. You can still enter your ZIP code for store matching."); },
      () => setError("Location permission was not granted. Enter your ZIP code instead."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  if (!user) return <main className="mw-shell"><section className="mw-card mw-auth">
    <div className="mw-brand"><span>M</span><div><h1>MealWise</h1><p>Plan smarter. Shop smarter. Waste less.</p></div></div>
    <div className="mw-tabs"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button></div>
    <form className="mw-form" onSubmit={handleAuth}>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label>Password<input type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></label>
      {error && <div className="mw-alert error">{error}</div>}{message && <div className="mw-alert success">{message}</div>}
      <button className="mw-primary" disabled={busy}>{busy ? "Working…" : mode === "signup" ? "Create MealWise Account" : "Sign In"}</button>
    </form>
  </section></main>;

  return <main className="mw-shell"><section className="mw-card mw-wide">
    <header className="mw-header"><div className="mw-brand"><span>M</span><div><h1>MealWise</h1><p>Your household food command center.</p></div></div><button className="mw-secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></header>
    <nav className="mw-app-nav"><button type="button" className={activeSection === "setup" ? "active" : ""} onClick={() => setActiveSection("setup")}>Setup</button><button type="button" className={activeSection === "discover" ? "active" : ""} disabled={!householdId} onClick={() => setActiveSection("discover")}>Discover</button><button type="button" className={activeSection === "recipes" ? "active" : ""} disabled={!householdId} onClick={() => setActiveSection("recipes")}>My Recipes</button><button type="button" className={activeSection === "pantry" ? "active" : ""} disabled={!householdId} onClick={() => setActiveSection("pantry")}>My Pantry</button><button type="button" className={activeSection === "weekly" ? "active" : ""} disabled={!householdId} onClick={() => setActiveSection("weekly")}>Weekly Plan</button><button type="button" className={activeSection === "shopping" ? "active" : ""} disabled={!householdId} onClick={() => setActiveSection("shopping")}>Smart Basket</button>{isAdminTester && <button type="button" className={activeSection === "test" ? "active" : ""} onClick={() => setActiveSection("test")}>Test Lab</button>}</nav>

    {activeSection === "setup" && <form className="mw-form" onSubmit={saveProfile}>
      <section><h2>Household & budget</h2><div className="mw-grid">
        <label>Household name<input value={form.householdName} onChange={(e) => set("householdName", e.target.value)} /></label>
        <label>People in household<input type="number" min={1} value={form.householdSize} onChange={(e) => set("householdSize", Number(e.target.value))} /></label>
        <label>Weekly grocery budget<input type="number" min={0} step="0.01" value={form.weeklyBudget} onChange={(e) => set("weeklyBudget", e.target.value)} placeholder="$125" /></label>
        <label>Maximum cooking time<input type="number" min={1} value={form.maxCookMinutes} onChange={(e) => set("maxCookMinutes", e.target.value)} placeholder="45 minutes" /></label>
      </div></section>
      <section><h2>Location & stores</h2><div className="mw-grid">
        <label>ZIP code<input inputMode="numeric" value={form.zipCode} onChange={(e) => set("zipCode", e.target.value)} placeholder="34476" /></label>
        <label>City / area<input value={form.locationText} onChange={(e) => set("locationText", e.target.value)} placeholder="Ocala, FL" /></label>
        <label>Shopping radius<select value={form.shoppingRadiusMiles} onChange={(e) => set("shoppingRadiusMiles", Number(e.target.value))}>{[5,10,15,25,50].map((n) => <option key={n} value={n}>{n} miles</option>)}</select></label>
        <div className="mw-location"><strong>Current location</strong><button type="button" className="mw-secondary" onClick={useCurrentLocation}>Use my current location</button></div>
        <label>Preferred stores<input value={form.preferredStores} onChange={(e) => set("preferredStores", e.target.value)} placeholder="Aldi, Walmart, Publix" /></label>
        <label>Stores to exclude<input value={form.excludedStores} onChange={(e) => set("excludedStores", e.target.value)} /></label>
      </div></section>
      <section><h2>Food preferences</h2><div className="mw-grid">
        <label>Dietary plan<select value={form.dietaryPlan} onChange={(e) => set("dietaryPlan", e.target.value)}><option value="">No specific plan</option><option value="balanced">Balanced</option><option value="high-protein">High protein</option><option value="low-carb">Low carb</option><option value="keto">Keto</option><option value="mediterranean">Mediterranean</option><option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option><option value="pescatarian">Pescatarian</option><option value="gluten-free">Gluten free</option></select></label>
        <label>Allergies<input value={form.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="Peanuts, shellfish" /></label>
        <label>Foods you dislike<input value={form.dislikedFoods} onChange={(e) => set("dislikedFoods", e.target.value)} placeholder="Mushrooms, olives" /></label>
      </div></section>
      <section><h2>Smart Basket rules</h2><div className="mw-grid">
        <label>Minimum savings before another store<input type="number" min={0} step="0.01" value={form.minSavingsForExtraStop} onChange={(e) => set("minSavingsForExtraStop", e.target.value)} /></label>
        <label>Preferred maximum store stops<select value={form.preferredStopLimit} onChange={(e) => set("preferredStopLimit", Number(e.target.value))}><option value={1}>1 store</option><option value={2}>2 stores</option><option value={3}>3 stores</option></select></label>
      </div><div className="mw-rule"><strong>Your rule:</strong> “Don’t add another store unless it saves me at least ${form.minSavingsForExtraStop || "0"}.”</div></section>
      {error && <div className="mw-alert error">{error}</div>}{message && <div className="mw-alert success">{message}</div>}
      <div className="mw-actions"><button className="mw-primary" disabled={busy}>{busy ? "Saving…" : "Save & Continue"}</button><small>Signed in as {user.email}</small></div>
    </form>}

    {activeSection === "discover" && householdId && <MealWiseRecipeDiscovery householdId={householdId} />}
    {activeSection === "recipes" && householdId && <MyRecipes householdId={householdId} />}
    {activeSection === "pantry" && householdId && <MyPantry householdId={householdId} />}
    {activeSection === "weekly" && householdId && <MealWiseWeeklyPlanner householdId={householdId} />}
    {activeSection === "shopping" && householdId && <MealWiseShoppingIntelligence householdId={householdId} />}
    {activeSection === "test" && isAdminTester && <MealWiseDemoTest />}
  </section></main>;
}
