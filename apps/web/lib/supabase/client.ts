import { createClient } from "@supabase/supabase-js";

export function resolveSupabaseConfig(url?: string, anonKey?: string) {
	if (url && anonKey) return { url, anonKey, configured: true };

	return {
		url: "https://api.example.com",
		anonKey: "local-demo-anon-key",
		configured: false,
	};
}

export const supabaseConfig = resolveSupabaseConfig(
	process.env.NEXT_PUBLIC_SUPABASE_URL,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
