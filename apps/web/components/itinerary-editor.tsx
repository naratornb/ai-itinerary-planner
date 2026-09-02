"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatHotelStarRating, HOTEL_OPTIONS } from "./hotel-catalog";
import RouteMap from "./route-map";

type IconName = "plane" | "star" | "hotel" | "plus" | "alert" | "check" | "clock" | "chevron";

type TimelineItem = {
  id: number;
  dayIndex?: number;      // which day tab this belongs to (AI-generated items)
  sourceId?: string;      // inventory id from Supabase — proves provenance
  time: string;
  type: string;
  title: string;
  price: string;
  icon: IconName;
  problem?: string;
  problemDetail?: string;
  status: "critical" | "pass";
  category?: string;
  address?: string;
  duration?: string;
  notes?: string;
  photo?: string;
};

export type EditorDay = {
  day: number;
  count: number;
  title: string;
  meta: string;
};

export type EditorItem = Omit<TimelineItem, "status"> & {
  status?: "critical" | "pass";
};

export type EditorState = {
  packageTitle?: string;
  days?: EditorDay[];
  story?: string;
  items?: (TimelineItem | EditorItem)[];
  selectedHotel?: string;
  packagePrice?: number;
};

type FeasibilityIssue = {
  error_code: string;
  rule: string;
  severity: "error" | "warning";
  field?: string;
  field_value?: string;
  affected_item: string;
  message: string;
  action: string;
};

type FeasibilityResult = {
  package_id: string;
  is_feasible: boolean;
  has_warnings: boolean;
  hard_errors: FeasibilityIssue[];
  soft_warnings: FeasibilityIssue[];
  summary: string;
  quality_score?: number;
  can_publish?: boolean;
  ai_response?: any;
};

