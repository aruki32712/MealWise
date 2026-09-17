# MealWise

MealWise is a household meal-planning, pantry, weekly-budget and Smart Basket application backed by Supabase and deployed through Vercel.

## Current stack

- React + Vite
- Supabase Auth, Postgres and Edge Functions
- Vercel hosting
- GitHub deployment source

## Customer areas

- Household setup and budget rules
- My Recipes
- My Pantry
- Weekly Plan
- Smart Basket + Budget Rescue

## Internal Demo/Test Lab

Owners/admins automatically see an additional **Test Lab** tab. It calls the protected `mealwise-demo-test` Supabase Edge Function and can rerun the permanent fixtures:

- Normal Budget
- Tight Budget + Budget Rescue
- Allergy Safe
- Keto Household
- Vegetarian Household
- Large Family
- Limited Pantry

The fixtures use controlled mock prices only. They do not claim to represent current retailer prices.

## Supabase client configuration

The app contains the MealWise project URL and public Supabase publishable key as browser-safe defaults. Vercel environment variables can override them:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never add a Supabase secret/service-role key to Vercel client variables or frontend code.

## Local build

```bash
npm install
npm run build
npm run dev
```
