import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the completion screen keeps the booking summary visible without demo labels", async () => {
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
  assert.doesNotMatch(html, /front-end demo|this demo/i);
  assert.match(html, /Review the details below/);
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

test("hotel details show catalog facts without inventing unavailable content", async () => {
  const bookingScreen = await import("./marketplace-booking-screen");
  const Drawer = (bookingScreen as Record<string, unknown>).HotelDetailDrawer;

  assert.equal(typeof Drawer, "function");
  if (typeof Drawer !== "function") return;

  const html = renderToStaticMarkup(createElement(Drawer as ComponentType<Record<string, unknown>>, {
    hotel: {
      hotel_id: "HT-CDG-002",
      hotel_name: "Marriott Paris",
      star_rating: 4.9,
      room_type: "Standard Double",
      city: "Paris",
      country: "France",
      address: "70 Avenue des Champs-Élysées, 75008 Paris, France",
      amenities: "spa, airport shuttle, kids club",
      price_per_night_aud: 824,
    },
    checkIn: "3 Apr 2027",
    checkOut: "7 Apr 2027",
    nights: 4,
    selected: false,
    providerUrl: null,
    onClose: () => undefined,
    onSelect: () => undefined,
  }));

  assert.match(html, /role="dialog"/);
  assert.match(html, /Marriott Paris/);
  assert.match(html, /70 Avenue des Champs-Élysées/);
  assert.match(html, /Standard Double/);
  assert.match(html, /spa/i);
  assert.match(html, /3 Apr 2027/);
  assert.match(html, /7 Apr 2027/);
  assert.match(html, /\$824\/night/);
  assert.match(html, /\$3,296/);
  assert.match(html, /No property image available/);
  assert.doesNotMatch(html, /reviews|policies/i);
  assert.match(html, /Select this stay/);
  assert.match(html, /View on provider site/);
  assert.match(html, /disabled=""/);
  assert.match(html, />Close</);
});

test("hotel rows expose details separately from the radio selection", async () => {
  const bookingScreen = await import("./marketplace-booking-screen");
  const OptionGroup = (bookingScreen as Record<string, unknown>).BookingOptionGroup;

  assert.equal(typeof OptionGroup, "function");
  if (typeof OptionGroup !== "function") return;

  const html = renderToStaticMarkup(createElement(OptionGroup as ComponentType<Record<string, unknown>>, {
    label: "Hotel options",
    options: [{ id: "hotel-1", title: "Marriott Paris", meta: "4.9-star hotel", price: 824, priceLabel: "$824/night" }],
    value: "hotel-1",
    onChange: () => undefined,
    onViewDetails: () => undefined,
  }));

  assert.match(html, /role="radio"/);
  assert.match(html, /View details/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
});
