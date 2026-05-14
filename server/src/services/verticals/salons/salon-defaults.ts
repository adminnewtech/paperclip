// ---------------------------------------------------------------------------
// Default salon services and sample stylists
// ---------------------------------------------------------------------------
//
// Prices are stored as integer "fils" (1 KWD = 1000 fils). This matches the
// 3-decimal precision used in Kuwait for currency, while still using
// `amountCents` semantics for storage compatibility.

export interface DefaultSalonService {
  name: string;
  nameAr: string;
  category: string;
  durationMinutes: number;
  /** Price in fils (1 KWD = 1000 fils). */
  priceCents: number;
}

export const DEFAULT_SALON_SERVICES: DefaultSalonService[] = [
  { name: "Haircut", nameAr: "قص شعر", category: "Hair", durationMinutes: 30, priceCents: 8000 },
  { name: "Hair coloring", nameAr: "صبغة شعر", category: "Hair", durationMinutes: 90, priceCents: 25000 },
  { name: "Hair styling / Blowdry", nameAr: "استشوار", category: "Hair", durationMinutes: 30, priceCents: 10000 },
  { name: "Protein treatment", nameAr: "علاج بروتين", category: "Hair", durationMinutes: 120, priceCents: 50000 },
  { name: "Keratin treatment", nameAr: "علاج كيراتين", category: "Hair", durationMinutes: 180, priceCents: 70000 },
  { name: "Manicure", nameAr: "منيكير", category: "Nails", durationMinutes: 30, priceCents: 7000 },
  { name: "Pedicure", nameAr: "بديكير", category: "Nails", durationMinutes: 45, priceCents: 10000 },
  { name: "Gel nails", nameAr: "أظافر جل", category: "Nails", durationMinutes: 60, priceCents: 15000 },
  { name: "Facial", nameAr: "تنظيف بشرة", category: "Skin", durationMinutes: 60, priceCents: 18000 },
  { name: "Deep facial", nameAr: "تنظيف عميق للبشرة", category: "Skin", durationMinutes: 90, priceCents: 30000 },
  { name: "Waxing", nameAr: "إزالة شعر", category: "Hair Removal", durationMinutes: 45, priceCents: 12000 },
  { name: "Threading (eyebrows)", nameAr: "تنظيف حواجب", category: "Hair Removal", durationMinutes: 15, priceCents: 3000 },
  { name: "Makeup", nameAr: "مكياج", category: "Makeup", durationMinutes: 60, priceCents: 30000 },
  { name: "Bridal makeup", nameAr: "مكياج عرايس", category: "Makeup", durationMinutes: 120, priceCents: 80000 },
  { name: "Massage", nameAr: "مساج", category: "Spa", durationMinutes: 60, priceCents: 20000 },
];

export interface DefaultSalonStylist {
  name: string;
  email: string;
  phone: string;
  specialties: string[];
}

export const DEFAULT_SALON_STYLISTS: DefaultSalonStylist[] = [
  {
    name: "Layla Ahmad",
    email: "layla@example.com",
    phone: "+96599000001",
    specialties: ["Hair", "Makeup"],
  },
  {
    name: "Sara Hussain",
    email: "sara@example.com",
    phone: "+96599000002",
    specialties: ["Nails", "Skin"],
  },
];
