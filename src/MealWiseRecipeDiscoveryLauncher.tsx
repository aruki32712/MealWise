import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import MealWiseRecipeDiscovery from "./MealWiseRecipeDiscovery";
import "./MealWiseRecipeDiscovery.css";

export default function MealWiseRecipeDiscoveryLauncher() {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setHouseholdId(null); setOpen(false); return; }
    void supabase.from("households").select("id").eq("owner_user_id", user.id).maybeSingle().then(({ data }) => setHouseholdId(data?.id ?? null));
  }, [user?.id]);

  if (!user || !householdId) return null;

  return <>
    <button className="mw-discover-launcher" type="button" onClick={() => setOpen(true)} aria-label="Discover internet recipes">
      <span>⌕</span> Discover Recipes
    </button>
    {open && <div className="mw-discovery-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="mw-discovery-modal" role="dialog" aria-modal="true" aria-label="Discover Recipes">
        <button type="button" className="mw-discovery-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <MealWiseRecipeDiscovery householdId={householdId} />
      </section>
    </div>}
  </>;
}
