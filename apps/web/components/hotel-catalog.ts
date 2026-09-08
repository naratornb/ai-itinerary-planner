export type HotelRoomOption = {
  id: string;
  name: string;
  price: number;
  description: string;
};

export type HotelOption = {
  id: string;
  name: string;
  area: string;
  address: string;
  checkIn: string;
  checkOut: string;
  room: string;
  price: number;
  starRating: number;
  image: string;
  imageAlt: string;
  rooms: readonly HotelRoomOption[];
};

export const HOTEL_OPTIONS: readonly HotelOption[] = [
  {
    id: "shibuya-excel",
    name: "Shibuya Excel Hotel Tokyu",
    area: "Shibuya",
    address: "1-12-2 Dogenzaka, Shibuya City, Tokyo",
    checkIn: "15:00",
    checkOut: "11:00",
    room: "Standard room",
    price: 720,
    starRating: 4,
    image: "/hotels/shibuya-excel.jpg",
    imageAlt: "Hotel pool and terrace in warm evening light",
    rooms: [
      { id: "shibuya-excel-standard", name: "Standard room", price: 720, description: "1 double bed, city view" },
      { id: "shibuya-excel-twin", name: "Twin room", price: 840, description: "2 single beds, city view" },
      { id: "shibuya-excel-deluxe", name: "Deluxe room", price: 980, description: "1 king bed, higher floor" },
    ],
  },
  {
    id: "park-hyatt",
    name: "Park Hyatt Tokyo",
    area: "Shinjuku",
    address: "3-7-1-2 Nishi-Shinjuku, Shinjuku City, Tokyo",
    checkIn: "15:00",
    checkOut: "12:00",
    room: "Deluxe room",
    price: 1680,
    starRating: 5,
    image: "/hotels/park-hyatt.jpg",
    imageAlt: "Guest room at Park Hyatt Tokyo",
    rooms: [
      { id: "park-hyatt-deluxe", name: "Deluxe room", price: 1680, description: "1 king bed, park view" },
      { id: "park-hyatt-twin-deluxe", name: "Twin Deluxe room", price: 1820, description: "2 queen beds, park view" },
      { id: "park-hyatt-suite", name: "Park Suite", price: 2450, description: "1 king bed, separate living area" },
    ],
  },
  {
    id: "9h-capsule",
    name: "9h Capsule Hotel",
    area: "Shinjuku",
    address: "1-4-15 Hyakunincho, Shinjuku City, Tokyo",
    checkIn: "14:00",
    checkOut: "10:00",
    room: "Shared room",
    price: 270,
    starRating: 2,
    image: "/hotels/9h-capsule.jpg",
    imageAlt: "Compact shared sleeping room with bunk beds",
    rooms: [
      { id: "9h-capsule-shared", name: "Shared room", price: 270, description: "Mixed capsule pod, shared floor" },
      { id: "9h-capsule-private", name: "Private pod", price: 340, description: "Single occupancy capsule pod" },
      { id: "9h-capsule-twin", name: "Twin pod", price: 410, description: "2 adjoining capsule pods" },
    ],
  },
];

export function formatHotelStarRating(starRating: number) {
  return `${"★".repeat(starRating)}${"☆".repeat(5 - starRating)} ${starRating}-star hotel`;
}
