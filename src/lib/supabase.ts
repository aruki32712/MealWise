import { createClient } from "@supabase/supabase-js";

// Vercel environment variables can override these project-safe public client values.
// The publishable key is intentionally a browser key; authorization is enforced by Supabase Auth + RLS.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://eisfxmwqfpduaaenuqyz.supabase.co";
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "sb_publishable_s5oYfqW6NaF3b0Ew_x-1jw_7FIX792r";

export const supabase = createClient(url, key);
