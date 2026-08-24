import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** Public maintenance-mode status. Never requires auth; exposes only a boolean. */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string;

  if (!url || !anonKey) {
    return Response.json({ maintenance: false, app_name: "FinSight" });
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.rpc("app_status");
  if (error) {
    return Response.json({ maintenance: false, app_name: "FinSight" });
  }

  return Response.json({
    maintenance: Boolean(data?.[0]?.maintenance ?? false),
    app_name: (data?.[0]?.app_name as string) ?? "FinSight",
  });
}