function timeToSlot(time: string): string {
  const h = parseInt(time.split(":")[0], 10);
  if (isNaN(h) || h < 13) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    plane: <><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></>,
    star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
    hotel: <><path d="M3 20V7m18 13V11a2 2 0 0 0-2-2h-7v11M3 14h18M7 10h2" /><path d="M3 20h18" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    alert: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v4m0 3h.01" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// Transfer-gap check thresholds — defined here so INITIAL_ITEMS (which calls annotateItems) can reference them.
const MIN_TRANSFER_GAP_MIN = 15; // minutes — minimum breathing room between consecutive items
const LONG_ACTIVITY_MIN = 240;   // minutes — 4 hours

const INITIAL_DAYS = [
  { day: 1, count: 4, title: "Arrival & Shibuya Evening", meta: "Story · 3 photos" },
  { day: 2, count: 4, title: "Traditional Tokyo & Food Tour", meta: "Culture · 4 stops" },
  { day: 3, count: 3, title: "Mt. Fuji Excursion & Departure", meta: "Nature & Flight · 3 stops" },
];

const INITIAL_ITEMS: TimelineItem[] = annotateItems([
  // Day 1
  { id: 1, dayIndex: 0, time: "14:30", type: "FLIGHT", title: "International arrival at Tokyo Narita", price: "$850", icon: "plane" as IconName, status: "pass", duration: "75" },
  { id: 2, dayIndex: 0, time: "17:00", type: "ACTIVITY", title: "Shibuya Crossing Quick Visit", price: "$180", icon: "star" as IconName, status: "pass", category: "Activity", address: "Shibuya Crossing, Tokyo", duration: "45", notes: "See the crossing from street level, then head upstairs for the city view.", photo: "https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=240&h=180&fit=crop" },
  { id: 3, dayIndex: 0, time: "18:30", type: "ACTIVITY", title: "Tokyo Tower Observatory visit", price: "$20", icon: "star" as IconName, status: "pass", category: "Attraction", address: "4 Chome-2-8 Shibakoen, Minato City, Tokyo", duration: "90", notes: "Arrive before sunset for daytime and evening views." },
  { id: 4, dayIndex: 0, time: "20:30", type: "HOTEL", title: "Shibuya Excel Hotel Tokyu (2 nights)", price: "$720", icon: "hotel" as IconName, status: "pass" },

  // Day 2
  { id: 5, dayIndex: 1, time: "09:30", type: "ACTIVITY", title: "Senso-ji Temple & Asakusa Walking Tour", price: "$25", icon: "star" as IconName, status: "pass", category: "Attraction", address: "2 Chome-3-1 Asakusa, Taito City, Tokyo", duration: "90", notes: "Explore Tokyo's oldest Buddhist temple and stroll along Nakamise-dori shopping street.", photo: "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=240&h=180&fit=crop" },
  { id: 6, dayIndex: 1, time: "12:00", type: "ACTIVITY", title: "Tsukiji Outer Market Street Food Tasting", price: "$45", icon: "star" as IconName, status: "pass", category: "Restaurant", address: "4 Chome-16-2 Tsukiji, Chuo City, Tokyo", duration: "75", notes: "Sample fresh sashimi, tamagoyaki, and grilled seafood skewers from local stalls." },
  { id: 7, dayIndex: 1, time: "14:30", type: "ACTIVITY", title: "Meiji Jingu Shrine & Harajuku Culture Walk", price: "$15", icon: "star" as IconName, status: "pass", category: "Activity", address: "1-1 Yoyogikamizonocho, Shibuya City, Tokyo", duration: "90", notes: "Peaceful stroll through forested shrine grounds followed by vibrant Takeshita Street." },
  { id: 8, dayIndex: 1, time: "18:00", type: "ACTIVITY", title: "Omoide Yokocho Retro Izakaya Dinner", price: "$55", icon: "star" as IconName, status: "pass", category: "Restaurant", address: "1 Chome-2 Nishishinjuku, Shinjuku City, Tokyo", duration: "90", notes: "Authentic yakitori skewers and craft drinks down Shinjuku's atmospheric lantern-lit alleyways." },

  // Day 3
  { id: 9, dayIndex: 2, time: "08:30", type: "ACTIVITY", title: "Mt. Fuji 5th Station & Lake Kawaguchiko Excursion", price: "$120", icon: "star" as IconName, status: "pass", category: "Activity", address: "Fujikawaguchiko, Minamitsuru District, Yamanashi", duration: "180", notes: "Scenic journey to Mt. Fuji with panoramic lakeside views and iconic photo stops.", photo: "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?w=240&h=180&fit=crop" },
  { id: 10, dayIndex: 2, time: "13:00", type: "ACTIVITY", title: "Traditional Hoto Noodle Lunch & Sengen Shrine", price: "$30", icon: "star" as IconName, status: "pass", category: "Restaurant", address: "Arakura, Fujiyoshida, Yamanashi", duration: "60", notes: "Warm up with hearty Yamanashi flat udon noodles in rich miso broth with mountain vegetables." },
  { id: 11, dayIndex: 2, time: "19:00", type: "FLIGHT", title: "Return flight from Tokyo Haneda (HND)", price: "$850", icon: "plane" as IconName, status: "pass", duration: "120", notes: "Evening departure back home from Haneda International Terminal." },
]);

const AVAILABLE_FLIGHTS = [
  { id: "qf25", airline: "Qantas", number: "QF25", from: "Sydney (SYD)", to: "Tokyo Haneda (HND)", departure: "20:55", arrival: "05:55", duration: "10h", price: 850 },
  { id: "jl52", airline: "Japan Airlines", number: "JL52", from: "Sydney (SYD)", to: "Tokyo Haneda (HND)", departure: "08:15", arrival: "17:05", duration: "9h 50m", price: 920 },
  { id: "qf79", airline: "Qantas", number: "QF79", from: "Melbourne (MEL)", to: "Tokyo Narita (NRT)", departure: "09:25", arrival: "18:45", duration: "10h 20m", price: 780 },
];

const ACTIVITY_CATEGORIES = ["Activity", "Restaurant", "Shopping", "Attraction", "Other"];
const DURATION_OPTIONS = ["30", "60", "90", "120", "180"];

function getEndTime(startTime: string, duration: string) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + Number(duration);
  return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/** Convert "HH:MM" to total minutes from midnight. */
function toMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * Returns true when text appears to contain random/gibberish characters.
 * Heuristics (both must be language-agnostic enough to avoid false positives on proper nouns):
 *  1. Any word with 5+ consecutive consonants (e.g. "jrhfurehog")
 *  2. More than 40% of long words (>4 letters) have a vowel ratio below 15%
 * Short texts or texts with no long words are left alone.
 */
function detectGibberish(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  const lower = text.toLowerCase();
  // Immediate fail: any 5-consonant run is a strong gibberish signal
  if (/[^aeiou\s\d\W]{5,}/.test(lower.replace(/[^a-z]/g, " "))) return true;
  // Secondary: vowel-ratio check across long words
  const words = lower.split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")).filter((w) => w.length > 4);
  if (words.length === 0) return false;
  const suspicious = words.filter((w) => {
    const vowels = (w.match(/[aeiou]/g) ?? []).length;
    return vowels / w.length < 0.15;
  });
  return suspicious.length / words.length > 0.4;
}

/**
 * Annotates each item with problem / problemDetail / status based on (priority order):
 *  1. LONG_ACTIVITY : a single item's duration exceeds LONG_ACTIVITY_MIN
 *  2. OVERLAP       : this item starts before the previous item ends
 *  3. SHORT_TRANSFER: gap to the next item is > 0 but < MIN_TRANSFER_GAP_MIN
 *  4. GIBBERISH     : item notes contain random/unreadable characters
 * All other items are marked "pass" with no problem.
 */
function annotateItems(raw: TimelineItem[]): TimelineItem[] {
  return raw.map((item, i) => {
    const durationMin = Number(item.duration ?? 60);
    const endMin = toMinutes(item.time) + durationMin;

    // 1. Long single activity
    if (durationMin > LONG_ACTIVITY_MIN) {
      const hrs = (durationMin / 60).toFixed(1);
      return {
        ...item,
        status: "critical" as const,
        problem: "Activity is unusually long",
        problemDetail: `${hrs} hrs scheduled — consider splitting into two stops`,
      };
    }

    // 2 & 3. Gap vs next item — only compare within the same day
    const next = raw[i + 1];
    if (next && next.dayIndex === item.dayIndex) {
      const nextStartMin = toMinutes(next.time);
      const gapMin = nextStartMin - endMin;

      if (gapMin < 0) {
        const overlapMin = Math.abs(gapMin);
        return {
          ...item,
          status: "critical" as const,
          problem: "Overlaps next item",
          problemDetail: `Ends ${overlapMin} min after "${next.title}" starts`,
        };
      }

      if (gapMin < MIN_TRANSFER_GAP_MIN) {
        return {
          ...item,
          status: "critical" as const,
          problem: "Transfer gap is too short",
          problemDetail: `${gapMin} min to reach "${next.title}" · ${MIN_TRANSFER_GAP_MIN} min minimum`,
        };
      }
    }

    // 4. Gibberish in description
    if (detectGibberish(item.notes ?? "")) {
      return {
        ...item,
        status: "critical" as const,
        problem: "Description contains unreadable text",
        problemDetail: "Remove random characters and use clear, traveller-friendly language",
      };
    }

    return { ...item, status: "pass" as const, problem: undefined, problemDetail: undefined };
  });
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`editor-panel ${className}`}><h2>{title}</h2>{children}</section>;
}

function StatusToggle({ tone, count, label, expanded, onClick }: { tone: "critical" | "warning" | "pass"; count?: number; label: string; expanded: boolean; onClick: () => void }) {
  return <button className="status-toggle" aria-expanded={expanded} onClick={onClick}><span className={`${tone}-icon`}><Icon name={tone === "pass" ? "check" : "alert"} size={16} /></span>{count !== undefined && <strong>{count}</strong>}<span>{label}</span><span className="status-chevron"><Icon name="chevron" size={17} /></span></button>;
}

