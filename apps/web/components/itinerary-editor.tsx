"use client";

import { useEffect, useRef, useState } from "react";
import RouteMap from "./route-map";

type IconName = "plane" | "star" | "hotel" | "plus" | "alert" | "check" | "clock" | "chevron";

type TimelineItem = {
  id: number;
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

const INITIAL_DAYS = [
  { day: 1, count: 5, title: "Arrival & Shibuya Evening", meta: "Story · 3 photos" },
  { day: 2, count: 3, title: "Traditional Tokyo", meta: "Culture · 4 stops" },
  { day: 3, count: 1, title: "Mt. Fuji Day Trip", meta: "Nature · Full day" },
];

const INITIAL_ITEMS: TimelineItem[] = [
  { id: 1, time: "14:30", type: "FLIGHT", title: "International arrival at Tokyo Narita", price: "$850", icon: "plane" as IconName, problem: "Transfer time is too short", problemDetail: "10 min available · 75 min needed", status: "critical" },
  { id: 2, time: "14:40", type: "ACTIVITY", title: "Shibuya Crossing Quick Visit", price: "$180", icon: "star" as IconName, problem: "Overlaps airport transfer", problemDetail: "Starts 10 min after arrival", status: "critical", category: "Activity", address: "Shibuya Crossing, Tokyo", duration: "30", notes: "See the crossing from street level, then head upstairs for the city view.", photo: "https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=240&h=180&fit=crop" },
  { id: 3, time: "17:30", type: "ACTIVITY", title: "Tokyo Tower Observatory visit", price: "$20", icon: "star" as IconName, problem: undefined, problemDetail: undefined, status: "pass", category: "Attraction", address: "4 Chome-2-8 Shibakoen, Minato City, Tokyo", duration: "90", notes: "Arrive before sunset for daytime and evening views." },
  { id: 4, time: "19:30", type: "HOTEL", title: "Shibuya Excel Hotel Tokyu (2 nights)", price: "$720", icon: "hotel" as IconName, problem: undefined, problemDetail: undefined, status: "pass" },
];

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

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`editor-panel ${className}`}><h2>{title}</h2>{children}</section>;
}

function StatusToggle({ tone, count, label, expanded, onClick }: { tone: "critical" | "warning" | "pass"; count: number; label: string; expanded: boolean; onClick: () => void }) {
  return <button className="status-toggle" aria-expanded={expanded} onClick={onClick}><span className={`${tone}-icon`}><Icon name={tone === "pass" ? "check" : "alert"} size={16} /></span><strong>{count}</strong><span>{label}</span><span className="status-chevron"><Icon name="chevron" size={17} /></span></button>;
}

