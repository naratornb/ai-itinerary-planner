"use client";

import { useEffect, useMemo, useState } from "react";

import Icon from "./icon";
import {
  computePackagePrice,
  buildDaysFromPackage,
  formatMinutes,
  summarizeDay,
  summarizePackageComponents,
} from "../lib/itinerary-builder";
import {
  deletePackageMedia,
  listPackageMedia,
  submitPackage,
  updatePackage,
  uploadPackageMedia,
  SubmitPackageError,
  type CreatorPackageDetail,
  type PackageMedia,
} from "../lib/creator-api";
import {
  itinerarySnapshotStorageKey,
  parseItinerarySnapshot,
  parseReviewDraft,
  parseWizardVibesDraft,
  reviewDraftStorageKey,
  wizardVibesStorageKey,
  type ReviewDraft,
} from "../lib/review-draft";
import { supabase } from "../lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type SubmitResult = { kind: "success" | "error"; message: string; code?: string };

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function ItineraryReview({
  pkg,
  onBackToEditor,
  onBackToDashboard,
}: {
  pkg: CreatorPackageDetail;
  onBackToEditor: () => void;
  onBackToDashboard: () => void;
}) {
  // Flights/hotels/activities added in the editor this session aren't saved
  // by PUT yet (see itinerary-editor.tsx's saveDraft), so this prefers the
  // snapshot the editor wrote right before navigating here over a fresh —
  // and possibly stale — fetch. Falls back to the fetched package for a
  // direct visit (e.g. a reload, or a link from elsewhere).
  const [{ days, packageTitle }] = useState(() => {
    if (typeof window !== "undefined") {
      const snapshot = parseItinerarySnapshot(window.sessionStorage.getItem(itinerarySnapshotStorageKey(pkg.package_id)));
      if (snapshot) return { days: snapshot.days, packageTitle: snapshot.title };
    }
    return { days: buildDaysFromPackage(pkg), packageTitle: pkg.title };
  });
  const [vibesDraft] = useState(() => (
    typeof window === "undefined"
      ? null
      : parseWizardVibesDraft(window.sessionStorage.getItem(wizardVibesStorageKey(pkg.package_id)))
  ));
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>(() => {
    // A stored draft means the user already started editing this session —
    // resume it exactly, even if they cleared the description to empty.
    // With nothing stored yet, seed from the package's real saved
    // description instead of blanking it out from under them.
    const stored = typeof window === "undefined" ? null : window.sessionStorage.getItem(reviewDraftStorageKey(pkg.package_id));
    if (stored) return parseReviewDraft(stored);
    return { description: pkg.description ?? "", coverMediaId: null };
  });
  const [photos, setPhotos] = useState<PackageMedia[]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set(days[0] ? [days[0].id] : []));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const packagePrice = useMemo(() => computePackagePrice(days), [days]);
  const componentCounts = useMemo(() => summarizePackageComponents(days), [days]);
  const nights = Math.max(0, days.length - 1);
  const destination = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ") || "Not set";
  // A client-side pick wins if made; otherwise defer to the backend's own
  // is_cover flag (real for uploads made with it set — see addCoverPhoto),
  // then fall back to just showing the first photo as cover.
  const backendCoverId = photos.find((photo) => photo.is_cover)?.media_id ?? null;
  const coverMediaId = reviewDraft.coverMediaId ?? backendCoverId ?? photos[0]?.media_id ?? null;

  // Persisted client-side only: PUT /packages/{id} doesn't accept description
  // or a cover reference yet (see the Sept 2026 save/submit handover) — this
  // is what lets a trip to the editor and back resume exactly where it left off.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(reviewDraftStorageKey(pkg.package_id), JSON.stringify(reviewDraft));
    } catch {
      // best-effort only
    }
  }, [pkg.package_id, reviewDraft]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) return;
      try {
        const media = await listPackageMedia(fetch, API_URL, token, pkg.package_id);
        if (!cancelled) setPhotos(media);
      } catch {
        // A photo list that won't load isn't worth blocking review over.
      }
    })();
    return () => { cancelled = true; };
  }, [pkg.package_id]);

  const accessToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  };

  const toggleDay = (dayId: string) => {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(dayId)) next.delete(dayId); else next.add(dayId);
      return next;
    });
  };

  const saveDraft = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      await updatePackage(fetch, API_URL, token, pkg.package_id, {
        title: packageTitle,
        description: reviewDraft.description,
        base_price_aud: Math.round(packagePrice),
        days: days.map((day, index) => ({
          day_number: index + 1,
          title: day.title === `Day ${index + 1}` ? null : day.title || null,
          summary: day.story || null,
        })),
      });
      showNotice("Draft saved");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to save this draft.");
    } finally {
      setSaving(false);
    }
  };

  const generateDescription = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const activityNames = days
        .flatMap((day) => day.items)
        .filter((item) => item.type !== "FLIGHT" && item.type !== "HOTEL")
        .map((item) => (item.notes ? `${item.title} (${item.notes})` : item.title));

      const response = await fetch("/api/ai/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "package",
          packageTitle,
          destination,
          selectedHotel: pkg.hotels[0]?.hotel_name ?? "",
          totalDays: days.length,
          items: activityNames,
          vibe: vibesDraft?.vibes.join(", ") ?? "",
        }),
      });
      const data = (await response.json()) as { listing?: string; error?: string };
      if (data.listing) {
        setReviewDraft((current) => ({ ...current, description: data.listing! }));
        showNotice("Description generated");
      } else {
        showNotice(data.error || "The description generator returned nothing.");
      }
    } catch {
      showNotice("Failed to connect to the description generator.");
    } finally {
      setGenerating(false);
    }
  };

  const toSafeImageSrc = (value: string) => {
    try {
      const url = new URL(value, window.location.origin);
      return ["https:", "http:", "blob:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };

  const addCoverPhoto = async (file: File) => {
    // Only the very first photo defaults to cover on upload — once a cover
    // exists (client-picked or the backend's own is_cover flag), a later
    // upload shouldn't silently steal it.
    const isFirstCover = coverMediaId === null;
    const preview = URL.createObjectURL(file);
    const tempId = `pending-${preview}`;
    setPhotos((current) => [...current, { media_id: tempId, package_id: pkg.package_id, media_type: "image", url: preview, caption: file.name, is_cover: isFirstCover }]);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const uploaded = await uploadPackageMedia(fetch, API_URL, token, pkg.package_id, file, isFirstCover);
      setPhotos((current) => current.map((photo) => (photo.media_id === tempId ? uploaded : photo)));
      showNotice("Photo uploaded");
    } catch (error) {
      setPhotos((current) => current.filter((photo) => photo.media_id !== tempId));
      showNotice(error instanceof Error ? error.message : "Unable to upload this photo.");
    } finally {
      URL.revokeObjectURL(preview);
    }
  };

  const removePhoto = async (photo: PackageMedia) => {
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      await deletePackageMedia(fetch, API_URL, token, photo.media_id);
      setPhotos((current) => current.filter((entry) => entry.media_id !== photo.media_id));
      if (coverMediaId === photo.media_id) setReviewDraft((current) => ({ ...current, coverMediaId: null }));
      showNotice("Photo removed");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to remove this photo.");
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const result = await submitPackage(fetch, API_URL, token, pkg.package_id);
      setSubmitResult({ kind: "success", message: `This package's status is now "${result.status}". An admin will review it next.` });
    } catch (error) {
      if (error instanceof SubmitPackageError) {
        setSubmitResult({ kind: "error", message: error.message, code: error.code ?? String(error.status) });
      } else {
        setSubmitResult({ kind: "error", message: error instanceof Error ? error.message : "Please try again later." });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="itinerary-review">
      <header className="editor-topbar">
        <button className="text-action back-action" onClick={onBackToEditor} aria-label="Back to editor"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> Back to editor</button>
        <div className="editor-title-block"><span className="editor-kicker">Finalise & review</span><h1>Finalise your package</h1></div>
        <div className="editor-actions">
          <button className="quiet-button" disabled={saving} onClick={() => { void saveDraft(); }}>{saving ? "Saving…" : "Save Draft"}</button>
          <button className="quiet-button" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button className="publish-button" disabled={submitting} onClick={() => { void handleSubmit(); }}>{submitting ? "Submitting…" : "Submit for Review"}</button>
        </div>
      </header>

      <div className="review-shell">
        <section className="editor-panel">
          <h2>Package title</h2>
          <div className="review-panel-body"><h1 className="review-package-title">{packageTitle}</h1></div>
        </section>

        <section className="editor-panel">
          <h2>Package summary</h2>
          <dl className="stat-grid review-panel-body">
            <div><dt>Destination</dt><dd>{destination}</dd></div>
            <div><dt>Duration</dt><dd>{days.length} Day{days.length === 1 ? "" : "s"} / {nights} Night{nights === 1 ? "" : "s"}</dd></div>
            <div><dt>Vibes</dt><dd>{vibesDraft?.vibes.length ? vibesDraft.vibes.join(", ") : "Not set"}</dd></div>
            <div><dt>Season</dt><dd>{vibesDraft?.season ? capitalize(vibesDraft.season) : "Not set"}</dd></div>
            <div><dt>Flights</dt><dd>{componentCounts.flightCount}</dd></div>
            <div><dt>Hotels</dt><dd>{componentCounts.hotelCount}</dd></div>
            <div><dt>Activities</dt><dd>{componentCounts.activityCount}</dd></div>
          </dl>
        </section>

        <section className="editor-panel">
          <h2>Select cover image</h2>
          <div className="review-panel-body">
            <div className="cover-gallery">
              {photos.map((photo) => {
                const isCover = photo.media_id === coverMediaId;
                return (
                  <figure key={photo.media_id} className={`cover-gallery-item${isCover ? " is-cover" : ""}`}>
                    <button
                      type="button"
                      className="cover-gallery-select"
                      aria-pressed={isCover}
                      onClick={() => setReviewDraft((current) => ({ ...current, coverMediaId: photo.media_id }))}
                      aria-label={isCover ? `${photo.caption ?? "This photo"} is the cover image` : `Set ${photo.caption ?? "this photo"} as the cover image`}
                    >
                      <img src={toSafeImageSrc(photo.url)} alt={photo.caption ?? "Package photo"} />
                    </button>
                    {isCover && <span className="cover-gallery-badge"><Icon name="star" size={11} /> Cover</span>}
                    <button type="button" className="cover-gallery-remove" aria-label={`Remove ${photo.caption ?? "photo"}`} onClick={() => { void removePhoto(photo); }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </figure>
                );
              })}
              <label className="cover-gallery-add">
                <input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void addCoverPhoto(file); }} />
                <Icon name="plus" size={22} />
                <span>Add photo</span>
                <small>JPG or PNG</small>
              </label>
            </div>
            <p className="review-photo-hint">{photos.length} photo{photos.length === 1 ? "" : "s"} available</p>
          </div>
        </section>

        <section className="editor-panel">
          <h2>Description</h2>
          <div className="review-description-panel">
            <div className="review-description-header">
              <h3>Package description</h3>
              <button className="ai-button" disabled={generating} aria-label="Generate description with AI" onClick={() => { void generateDescription(); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></svg> {generating ? "Generating…" : "Generate with AI"}</button>
            </div>
            <textarea value={reviewDraft.description} onChange={(event) => setReviewDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Describe this package for travellers…" aria-label="Package description" />
          </div>
        </section>

        <section className="editor-panel">
          <h2>Day-by-day itinerary</h2>
          <div className="review-day-list">
            {days.map((day, index) => {
              const summary = summarizeDay(day);
              const isOpen = expandedDays.has(day.id);
              return (
                <div className={`review-day-card${isOpen ? " open" : ""}`} key={day.id}>
                  <button type="button" className="review-day-summary" aria-expanded={isOpen} onClick={() => toggleDay(day.id)}>
                    <span className="review-day-index">Day {index + 1}</span>
                    <span className="review-day-title">{day.title || `Day ${index + 1}`}</span>
                    <span className="review-day-chips">
                      {summary.flightMinutes > 0 && <span className="review-day-chip"><Icon name="plane" size={13} /> {formatMinutes(summary.flightMinutes)}</span>}
                      <span className="review-day-chip"><Icon name="star" size={13} /> {summary.activityCount} {summary.activityCount === 1 ? "activity" : "activities"}</span>
                      {summary.hotelName && <span className="review-day-chip"><Icon name="hotel" size={13} /> {summary.hotelName}</span>}
                    </span>
                    <span className="review-day-chevron"><Icon name="chevron" size={16} /></span>
                  </button>
                  {isOpen && (
                    <div className="review-day-body">
                      {day.items.length === 0
                        ? <p className="review-empty-day">No items on this day yet.</p>
                        : day.items.map((item) => {
                          const isTimeValue = /^\d{1,2}:\d{2}/.test(item.time);
                          const isPriceValue = item.price.startsWith("$");
                          return (
                            <div className="review-item-row" key={item.id}>
                              <div className="item-time"><Icon name={item.icon} /><strong className={isTimeValue ? undefined : "item-time-word"}>{item.time}</strong></div>
                              <div className="item-copy">
                                <div className="item-copy-head"><span>{item.type}</span></div>
                                <h4>{item.title}</h4>
                                {item.duration && <small className="review-item-duration">{formatMinutes(Number(item.duration))}</small>}
                              </div>
                              <div className="item-price"><span>Price</span><strong className={isPriceValue ? undefined : "item-price-word"}>{item.price || "—"}</strong></div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <p className="review-edit-hint">Need to change flights, hotels, activities, or days? <button type="button" className="text-action" onClick={onBackToEditor}>Go back to the editor</button>.</p>
      </div>

      {previewOpen && (
        <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
          <section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            <span>Traveller preview</span>
            <h2 id="preview-title">{packageTitle}</h2>
            <p>{reviewDraft.description || "Your package description will appear here. Add one before submitting."}</p>
            <div><strong>{days.length} days / {nights} nights</strong><strong>${packagePrice.toLocaleString()}</strong></div>
          </section>
        </div>
      )}

      {submitResult && (
        <div className="preview-backdrop" role="presentation" onMouseDown={() => setSubmitResult(null)}>
          <section className={`preview-dialog result-dialog result-${submitResult.kind}`} role="dialog" aria-modal="true" aria-labelledby="submit-result-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="preview-close" onClick={() => setSubmitResult(null)} aria-label="Close"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            <span>{submitResult.kind === "success" ? "Submitted" : "Submission failed"}</span>
            <h2 id="submit-result-title">{submitResult.kind === "success" ? "Sent for review" : "Something went wrong"}</h2>
            <p>{submitResult.message}{submitResult.code ? ` (Error ${submitResult.code})` : ""}</p>
            <div className="result-actions">
              {submitResult.kind === "success"
                ? <>
                  <button className="quiet-button" onClick={() => { setSubmitResult(null); setPreviewOpen(true); }}>View preview</button>
                  <button className="publish-button" onClick={onBackToDashboard}>Back to dashboard</button>
                </>
                : <button className="publish-button" onClick={() => setSubmitResult(null)}>Try again later</button>}
            </div>
          </section>
        </div>
      )}

      {notice && <div className="editor-toast" role="status">{notice}</div>}
    </main>
  );
}
