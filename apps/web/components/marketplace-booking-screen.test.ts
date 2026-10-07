import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the front-end demo completion screen keeps the booking summary visible", async () => {
  const bookingScreen = await import("./marketplace-booking-screen");
  const Confirmation = (bookingScreen as Record<string, unknown>).BookingRequestConfirmation;

  assert.equal(typeof Confirmation, "function");
  if (typeof Confirmation !== "function") return;

  const html = renderToStaticMarkup(createElement(Confirmation as ComponentType<Record<string, unknown>>, {
    title: "Paris Long Weekend, Done Right",
    destination: "Paris, France",
    departure: "3 Apr 2027",
    returnDate: "6 Apr 2027",
    travelers: 2,
    outbound: "Korean Air KE188",
    returnFlight: "Korean Air KE187",
    hotel: "Marriott Paris",
    total: "$4,510",
    onBack: () => undefined,
  }));

  assert.match(html, /Booking request complete/);
  assert.match(html, /Paris Long Weekend, Done Right/);
  assert.match(html, /3 Apr 2027/);
  assert.match(html, /Korean Air KE188/);
  assert.match(html, /Marriott Paris/);
  assert.match(html, /\$4,510/);
  assert.match(html, /demo/i);
});

test("booking choices stay collapsed until the traveler asks to change them", async () => {
  const bookingScreen = await import("./marketplace-booking-screen");
  const Summary = (bookingScreen as Record<string, unknown>).BookingSelectionSummary;

  assert.equal(typeof Summary, "function");
  if (typeof Summary !== "function") return;

  const baseProps = {
    title: "Flights",
    actionLabel: "Change flight",
    onToggle: () => undefined,
    rows: [{ label: "Outbound", title: "Korean Air KE188", meta: "3 Apr 2027 · Economy", price: "$991" }],
    children: createElement("p", null, "Alternative flight"),
  };
  const Component = Summary as ComponentType<Record<string, unknown>>;
  const collapsed = renderToStaticMarkup(createElement(Component, { ...baseProps, open: false }));
  const expanded = renderToStaticMarkup(createElement(Component, { ...baseProps, open: true }));

  assert.match(collapsed, /Korean Air KE188/);
  assert.match(collapsed, /Change flight/);
  assert.doesNotMatch(collapsed, /Alternative flight/);
  assert.match(expanded, /Alternative flight/);
  assert.match(expanded, />Done</);
});