export default function ItineraryEditor({ onBack }: { onBack: () => void }) {
  const nextItemId = useRef(1000);
  const [packageTitle, setPackageTitle] = useState("Tokyo Food & Culture Experience");
  const [titleDraft, setTitleDraft] = useState("Tokyo Food & Culture Experience");
  const [editingTitle, setEditingTitle] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [days, setDays] = useState(INITIAL_DAYS);
  const [story, setStory] = useState("");
  const [items, setItems] = useState(INITIAL_ITEMS);
  const [saved, setSaved] = useState(false);
  const [published, setPublished] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedHotel, setSelectedHotel] = useState("Shibuya Excel Hotel Tokyu");
  const [packagePrice, setPackagePrice] = useState(1928);
  const [photos, setPhotos] = useState([
    { src: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=720&h=720&fit=crop", alt: "Shibuya crossing at night" },
    { src: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=720&h=720&fit=crop", alt: "A bowl of Tokyo ramen" },
    { src: "https://images.unsplash.com/photo-1532236204992-f5e85c024202?w=720&h=720&fit=crop", alt: "Tokyo Tower illuminated at dusk" },
  ]);
  const [notice, setNotice] = useState("");
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
  const [hotelDraft, setHotelDraft] = useState({ name: "", address: "", checkIn: "15:00", checkOut: "11:00", room: "Standard room", price: "", notes: "" });
  const [creatorDraft, setCreatorDraft] = useState({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });

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
    setItems((current) => current.map((item) => item.id === editingItem.id ? {
      ...item,
      title: editingItem.title.trim(),
      time: editingItem.time,
      price: editingItem.price ? `$${editingItem.price}` : "$0",
      category: editingItem.category,
      address: editingItem.address.trim(),
      duration: editingItem.duration,
      notes: editingItem.notes.trim(),
      photo: editingItem.photo,
    } : item));
    setEditingItem(null);
    showNotice("Stop updated");
  };

  const insertItem = (after: number, item: Omit<TimelineItem, "id">) => {
    const next = [...items];
    nextItemId.current += 1;
    next.splice(after + 1, 0, { ...item, id: nextItemId.current });
    setItems(next);
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
    setItems(next);
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
    setItems(next);
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

  const createHotel = () => {
    if (addingAfter === null || !hotelDraft.name.trim()) return;
    insertItem(addingAfter, {
      time: hotelDraft.checkIn,
      type: "HOTEL",
      title: hotelDraft.name.trim(),
      price: hotelDraft.price.trim() ? `$${hotelDraft.price.trim()}` : "$0",
      icon: "hotel",
      status: "pass",
    });
    setHotelDraft({ name: "", address: "", checkIn: "15:00", checkOut: "11:00", room: "Standard room", price: "", notes: "" });
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

  return (
    <main className="itinerary-editor">
      <header className="editor-topbar">
        <button className="text-action back-action" onClick={onBack} aria-label="Edit destination, travel style, duration, or season"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> Edit trip setup</button>
        <div className="editor-title-block"><span className="editor-kicker">AI itinerary editor</span>{editingTitle ? <input className="package-title-input" value={titleDraft} autoFocus maxLength={200} aria-label="Package title" onChange={(event) => setTitleDraft(event.target.value)} onBlur={savePackageTitle} onKeyDown={(event) => { if (event.key === "Enter") savePackageTitle(); if (event.key === "Escape") { setTitleDraft(packageTitle); setEditingTitle(false); } }} /> : <button className="package-title-button" onClick={() => { setTitleDraft(packageTitle); setEditingTitle(true); }} aria-label={`Edit package title, currently ${packageTitle}`} title="Edit package title"><h1>{packageTitle}</h1></button>}</div>
        <div className="editor-actions">
          <button className="quiet-button" onClick={() => { setSaved(true); showNotice("Draft saved"); }}>{saved ? "Saved" : "Save Draft"}</button>
          <button className="quiet-button" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button className="publish-button" onClick={() => { setPublished(true); showNotice("Package ready to publish"); }}>{published ? "Ready to publish" : "Continue to publish"}</button>
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
              {photos.map((photo) => <img key={photo.src} src={photo.src} alt={photo.alt} />)}
              <label className="photo-add"><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setPhotos([...photos, { src: URL.createObjectURL(file), alt: file.name }]); showNotice("Photo uploaded"); }} /><Icon name="plus" size={30} /><span>Add photo</span><small>JPG or PNG</small></label>
            </div>
          </section>

          <section className="story-copy">
            <div className="section-label"><h3>Your story</h3><button className="ai-button" onClick={() => setStory("Start in the electric heart of Tokyo, then slow down over a steaming bowl of ramen before watching the city glow from Tokyo Tower.")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></svg> AI write for me</button></div>
            <textarea value={story} onChange={(event) => setStory(event.target.value)} placeholder="Share your insider tips and personal recommendations…" aria-label="Your story" />
          </section>

          <section className="timeline-section">
            <h3>Timeline</h3>
            <div className="timeline-list">
              {items.map((item, index) => <div key={item.id} className={`timeline-group ${addingAfter === index ? "adding" : ""} ${dropTarget?.index === index ? `drop-${dropTarget.position}` : ""}`} onDragOver={(event) => { event.preventDefault(); if (draggedItemId === item.id) return; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ index, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" }); }} onDrop={(event) => { event.preventDefault(); dropItem(); endDrag(); }}>
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
                    <label><span>Ends at</span><input value={getEndTime(editingItem.time, editingItem.duration)} readOnly /></label>
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
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={flightSearch} onChange={(event) => setFlightSearch(event.target.value)} placeholder="Search by airport, airline, or flight number" /></label>
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
                    <div className="activity-form">
                      <label className="full"><span>Hotel name</span><input value={hotelDraft.name} onChange={(event) => setHotelDraft({ ...hotelDraft, name: event.target.value })} placeholder="Shibuya Excel Hotel Tokyu" /></label>
                      <label className="full"><span>Address</span><input value={hotelDraft.address} onChange={(event) => setHotelDraft({ ...hotelDraft, address: event.target.value })} /></label>
                      <label><span>Check-in</span><input type="time" value={hotelDraft.checkIn} onChange={(event) => setHotelDraft({ ...hotelDraft, checkIn: event.target.value })} /></label>
                      <label><span>Check-out</span><input type="time" value={hotelDraft.checkOut} onChange={(event) => setHotelDraft({ ...hotelDraft, checkOut: event.target.value })} /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={hotelDraft.price} onChange={(event) => setHotelDraft({ ...hotelDraft, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="full"><span>Room type</span><select value={hotelDraft.room} onChange={(event) => setHotelDraft({ ...hotelDraft, room: event.target.value })}><option>Standard room</option><option>Deluxe room</option><option>Suite</option><option>Shared room</option></select></label>
                      <label className="full"><span>Notes</span><textarea value={hotelDraft.notes} onChange={(event) => setHotelDraft({ ...hotelDraft, notes: event.target.value })} placeholder="Add check-in or booking details" /></label>
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!hotelDraft.name.trim()} onClick={createHotel}>Add hotel</button></div>
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
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="Search Tokyo activities" /></label>
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
            <div className="quality-score"><strong>78</strong><span>/100</span></div>
            <div className="score-track" role="meter" aria-label="Package quality score, 78 out of 100. Minimum score to publish is 70." aria-valuemin={0} aria-valuemax={100} aria-valuenow={78}>
              <span className="score-fill" />
              <i aria-hidden="true" />
              <span className="score-threshold" aria-label="Minimum publish score is 70"><small>Minimum publish score:</small><strong>70</strong></span>
            </div>
            <div className="quality-meta"><strong><Icon name="check" size={14} />Ready to publish</strong></div>
          </Panel>
          <Panel title="Feasibility status" className="status-panel">
            <StatusToggle tone="critical" count={2} label="Critical issues" expanded={expandedFeasibility === "critical"} onClick={() => setExpandedFeasibility(expandedFeasibility === "critical" ? null : "critical")} />
            {expandedFeasibility === "critical" && <div className="status-details">
              <article><span className="critical-icon"><Icon name="alert" size={16} /></span><div><strong>Transfer time is too short</strong><p>Only 10 minutes between arrival and Shibuya Crossing. Allow at least 75 minutes.</p><button onClick={() => showNotice("Flight and activity highlighted")}>View affected stops</button></div></article>
              <article><span className="critical-icon"><Icon name="alert" size={16} /></span><div><strong>Hotel check-in conflict</strong><p>Check-in overlaps with the evening activity.</p><button onClick={() => showNotice("Hotel timing highlighted")}>View affected stops</button></div></article>
            </div>}
            <StatusToggle tone="warning" count={2} label="Suggestions" expanded={expandedFeasibility === "suggestions"} onClick={() => setExpandedFeasibility(expandedFeasibility === "suggestions" ? null : "suggestions")} />
            {expandedFeasibility === "suggestions" && <div className="status-details suggestions-details">
              <article><span className="warning-icon"><Icon name="alert" size={16} /></span><div><strong>Busy afternoon</strong><p>Eight stops may feel rushed. Consider moving one activity to Day 2.</p></div></article>
              <article><span className="warning-icon"><Icon name="alert" size={16} /></span><div><strong>Long gap before dinner</strong><p>There is an open window after Tokyo Tower that could include travel or a short break.</p></div></article>
            </div>}
            <StatusToggle tone="pass" count={4} label="Passed" expanded={expandedFeasibility === "passed"} onClick={() => setExpandedFeasibility(expandedFeasibility === "passed" ? null : "passed")} />
            {expandedFeasibility === "passed" && <ul className="passed-details"><li><Icon name="check" size={15} />Daily schedule has a clear start and end</li><li><Icon name="check" size={15} />All stops have pricing</li><li><Icon name="check" size={15} />Accommodation is included</li><li><Icon name="check" size={15} />Required package photos are uploaded</li></ul>}
          </Panel>
          <Panel title="Pricing & earnings" className="pricing-panel"><span>Total package price</span><strong>${packagePrice.toLocaleString()}</strong><hr/><span>Your commission (20%)</span><strong className="commission">${Math.round(packagePrice * .2).toLocaleString()}</strong><small>Est. 5–8 bookings/month</small><button onClick={() => { const next = window.prompt("Set total package price", String(packagePrice)); if (next && Number(next) > 0) setPackagePrice(Number(next)); }}>Adjust pricing</button></Panel>
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
      {previewOpen && <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><button className="preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button><span>Traveller preview</span><h2 id="preview-title">{packageTitle}</h2><p>{story || "Your itinerary story will appear here. Add a personal introduction before publishing."}</p><div><strong>{days.length} days / 2 nights</strong><strong>${packagePrice.toLocaleString()}</strong></div><button className="publish-button" onClick={() => { setPreviewOpen(false); setPublished(true); showNotice("Package ready to publish"); }}>Continue to publish</button></section></div>}
    </main>
  );
}
