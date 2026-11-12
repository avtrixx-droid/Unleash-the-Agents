// The URL and publishable key are designed to be public (RLS protects the data).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://biavgtzrylxjeeikdjus.supabase.co";
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ixkkhR5D1FPbDWGOK2RU5g_cDV2TI8F";
export const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin;
export const DEMO = new URLSearchParams(window.location.search).has("demo");
