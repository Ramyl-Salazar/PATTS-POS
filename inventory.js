import { pesosToCentavos } from "./wallet.js";

export const ITEM_CATEGORIES = Object.freeze(["food", "drinks", "service"]);

const DEFAULT_ITEM_CATEGORIES = Object.freeze({
  "item-meal": "food",
  "item-snack": "food",
  "item-water": "drinks",
  "item-print": "service",
  "item-id": "service",
  "item-fee": "service",
});

export function inferLegacyItemCategory(item) {
  if (DEFAULT_ITEM_CATEGORIES[item?.id]) return DEFAULT_ITEM_CATEGORIES[item.id];
  if (item?.category) return normalizeItemCategory(item.category);
  const searchable = `${item?.id || ""} ${item?.name || ""}`.toLocaleLowerCase("en-PH");
  if (/water|drink|beverage|juice|coffee|tea/.test(searchable)) return "drinks";
  if (/meal|snack|food|rice|bread|lunch/.test(searchable)) return "food";
  return "service";
}

export function normalizeItemCategory(value) {
  const category = String(value || "service").trim().toLocaleLowerCase("en-PH");
  if (!ITEM_CATEGORIES.includes(category)) throw new Error("Choose Food, Drinks, or Service.");
  return category;
}

export function buildInventoryItem({ id = "", name, price, details = "", category = "service" }, randomUUID = () => crypto.randomUUID()) {
  const normalizedName = String(name).trim();
  if (!normalizedName) throw new Error("Enter an item name.");
  return {
    id: String(id) || `item-${randomUUID()}`,
    name: normalizedName,
    price: pesosToCentavos(price),
    details: String(details).trim(),
    category: normalizeItemCategory(category),
  };
}