export default function ItineraryEditor({ onBack, initialState }: { onBack: () => void; initialState?: EditorState | null }) {
  const nextItemId = useRef(1000);
  // initialState is the AI result. Absent means manual build, so fall back
  // to the demo defaults.
  const [packageTitle, setPackageTitle] = useState(initialState?.packageTitle ?? "Tokyo Food & Culture Experience");
  const [titleDraft, setTitleDraft] = useState(initialState?.packageTitle ?? "Tokyo Food & Culture Experience");
  const [editingTitle, setEditingTitle] = useState(false);
  const [destination] = useState("Tokyo");
  const [country] = useState("Japan");
  const [groupSize, setGroupSize] = useState(2);
  const [travelMonth, setTravelMonth] = useState("April");
  const [feasResult, setFeasResult] = useState<FeasibilityResult | null>(null);
  const [feasLoading, setFeasLoading] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [days, setDays] = useState(initialState?.days ?? INITIAL_DAYS);
  const [story, setStory] = useState(initialState?.story ?? "");
  const [items, setItems] = useState<TimelineItem[]>(
    initialState?.items
      ? annotateItems(
        initialState.items.map((it) => ({
          ...it,
          dayIndex: it.dayIndex ?? 0,
          status: "pass" as const,
        }))
      )
      : INITIAL_ITEMS,
  );
  const [saved, setSaved] = useState(false);
  const [published, setPublished] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedHotel, setSelectedHotel] = useState(initialState?.selectedHotel || "Shibuya Excel Hotel Tokyu");
  const [packagePrice, setPackagePrice] = useState(initialState?.packagePrice ?? 1928);
  const [photos, setPhotos] = useState([
    { src: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=720&h=720&fit=crop", alt: "Shibuya crossing at night" },
    { src: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=720&h=720&fit=crop", alt: "A bowl of Tokyo ramen" },
    { src: "https://images.unsplash.com/photo-1532236204992-f5e85c024202?w=720&h=720&fit=crop", alt: "Tokyo Tower illuminated at dusk" },
  ]);
  const toSafeImageSrc = (value: string) => {
    try {
      const url = new URL(value, window.location.origin);
      return ["https:", "http:", "blob:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const [notice, setNotice] = useState("");
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [pendingDeleteDay, setPendingDeleteDay] = useState<number | null>(null);
  const [addingAfter, setAddingAfter] = useState<number | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: "before" | "after" } | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: number; title: string; time: string; price: string; category: string; address: string; duration: string; notes: string; photo?: string } | null>(null);
  const [expandedFeasibility, setExpandedFeasibility] = useState<"critical" | "suggestions" | "passed" | null>(null);
  const [addFlow, setAddFlow] = useState<"type" | "activities" | "create" | "flight" | "hotel" | "creator">("type");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityDraft, setActivityDraft] = useState({ title: "", price: "", address: "", startTime: "12:00", duration: "30", notes: "" });
  const [flightSearch, setFlightSearch] = useState("");
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [selectedHotelOptionId, setSelectedHotelOptionId] = useState<string | null>(null);
  const [hotelNotes, setHotelNotes] = useState("");
  const [creatorDraft, setCreatorDraft] = useState({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });

  function buildValidationPayload() {
    return {
      package_id: packageTitle.toLowerCase().replace(/\s+/g, "-"),
      trip_name: packageTitle,
      city: destination,
      country: country,
      travel_month: travelMonth,
      total_days: days.length,
      group_size: groupSize,
      hotel_name: selectedHotel,
      hotel_stars: 4,
      days_json: JSON.stringify(
        days.map((day, dayIndex) => ({
          day_number: day.day,
          // Flights on this day — used by R2 transfer-time check in route.ts
          flights: items
            .filter((item) => (item.dayIndex ?? 0) === dayIndex)
            .filter((item) => item.type === "FLIGHT")
            .map((item) => ({
              arrival_time: item.time,
              flight_type: item.title.toLowerCase().includes("international")
                ? "international"
                : "domestic",
              title: item.title,
            })),
          activities: items
            .filter((item) => (item.dayIndex ?? 0) === dayIndex)
            .filter((item) => item.type !== "FLIGHT" && item.type !== "HOTEL")
            .map((item) => ({
              activity_name: item.title,
              start_time: item.time,           // HH:MM — used by R2
              slot: timeToSlot(item.time),
              category: item.category ?? item.type ?? "Activity",
              duration_hours: Number(item.duration ?? 60) / 60,
              suitable_for: "Couple",
              address: item.address ?? "",
              description: item.notes ?? "",
            })),
        }))
      ),
    };
  }

  const runFeasibilityCheck = useCallback(async () => {
    setFeasLoading(true);
    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildValidationPayload()),
      });
      if (res.ok) {
        const data = await res.json();
        console.log("=== [AI VALIDATE CLIENT RESPONSE] ===", data);
        setFeasResult(data);
      }
    } catch (err) {
      console.error("Failed to run feasibility check:", err);
    } finally {
      setFeasLoading(false);
    }
  }, [packageTitle, destination, country, travelMonth, groupSize, selectedHotel, days, items]);

  // Invalidate the check result whenever itinerary content changes after a check has been run.
  // This forces creators to re-check before they can publish edited content.
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (!feasLoading) {
      setFeasResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, days, story, packageTitle, selectedHotel, groupSize, travelMonth, packagePrice, photos]);

  useEffect(() => {
    if (pendingDeleteDay === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDeleteDay(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDeleteDay]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  };

  const generateContent = async () => {
    if (isGeneratingStory) return;
    setIsGeneratingStory(true);
    try {
      const activityNames = items
        .filter((item) => item.type !== "FLIGHT" && item.type !== "HOTEL")
        .map((item) => (item.notes ? `${item.title} (${item.notes})` : item.title));

      const res = await fetch("/api/ai/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageTitle,
          destination: "Tokyo, Japan",
          selectedHotel,
          dayNumber: activeDay + 1,
          dayTitle: days[activeDay]?.title || `Day ${activeDay + 1}`,
          items: activityNames,
          vibe: days[activeDay]?.meta || "Culture & Culinary exploration",
        }),
      });

      const data = await res.json();
      if (data.listing) {
        setStory(data.listing);
        showNotice("Story generated with Gemini AI!");
      } else if (data.error) {
        showNotice(data.error);
      }
    } catch (err) {
      console.error("Failed to generate story:", err);
      showNotice("Failed to connect to AI generator");
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const savePackageTitle = () => {
    const nextTitle = titleDraft.trim();
    if (nextTitle) setPackageTitle(nextTitle);
    else setTitleDraft(packageTitle);
    setEditingTitle(false);
  };

  const startEditingItem = (item: TimelineItem) => {
    if (editingItem?.id === item.id) {
      setEditingItem(null);
      return;
    }
    setAddingAfter(null);
    setEditingItem({ id: item.id, title: item.title, time: item.time, price: item.price.replace(/[^0-9.]/g, ""), category: item.category ?? "Activity", address: item.address ?? "", duration: item.duration ?? "60", notes: item.notes ?? "", photo: item.photo });
  };

  const saveEditedItem = () => {
    if (!editingItem || !editingItem.title.trim()) return;
    setItems((current) => annotateItems(current.map((item) => item.id === editingItem.id ? {
      ...item,
      title: editingItem.title.trim(),
      time: editingItem.time,
      price: editingItem.price ? `$${editingItem.price}` : "$0",
      category: editingItem.category,
      address: editingItem.address.trim(),
      duration: editingItem.duration,
      notes: editingItem.notes.trim(),
      photo: editingItem.photo,
    } : item)));
    setEditingItem(null);
    showNotice("Stop updated");
  };

  const insertItem = (after: number, item: Omit<TimelineItem, "id" | "dayIndex">) => {
    const next = [...items];
    nextItemId.current += 1;
    next.splice(after + 1, 0, { ...item, id: nextItemId.current, dayIndex: activeDay });
    setItems(annotateItems(next));
    setAddingAfter(null);
    setAddFlow("type");
    showNotice(`${item.title} added`);
  };

  const openAddFlow = (after: number) => {
    setEditingItem(null);
    setAddingAfter(after);
    setAddFlow("type");
    setActivitySearch("");
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setItems(annotateItems(next));
    setAddingAfter(null);
    showNotice(`${moved.title} moved to position ${toIndex + 1}`);
  };

  const dropItem = () => {
    if (draggedItemId === null || !dropTarget) return;
    const fromIndex = items.findIndex((item) => item.id === draggedItemId);
    if (fromIndex < 0) return;
    let insertionIndex = dropTarget.index + (dropTarget.position === "after" ? 1 : 0);
    if (fromIndex < insertionIndex) insertionIndex -= 1;
    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(insertionIndex, 0, moved);
    setItems(annotateItems(next));
    setAddingAfter(null);
    showNotice(`${moved.title} moved to position ${insertionIndex + 1}`);
  };

  const endDrag = () => {
    setDraggedItemId(null);
    setDropTarget(null);
  };

  const addRecommendedActivity = (title: string, meta: string, price: string) => {
    if (addingAfter === null) return;
    insertItem(addingAfter, { time: "16:00", type: "ACTIVITY", title, price, icon: "star", status: "pass", problemDetail: meta });
  };

  const createActivity = () => {
    if (addingAfter === null || !activityDraft.title.trim()) return;
    insertItem(addingAfter, {
      time: activityDraft.startTime,
      type: "ACTIVITY",
      title: activityDraft.title.trim(),
      price: activityDraft.price.trim() ? `$${activityDraft.price.trim()}` : "$0",
      icon: "star",
      status: "pass",
    });
    setActivityDraft({ title: "", price: "", address: "", startTime: "12:00", duration: "30", notes: "" });
  };

  const addSelectedFlight = () => {
    const flight = AVAILABLE_FLIGHTS.find((option) => option.id === selectedFlightId);
    if (addingAfter === null || !flight) return;
    insertItem(addingAfter, {
      time: flight.departure,
      type: "FLIGHT",
      title: `${flight.from} to ${flight.to} · ${flight.airline} ${flight.number}`,
      price: `$${flight.price}`,
      icon: "plane",
      status: "pass",
    });
    setFlightSearch("");
    setSelectedFlightId(null);
  };

  const matchingFlights = AVAILABLE_FLIGHTS.filter((flight) =>
    [flight.airline, flight.number, flight.from, flight.to].join(" ").toLowerCase().includes(flightSearch.trim().toLowerCase()),
  );
  const selectedHotelOption = HOTEL_OPTIONS.find(({ id }) => id === selectedHotelOptionId);

  const createHotel = () => {
    if (addingAfter === null || !selectedHotelOption) return;
    insertItem(addingAfter, {
      time: selectedHotelOption.checkIn,
      type: "HOTEL",
      title: selectedHotelOption.name,
      price: `$${selectedHotelOption.price.toLocaleString("en-US")}`,
      icon: "hotel",
      status: "pass",
      address: selectedHotelOption.address,
      notes: hotelNotes.trim(),
    });
    setSelectedHotelOptionId(null);
    setHotelNotes("");
  };

  const createCreatorPick = () => {
    if (addingAfter === null || !creatorDraft.title.trim()) return;
    insertItem(addingAfter, {
      time: creatorDraft.time,
      type: "CREATOR PICK",
      title: creatorDraft.title.trim(),
      price: creatorDraft.price.trim() ? `$${creatorDraft.price.trim()}` : "$0",
      icon: "star",
      status: "pass",
    });
    setCreatorDraft({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });
  };

  const recommendedActivities = [
    { title: "Shibuya Sky", meta: "Observation deck · 60 min", price: "$22" },
    { title: "Tsukiji Market", meta: "Food tour · 120 min", price: "Free" },
    { title: "teamLab Planets", meta: "Immersive art · 90 min", price: "$38" },
  ].filter((activity) => activity.title.toLowerCase().includes(activitySearch.trim().toLowerCase()));

  const deleteDay = (indexToDelete: number) => {
    if (days.length === 1) return;
    const remaining = days
      .filter((_, index) => index !== indexToDelete)
      .map((day, index) => ({ ...day, day: index + 1 }));
    setDays(remaining);
    setActiveDay((current) => {
      if (current > indexToDelete) return current - 1;
      if (current === indexToDelete) return Math.max(0, indexToDelete - 1);
      return current;
    });
    showNotice(`Day ${indexToDelete + 1} deleted`);
  };

  const hardErrors = feasResult?.hard_errors ?? [];
  const softWarnings = feasResult?.soft_warnings ?? [];
  const hasEmptyDay = Array.from({ length: days.length }).some((_, i) => !items.some((it) => (it.dayIndex ?? 0) === i));
  const displayScore = hasEmptyDay ? 0 : feasResult?.quality_score;

  const isReadyToPublish = Boolean(
    feasResult &&
    (displayScore ?? 0) >= 70 &&
    hardErrors.length === 0 &&
    feasResult.is_feasible
  );

  // Items carry dayIndex only when they came from the AI. Manual/demo items
  // have none, so show everything in that case (preserves old behaviour).
  // Pair each item with its ORIGINAL index — delete, drag and insert all
  // index into the full items[] array.
  const hasDayTags = items.some((item) => item.dayIndex !== undefined);
  const visibleItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !hasDayTags || (item.dayIndex ?? 0) === activeDay);

  return (
    <main className="itinerary-editor">
      <header className="editor-topbar">
        <button className="text-action back-action" onClick={onBack} aria-label="Edit destination, travel style, duration, or season"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> Edit trip setup</button>
        <div className="editor-title-block"><span className="editor-kicker">AI itinerary editor</span>{editingTitle ? <input className="package-title-input" value={titleDraft} autoFocus maxLength={200} aria-label="Package title" onChange={(event) => setTitleDraft(event.target.value)} onBlur={savePackageTitle} onKeyDown={(event) => { if (event.key === "Enter") savePackageTitle(); if (event.key === "Escape") { setTitleDraft(packageTitle); setEditingTitle(false); } }} /> : <button className="package-title-button" onClick={() => { setTitleDraft(packageTitle); setEditingTitle(true); }} aria-label={`Edit package title, currently ${packageTitle}`} title="Edit package title"><h1>{packageTitle}</h1></button>}</div>
        <div className="editor-actions">
          <button className="quiet-button" onClick={() => { setSaved(true); showNotice("Draft saved"); }}>{saved ? "Saved" : "Save Draft"}</button>
          <button className="quiet-button" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button className="publish-button" disabled={!isReadyToPublish || feasLoading} onClick={() => { setPublished(true); showNotice("Package ready to publish"); }}>
            {!isReadyToPublish ? (feasResult && !feasResult.is_feasible ? "Fix issues to publish" : "Check content to publish") : "Continue to publish"}
          </button>
        </div>
      </header>

      <nav className="day-strip" aria-label="Itinerary days">
        <div className="day-tabs">
          {days.map((day, index) => <div key={day.day} className={`day-tab-wrap ${activeDay === index ? "active" : ""}`}>
            <button aria-current={activeDay === index ? "page" : undefined} className={`day-tab ${activeDay === index ? "active" : ""}`} onClick={() => setActiveDay(index)}><span>DAY {day.day} <b>{day.count}</b></span><strong>{day.title}</strong><small>{day.meta}</small></button>
            <button className="delete-day-tab" disabled={days.length === 1} onClick={() => setPendingDeleteDay(index)} aria-label={`Delete Day ${day.day}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </div>)}
          <button className="add-day" onClick={() => { const nextDay = days.length + 1; setDays([...days, { day: nextDay, count: 0, title: "Untitled day", meta: "Add your first stop" }]); setActiveDay(days.length); showNotice("A new day was added"); }}><Icon name="plus" size={24} /><span>Add Day</span></button>
        </div>
        <div className="trip-length"><strong>3 days</strong><span>2 nights</span></div>
      </nav>

      <div className="editor-shell">
        <div className="editor-main">
          <div className="day-heading"><div><span>Day {activeDay + 1}</span><h2>{days[activeDay]?.title ?? "Untitled day"}</h2></div></div>

          <section className="story-section">
            <div className="section-label"><h3>Tell your story</h3><span>3 uploaded</span></div>
            <div className="photo-grid">
              {photos.map((photo) => <img key={photo.src} src={toSafeImageSrc(photo.src)} alt={photo.alt} />)}
              <label className="photo-add"><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setPhotos([...photos, { src: URL.createObjectURL(file), alt: file.name }]); showNotice("Photo uploaded"); }} /><Icon name="plus" size={30} /><span>Add photo</span><small>JPG or PNG</small></label>
            </div>
          </section>

          <section className="story-copy">
            <div className="section-label">
              <h3>Your story</h3>
              <button
                className="ai-button"
                disabled={isGeneratingStory}
                onClick={generateContent}
                aria-label="Generate story with AI"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
                </svg>
                {isGeneratingStory ? "Generating story…" : "AI write for me"}
              </button>
            </div>
            <textarea value={story} onChange={(event) => setStory(event.target.value)} placeholder="Share your insider tips and personal recommendations…" aria-label="Your story" />
          </section>

          <section className="timeline-section">
            <h3>Timeline</h3>
            <div className="timeline-list">
              {visibleItems.map(({ item, index }) => <div key={item.id} className={`timeline-group ${addingAfter === index ? "adding" : ""} ${dropTarget?.index === index ? `drop-${dropTarget.position}` : ""}`} onDragOver={(event) => { event.preventDefault(); if (draggedItemId === item.id) return; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ index, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" }); }} onDrop={(event) => { event.preventDefault(); dropItem(); endDrag(); }}>
                <article className={`timeline-item ${item.status} ${draggedItemId === item.id ? "dragging" : ""} ${item.type !== "FLIGHT" && item.type !== "HOTEL" ? "editable" : ""} ${editingItem?.id === item.id ? "expanded" : ""}`} onClick={(event) => { if (item.type === "FLIGHT" || item.type === "HOTEL" || (event.target as HTMLElement).closest("button")) return; startEditingItem(item); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && item.type !== "FLIGHT" && item.type !== "HOTEL" && !(event.target as HTMLElement).closest("button")) { event.preventDefault(); startEditingItem(item); } }} tabIndex={item.type !== "FLIGHT" && item.type !== "HOTEL" ? 0 : undefined} role={item.type !== "FLIGHT" && item.type !== "HOTEL" ? "button" : undefined} aria-expanded={item.type !== "FLIGHT" && item.type !== "HOTEL" ? editingItem?.id === item.id : undefined}>
                  <button className="drag-handle" draggable aria-label={`Move ${item.title}. Use drag and drop, or the up and down arrow keys.`} onDragStart={(event) => { setEditingItem(null); setDraggedItemId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(item.id)); }} onDragEnd={endDrag} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); moveItem(index, index - 1); } if (event.key === "ArrowDown") { event.preventDefault(); moveItem(index, index + 1); } }}><span /><span /><span /><span /><span /><span /></button>
                  <div className="item-time"><Icon name={item.icon} /><strong>{item.time}</strong></div>
                  <div className="item-copy"><div className="item-copy-head"><span>{item.type}</span></div><h4>{item.title}</h4>{item.problem && <div className="item-alert"><Icon name="alert" size={15} /><div><strong>{item.problem}</strong><span>{item.problemDetail}</span></div></div>}</div>
                  <div className="item-price"><span>Price</span><strong>{item.price}</strong></div>
                </article>
                {editingItem?.id === item.id && <section className="inline-edit" aria-label={`Edit ${item.title}`}>
                  <div className="edit-categories"><span>Category</span><div>{ACTIVITY_CATEGORIES.map((category) => <button key={category} className={editingItem.category === category ? "selected" : ""} onClick={() => setEditingItem({ ...editingItem, category })}>{category}</button>)}</div></div>
                  <div className="inline-edit-grid activity-details-grid">
                    <label className="edit-title"><span>Activity</span><input value={editingItem.title} onChange={(event) => setEditingItem({ ...editingItem, title: event.target.value })} autoFocus /></label>
                    <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={editingItem.price} onChange={(event) => setEditingItem({ ...editingItem, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                    <label className="edit-address"><span>Address</span><input value={editingItem.address} onChange={(event) => setEditingItem({ ...editingItem, address: event.target.value })} placeholder="Add an address" /></label>
                    <label><span>Start time</span><input type="time" value={editingItem.time} onChange={(event) => setEditingItem({ ...editingItem, time: event.target.value })} /></label>
                    <label><span>Duration (min)</span><select value={editingItem.duration} onChange={(event) => setEditingItem({ ...editingItem, duration: event.target.value })}>{DURATION_OPTIONS.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
                    <label><span>Ends at</span><input value={getEndTime(editingItem.time, editingItem.duration ?? "60")} readOnly /></label>
                    <label className="edit-notes"><span>Notes</span><textarea value={editingItem.notes} onChange={(event) => setEditingItem({ ...editingItem, notes: event.target.value })} placeholder="Share why this is worth a stop" /></label>
                  </div>
                  <div className="edit-photo"><span>Photos <small>Optional</small></span><div>{editingItem.photo && <figure><img src={editingItem.photo} alt="Activity cover" /><b>Cover</b></figure>}<label><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) setEditingItem({ ...editingItem, photo: URL.createObjectURL(file) }); }} /><Icon name="plus" size={18} />Add photo</label></div></div>
                  <div className="inline-edit-actions"><button className="quiet-button" onClick={() => setEditingItem(null)}>Cancel</button><button className="publish-button" disabled={!editingItem.title.trim()} onClick={saveEditedItem}>Save changes</button></div>
                </section>}
                {addingAfter === index ? <section className="inline-add" aria-label="Add a stop">
                  {addFlow === "type" && <>
                    <div className="inline-add-head"><h4>Select item type</h4><button onClick={() => setAddingAfter(null)}>Cancel</button></div>
                    <div className="item-type-grid">
                      <button onClick={() => setAddFlow("flight")}><span className="type-icon flight"><Icon name="plane" /></span><strong>Flight</strong><small>Air travel and transfers</small></button>
                      <button onClick={() => setAddFlow("hotel")}><span className="type-icon hotel"><Icon name="hotel" /></span><strong>Hotel</strong><small>Accommodation and stays</small></button>
                      <button onClick={() => setAddFlow("activities")}><span className="type-icon activity"><Icon name="star" /></span><strong>Activity</strong><small>Tours, museums, and experiences</small></button>
                      <button onClick={() => setAddFlow("creator")}><span className="type-icon creator"><Icon name="check" /></span><strong>Creator Pick</strong><small>Your own recommendation</small></button>
                    </div>
                  </>}

                  {addFlow === "flight" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Choose a flight</h4><button onClick={() => setAddingAfter(null)}>Cancel</button></div>
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input value={flightSearch} onChange={(event) => setFlightSearch(event.target.value)} placeholder="Search by airport, airline, or flight number" /></label>
                    <p className="database-note">Flights are supplied by Travel Marketplace and cannot be edited here.</p>
                    <div className="flight-results" role="radiogroup" aria-label="Available flights">
                      {matchingFlights.map((flight) => <button key={flight.id} type="button" role="radio" aria-checked={selectedFlightId === flight.id} className={selectedFlightId === flight.id ? "selected" : ""} onClick={() => setSelectedFlightId(flight.id)}>
                        <span className="flight-brand"><strong>{flight.airline}</strong><small>{flight.number}</small></span>
                        <span className="flight-route"><strong>{flight.departure}</strong><small>{flight.from}</small></span>
                        <span className="flight-duration"><small>{flight.duration}</small><i aria-hidden="true"><Icon name="plane" size={20} /></i></span>
                        <span className="flight-route"><strong>{flight.arrival}</strong><small>{flight.to}</small></span>
                        <span className="flight-fare"><small>From</small><strong>${flight.price}</strong></span>
                        <span className="flight-select" aria-hidden="true">{selectedFlightId === flight.id ? <Icon name="check" size={18} /> : ""}</span>
                      </button>)}
                      {matchingFlights.length === 0 && <p>No matching flights found.</p>}
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!selectedFlightId} onClick={addSelectedFlight}>Add selected flight</button></div>
                  </>}

                  {addFlow === "hotel" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Add hotel</h4><button onClick={() => setAddingAfter(null)}>Cancel</button></div>
                    <p className="database-note">Choose a hotel from the fixed Marketplace options.</p>
                    <div className="hotel-choice-grid" role="radiogroup" aria-label="Available hotels">
                      {HOTEL_OPTIONS.map((hotel) => <button key={hotel.id} type="button" role="radio" aria-checked={selectedHotelOptionId === hotel.id} className={`hotel-choice-card${selectedHotelOptionId === hotel.id ? " selected" : ""}`} onClick={() => setSelectedHotelOptionId(hotel.id)}>
                        <span className="hotel-choice-image"><Image src={hotel.image} alt={hotel.imageAlt} fill sizes="(max-width: 720px) 100vw, 33vw" /></span>
                        <span className="hotel-choice-copy"><strong>{hotel.name}</strong><span className="hotel-star-rating">{formatHotelStarRating(hotel.starRating)}</span><small>{hotel.area}</small><span>{hotel.room}</span><b>${hotel.price.toLocaleString("en-US")} total</b></span>
                        <span className="hotel-choice-check" aria-hidden="true">{selectedHotelOptionId === hotel.id ? <Icon name="check" size={20} /> : ""}</span>
                      </button>)}
                    </div>
                    {selectedHotelOption && <div className="activity-form hotel-fixed-details">
                      <label className="full"><span>Hotel name</span><input value={selectedHotelOption.name} readOnly /></label>
                      <label className="full"><span>Address</span><input value={selectedHotelOption.address} readOnly /></label>
                      <label><span>Check-in</span><input value={selectedHotelOption.checkIn} readOnly /></label>
                      <label><span>Check-out</span><input value={selectedHotelOption.checkOut} readOnly /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input value={selectedHotelOption.price.toLocaleString("en-US")} readOnly /></div></label>
                      <label className="full"><span>Room type</span><input value={selectedHotelOption.room} readOnly /></label>
                      <label className="full"><span>Notes</span><textarea value={hotelNotes} onChange={(event) => setHotelNotes(event.target.value)} placeholder="Add check-in or booking details" /></label>
                    </div>}
                    <div className="activity-form-actions"><button className="publish-button" disabled={!selectedHotelOption} onClick={createHotel}>Add hotel</button></div>
                  </>}

                  {addFlow === "creator" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Add creator pick</h4><button onClick={() => setAddingAfter(null)}>Cancel</button></div>
                    <div className="activity-form">
                      <label className="full"><span>Title</span><input value={creatorDraft.title} onChange={(event) => setCreatorDraft({ ...creatorDraft, title: event.target.value })} placeholder="Your recommendation" /></label>
                      <label><span>Category</span><select value={creatorDraft.category} onChange={(event) => setCreatorDraft({ ...creatorDraft, category: event.target.value })}>{ACTIVITY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
                      <label><span>Start time</span><input type="time" value={creatorDraft.time} onChange={(event) => setCreatorDraft({ ...creatorDraft, time: event.target.value })} /></label>
                      <label><span>Duration (min)</span><select value={creatorDraft.duration} onChange={(event) => setCreatorDraft({ ...creatorDraft, duration: event.target.value })}>{DURATION_OPTIONS.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
                      <label className="full"><span>Address</span><input value={creatorDraft.address} onChange={(event) => setCreatorDraft({ ...creatorDraft, address: event.target.value })} /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={creatorDraft.price} onChange={(event) => setCreatorDraft({ ...creatorDraft, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="full"><span>Why you recommend it</span><textarea value={creatorDraft.reason} onChange={(event) => setCreatorDraft({ ...creatorDraft, reason: event.target.value })} placeholder="Share the detail travellers should know" /></label>
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!creatorDraft.title.trim()} onClick={createCreatorPick}>Add creator pick</button></div>
                  </>}

                  {addFlow === "activities" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Activity</h4><button onClick={() => setAddingAfter(null)}>Cancel</button></div>
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="Search Tokyo activities" /></label>
                    <h5>Recommended for Tokyo</h5>
                    <div className="activity-results">
                      {recommendedActivities.map((activity) => <button key={activity.title} onClick={() => addRecommendedActivity(activity.title, activity.meta, activity.price)}><span className="result-plus">+</span><strong>{activity.title}</strong><small>{activity.meta}</small><b>{activity.price}</b></button>)}
                      {recommendedActivities.length === 0 && <p>No activities found. Try another search or create your own.</p>}
                    </div>
                    <button className="create-activity-link" onClick={() => setAddFlow("create")}><Icon name="plus" size={16} /> Create new activity</button>
                  </>}

                  {addFlow === "create" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => setAddFlow("activities")} aria-label="Back to activities">‹</button><h4>Create new activity</h4><button onClick={() => setAddingAfter(null)}>Cancel</button></div>
                    <div className="activity-form">
                      <label className="full"><span>Activity</span><input value={activityDraft.title} onChange={(event) => setActivityDraft({ ...activityDraft, title: event.target.value })} /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={activityDraft.price} onChange={(event) => setActivityDraft({ ...activityDraft, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="full"><span>Address</span><input value={activityDraft.address} onChange={(event) => setActivityDraft({ ...activityDraft, address: event.target.value })} /></label>
                      <label><span>Start time</span><input type="time" value={activityDraft.startTime} onChange={(event) => setActivityDraft({ ...activityDraft, startTime: event.target.value })} /></label>
                      <label><span>Duration (min)</span><select value={activityDraft.duration} onChange={(event) => setActivityDraft({ ...activityDraft, duration: event.target.value })}>{DURATION_OPTIONS.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
                      <label><span>Ends at</span><input value={getEndTime(activityDraft.startTime, activityDraft.duration)} readOnly /></label>
                      <label className="full"><span>Notes</span><textarea value={activityDraft.notes} onChange={(event) => setActivityDraft({ ...activityDraft, notes: event.target.value })} placeholder="Share why this is worth a stop" /></label>
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!activityDraft.title.trim()} onClick={createActivity}>Add activity</button></div>
                  </>}
                </section> : <button className="timeline-add" onClick={() => openAddFlow(index)}><Icon name="plus" size={14} /> Add stop</button>}
              </div>)}
            </div>
          </section>
        </div>

        <aside className="editor-sidebar">
          <Panel title="Package quality" className="quality-panel">
            <div className="quality-score"><strong>{displayScore !== undefined ? displayScore : "(-)"}</strong><span>/100</span></div>
            <div className="score-track" role="meter" aria-label={displayScore !== undefined ? `Package quality score, ${displayScore} out of 100. Minimum score to publish is 70.` : "Package quality score not yet checked. Minimum score to publish is 70."} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayScore ?? 0}>
              <span className="score-fill" style={{ width: displayScore !== undefined ? `${Math.min(100, Math.max(0, displayScore))}%` : "0%" }} />
              <i aria-hidden="true" />
              <span className="score-threshold" aria-label="Minimum publish score is 70"><small>Minimum publish score:</small><strong>70</strong></span>
            </div>
            <div className="quality-meta">
              <button
                className="quiet-button check-content-button"
                onClick={runFeasibilityCheck}
                disabled={feasLoading}
              >
                {feasLoading ? "Checking..." : "Check content"}
              </button>
              {isReadyToPublish ? (
                <strong><Icon name="check" size={14} />Ready to publish</strong>
              ) : (
                <strong className="warning">
                  <Icon name="alert" size={14} />
                  {!feasResult
                    ? "Please check content"
                    : hardErrors.length > 0
                      ? "Fix critical issues"
                      : "Score below 70"}
                </strong>
              )}
            </div>
          </Panel>
          <Panel title="Feasibility status" className="status-panel">
            <StatusToggle tone="critical" count={hardErrors.length} label="Critical issues" expanded={expandedFeasibility === "critical"} onClick={() => setExpandedFeasibility(expandedFeasibility === "critical" ? null : "critical")} />
            {expandedFeasibility === "critical" && <div className="status-details">
              {hardErrors.map((err, idx) => (
                <article key={idx}>
                  <span className="critical-icon"><Icon name="alert" size={16} /></span>
                  <div>
                    <strong>{err.affected_item}</strong>
                    <p>{err.message}</p>
                    <small>Fix: {err.action}</small>
                  </div>
                </article>
              ))}
              {hardErrors.length === 0 && <p style={{ padding: "8px", fontSize: "0.85rem", color: "#16a34a" }}>No critical issues detected.</p>}
            </div>}
            <StatusToggle tone="warning" count={softWarnings.length} label="Suggestions" expanded={expandedFeasibility === "suggestions"} onClick={() => setExpandedFeasibility(expandedFeasibility === "suggestions" ? null : "suggestions")} />
            {expandedFeasibility === "suggestions" && <div className="status-details suggestions-details">
              {softWarnings.map((warn, idx) => (
                <article key={idx}>
                  <span className="warning-icon"><Icon name="alert" size={16} /></span>
                  <div>
                    <strong>{warn.affected_item}</strong>
                    <p>{warn.message}</p>
                    <small>Fix: {warn.action}</small>
                  </div>
                </article>
              ))}
              {softWarnings.length === 0 && <p style={{ padding: "8px", fontSize: "0.85rem", color: "#6b7280" }}>No suggestions.</p>}
            </div>}
            <StatusToggle tone="pass" label="Passed" expanded={expandedFeasibility === "passed"} onClick={() => setExpandedFeasibility(expandedFeasibility === "passed" ? null : "passed")} />
            {expandedFeasibility === "passed" && <ul className="passed-details"><li><Icon name="check" size={15} />Daily schedule has a clear start and end</li><li><Icon name="check" size={15} />All stops have pricing</li><li><Icon name="check" size={15} />Accommodation is included</li><li><Icon name="check" size={15} />Required package photos are uploaded</li></ul>}
          </Panel>
          <Panel title="Pricing & earnings" className="pricing-panel"><span>Total package price</span><strong>${packagePrice.toLocaleString()}</strong><hr /><span>Your commission (20%)</span><strong className="commission">${Math.round(packagePrice * .2).toLocaleString()}</strong><small>Est. 5–8 bookings/month</small><button onClick={() => { const next = window.prompt("Set total package price", String(packagePrice)); if (next && Number(next) > 0) setPackagePrice(Number(next)); }}>Adjust pricing</button></Panel>
          <Panel title="Route map" className="route-panel"><RouteMap /></Panel>
          <Panel title="Hotel tiers" className="hotel-panel">{[{ name: "Shibuya Excel Hotel Tokyu", meta: "Standard · $720 total" }, { name: "Park Hyatt Tokyo", meta: "Premium · $1,680 total" }, { name: "9h Capsule Hotel", meta: "Budget · $270 total" }].map((hotel) => <button key={hotel.name} aria-pressed={selectedHotel === hotel.name} className={selectedHotel === hotel.name ? "selected" : ""} onClick={() => setSelectedHotel(hotel.name)}><strong>{hotel.name}</strong><span>{hotel.meta}</span></button>)}<button className="add-tier" onClick={() => showNotice("Hotel tier editor opened")}><Icon name="plus" size={14} /> Add tier</button></Panel>
        </aside>
      </div>
      {notice && <div className="editor-toast" role="status">{notice}</div>}
      {pendingDeleteDay !== null && <div className="delete-day-backdrop" role="presentation" onMouseDown={() => setPendingDeleteDay(null)}>
        <section className="delete-day-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-day-title" aria-describedby="delete-day-description" onMouseDown={(event) => event.stopPropagation()}>
          <h2 id="delete-day-title">Delete Day {pendingDeleteDay + 1}?</h2>
          <p id="delete-day-description"><strong>{days[pendingDeleteDay]?.title}</strong> and every item in this day will be removed. This cannot be undone.</p>
          <div className="delete-day-actions">
            <button className="quiet-button" autoFocus onClick={() => setPendingDeleteDay(null)}>Cancel</button>
            <button className="confirm-delete-button" onClick={() => { const dayToDelete = pendingDeleteDay; setPendingDeleteDay(null); deleteDay(dayToDelete); }}>Delete day</button>
          </div>
        </section>
      </div>}
      {previewOpen && <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><button className="preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button><span>Traveller preview</span><h2 id="preview-title">{packageTitle}</h2><p>{story || "Your itinerary story will appear here. Add a personal introduction before publishing."}</p><div><strong>{days.length} days / 2 nights</strong><strong>${packagePrice.toLocaleString()}</strong></div><button className="publish-button" disabled={!isReadyToPublish || feasLoading} onClick={() => { setPreviewOpen(false); setPublished(true); showNotice("Package ready to publish"); }}>{!isReadyToPublish ? (feasResult && !feasResult.is_feasible ? "Fix issues to publish" : "Check content to publish") : "Continue to publish"}</button></section></div>}
    </main>
  );
}