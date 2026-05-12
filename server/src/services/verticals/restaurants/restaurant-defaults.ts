// ---------------------------------------------------------------------------
// Restaurant defaults — sample Kuwaiti menu + a small set of tables.
// ---------------------------------------------------------------------------
//
// All prices are KWD with 3-decimal precision, stored as integer fils.
//   1.500 KWD = 1500 fils
//
// Used by setupDefaults() to seed a brand-new restaurant company so the POS
// is usable from minute zero. Categories are kept short and bilingual.

import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { MenuItem, MenuItemStation, Table } from "./index.js";

interface DefaultMenuItem {
  code: string;
  name: string;
  nameAr: string;
  category: string;
  priceCents: number;
  costCents?: number;
  station: MenuItemStation;
  preparationTimeMinutes: number;
}

export const DEFAULT_MENU_ITEMS: DefaultMenuItem[] = [
  // ---- Appetizers (مقبلات) ----
  {
    code: "MENU-0001",
    name: "Hummus",
    nameAr: "حمص",
    category: "Appetizers",
    priceCents: 1500,
    costCents: 400,
    station: "cold",
    preparationTimeMinutes: 5,
  },
  {
    code: "MENU-0002",
    name: "Mutabbal",
    nameAr: "متبل",
    category: "Appetizers",
    priceCents: 1750,
    costCents: 500,
    station: "cold",
    preparationTimeMinutes: 5,
  },
  {
    code: "MENU-0003",
    name: "Falafel",
    nameAr: "فلافل",
    category: "Appetizers",
    priceCents: 1750,
    costCents: 450,
    station: "kitchen",
    preparationTimeMinutes: 8,
  },
  {
    code: "MENU-0004",
    name: "Tabbouleh",
    nameAr: "تبولة",
    category: "Appetizers",
    priceCents: 2000,
    costCents: 600,
    station: "cold",
    preparationTimeMinutes: 5,
  },
  {
    code: "MENU-0005",
    name: "Stuffed Vine Leaves",
    nameAr: "ورق عنب",
    category: "Appetizers",
    priceCents: 2250,
    costCents: 700,
    station: "cold",
    preparationTimeMinutes: 6,
  },
  // ---- Mains (الأطباق الرئيسية) ----
  {
    code: "MENU-0006",
    name: "Chicken Machboos",
    nameAr: "مجبوس دجاج",
    category: "Mains",
    priceCents: 5500,
    costCents: 1800,
    station: "kitchen",
    preparationTimeMinutes: 20,
  },
  {
    code: "MENU-0007",
    name: "Lamb Machboos",
    nameAr: "مجبوس لحم",
    category: "Mains",
    priceCents: 7500,
    costCents: 2500,
    station: "kitchen",
    preparationTimeMinutes: 25,
  },
  {
    code: "MENU-0008",
    name: "Bukhari Rice",
    nameAr: "رز بخاري",
    category: "Mains",
    priceCents: 4500,
    costCents: 1500,
    station: "kitchen",
    preparationTimeMinutes: 18,
  },
  {
    code: "MENU-0009",
    name: "Shawarma",
    nameAr: "شاورما",
    category: "Mains",
    priceCents: 2500,
    costCents: 900,
    station: "grill",
    preparationTimeMinutes: 10,
  },
  {
    code: "MENU-0010",
    name: "Beef Burger",
    nameAr: "برجر لحم",
    category: "Mains",
    priceCents: 3500,
    costCents: 1200,
    station: "grill",
    preparationTimeMinutes: 12,
  },
  {
    code: "MENU-0011",
    name: "Pasta",
    nameAr: "باستا",
    category: "Mains",
    priceCents: 3750,
    costCents: 1100,
    station: "kitchen",
    preparationTimeMinutes: 14,
  },
  {
    code: "MENU-0012",
    name: "Shish Taouk",
    nameAr: "شيش طاووق",
    category: "Mains",
    priceCents: 5000,
    costCents: 1700,
    station: "grill",
    preparationTimeMinutes: 18,
  },
  {
    code: "MENU-0013",
    name: "Fried Fish",
    nameAr: "سمك مقلي",
    category: "Mains",
    priceCents: 8000,
    costCents: 2800,
    station: "kitchen",
    preparationTimeMinutes: 20,
  },
  // ---- Sides (الجوانب) ----
  {
    code: "MENU-0014",
    name: "French Fries",
    nameAr: "بطاطس مقلية",
    category: "Sides",
    priceCents: 1250,
    costCents: 300,
    station: "kitchen",
    preparationTimeMinutes: 6,
  },
  {
    code: "MENU-0015",
    name: "White Rice",
    nameAr: "رز أبيض",
    category: "Sides",
    priceCents: 1000,
    costCents: 250,
    station: "kitchen",
    preparationTimeMinutes: 5,
  },
  {
    code: "MENU-0016",
    name: "Mixed Vegetables",
    nameAr: "خضار مشكل",
    category: "Sides",
    priceCents: 1500,
    costCents: 450,
    station: "kitchen",
    preparationTimeMinutes: 6,
  },
  {
    code: "MENU-0017",
    name: "Garden Salad",
    nameAr: "سلطة",
    category: "Sides",
    priceCents: 1500,
    costCents: 400,
    station: "cold",
    preparationTimeMinutes: 4,
  },
  {
    code: "MENU-0018",
    name: "Arabic Bread",
    nameAr: "خبز عربي",
    category: "Sides",
    priceCents: 500,
    costCents: 100,
    station: "kitchen",
    preparationTimeMinutes: 2,
  },
  // ---- Beverages (المشروبات) ----
  {
    code: "MENU-0019",
    name: "Tea",
    nameAr: "شاي",
    category: "Beverages",
    priceCents: 750,
    costCents: 100,
    station: "bar",
    preparationTimeMinutes: 3,
  },
  {
    code: "MENU-0020",
    name: "Arabic Coffee",
    nameAr: "قهوة عربية",
    category: "Beverages",
    priceCents: 1000,
    costCents: 150,
    station: "bar",
    preparationTimeMinutes: 3,
  },
  {
    code: "MENU-0021",
    name: "Fresh Orange Juice",
    nameAr: "عصير برتقال",
    category: "Beverages",
    priceCents: 1500,
    costCents: 400,
    station: "bar",
    preparationTimeMinutes: 4,
  },
  {
    code: "MENU-0022",
    name: "Water",
    nameAr: "ماء",
    category: "Beverages",
    priceCents: 500,
    costCents: 75,
    station: "bar",
    preparationTimeMinutes: 1,
  },
  {
    code: "MENU-0023",
    name: "Soft Drinks",
    nameAr: "مشروبات غازية",
    category: "Beverages",
    priceCents: 750,
    costCents: 200,
    station: "bar",
    preparationTimeMinutes: 1,
  },
  // ---- Desserts (الحلويات) ----
  {
    code: "MENU-0024",
    name: "Kunafa",
    nameAr: "كنافة",
    category: "Desserts",
    priceCents: 2500,
    costCents: 800,
    station: "kitchen",
    preparationTimeMinutes: 8,
  },
  {
    code: "MENU-0025",
    name: "Luqaimat",
    nameAr: "لقيمات",
    category: "Desserts",
    priceCents: 1750,
    costCents: 500,
    station: "kitchen",
    preparationTimeMinutes: 6,
  },
  {
    code: "MENU-0026",
    name: "Umm Ali",
    nameAr: "أم علي",
    category: "Desserts",
    priceCents: 2250,
    costCents: 700,
    station: "kitchen",
    preparationTimeMinutes: 8,
  },
  {
    code: "MENU-0027",
    name: "Ice Cream",
    nameAr: "أيس كريم",
    category: "Desserts",
    priceCents: 1500,
    costCents: 500,
    station: "cold",
    preparationTimeMinutes: 2,
  },
];

