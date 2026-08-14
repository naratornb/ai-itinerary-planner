export type HotelOption = {
  id: string;
  name: string;
  area: string;
  address: string;
  checkIn: string;
  checkOut: string;
  room: string;
  price: number;
  image: string;
  imageAlt: string;
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
    image: "/hotels/shibuya-excel.jpg",
    imageAlt: "Hotel pool and terrace in warm evening light",
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
    image: "/hotels/park-hyatt.jpg",
    imageAlt: "Guest room at Park Hyatt Tokyo",
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
    image: "/hotels/9h-capsule.jpg",
    imageAlt: "Compact shared sleeping room with bunk beds",
  },
];
