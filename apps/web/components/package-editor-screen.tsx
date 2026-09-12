"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import ItineraryEditor from "./itinerary-editor";
import { fetchOwnPackage, type CreatorPackageDetail } from "../lib/creator-api";
import { supabase } from "../lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function PackageEditorScreen({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [pkg, setPackage] = useState<CreatorPackageDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        router.replace("/login");
        return;
      }
      try {
        const result = await fetchOwnPackage(fetch, API_URL, accessToken, packageId);
        if (!cancelled) setPackage(result);
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "Unable to load this package.";
        setError(message);
        if (message.includes("sign in again")) router.replace("/login");
      }
    });
    return () => { cancelled = true; };
  }, [packageId, router]);

  if (error) return <main className="editor-load-state" role="alert"><h1>Unable to open package</h1><p>{error}</p></main>;
  if (!pkg) return <main className="editor-load-state" aria-busy="true"><p>Loading package…</p></main>;

  return <ItineraryEditor pkg={pkg} onBack={() => router.push("/dashboard")} />;
}