interface DefaultTable {
  code: string;
  name: string;
  capacity: number;
  area: Table["area"];
  position: { x: number; y: number };
}

export const DEFAULT_TABLES: DefaultTable[] = [
  { code: "TBL-001", name: "Table 1", capacity: 2, area: "main", position: { x: 60, y: 60 } },
  { code: "TBL-002", name: "Table 2", capacity: 4, area: "main", position: { x: 200, y: 60 } },
  { code: "TBL-003", name: "Table 3", capacity: 4, area: "main", position: { x: 340, y: 60 } },
  { code: "TBL-004", name: "Table 4", capacity: 6, area: "main", position: { x: 60, y: 200 } },
  { code: "TBL-005", name: "Table 5", capacity: 4, area: "main", position: { x: 200, y: 200 } },
  { code: "TBL-006", name: "Table 6", capacity: 2, area: "main", position: { x: 340, y: 200 } },
  { code: "TBL-007", name: "Patio 1", capacity: 4, area: "outdoor", position: { x: 60, y: 360 } },
  { code: "TBL-008", name: "Patio 2", capacity: 4, area: "outdoor", position: { x: 200, y: 360 } },
  { code: "TBL-009", name: "VIP 1", capacity: 8, area: "vip", position: { x: 340, y: 360 } },
  { code: "TBL-010", name: "Bar 1", capacity: 2, area: "bar", position: { x: 480, y: 60 } },
];

export async function applyDefaultMenu(
  db: Db,
  companyId: string,
): Promise<number> {
  const now = new Date();
  let inserted = 0;
  for (const item of DEFAULT_MENU_ITEMS) {
    const menuItem: Omit<MenuItem, "id"> = {
      code: item.code,
      name: item.name,
      nameAr: item.nameAr,
      category: item.category,
      priceCents: item.priceCents,
      costCents: item.costCents,
      modifiers: [],
      isAvailable: true,
      preparationTimeMinutes: item.preparationTimeMinutes,
      taxable: true,
      station: item.station,
    };
    try {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: "restaurants",
        entityType: "menu_item",
        code: item.code,
        name: item.name,
        status: "available",
        amountCents: item.priceCents,
        currency: null,
        data: menuItem as unknown as Record<string, unknown>,
        tags: [item.category],
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    } catch {
      // ignore duplicates
    }
  }
  return inserted;
}

export async function applyDefaultTables(
  db: Db,
  companyId: string,
): Promise<number> {
  const now = new Date();
  let inserted = 0;
  for (const table of DEFAULT_TABLES) {
    const t: Omit<Table, "id"> = {
      code: table.code,
      name: table.name,
      capacity: table.capacity,
      area: table.area,
      status: "available",
      position: table.position,
    };
    try {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: "restaurants",
        entityType: "table",
        code: table.code,
        name: table.name,
        status: "available",
        data: t as unknown as Record<string, unknown>,
        tags: [table.area],
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    } catch {
      // ignore duplicates
    }
  }
  return inserted;
}
