import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryItem, inferLegacyItemCategory } from "./inventory.js";

test("normalizes inventory form data", () => {
  assert.deepEqual(
    buildInventoryItem({ name: " Water ", price: "20.00", details: " Bottle ", category: "drinks" }, () => "fixed"),
    { id: "item-fixed", name: "Water", price: 2000, details: "Bottle", category: "drinks" },
  );
});

test("requires an inventory name and valid positive price", () => {
  assert.throws(() => buildInventoryItem({ name: " ", price: "20" }), /name/);
  assert.throws(() => buildInventoryItem({ name: "Water", price: "0" }), /greater than zero/);
  assert.throws(() => buildInventoryItem({ name: "Water", price: "20", category: "other" }), /Food, Drinks, or Service/);
});

test("assigns safe categories to legacy uncategorized items", () => {
  assert.equal(inferLegacyItemCategory({ name: "Bottled water" }), "drinks");
  assert.equal(inferLegacyItemCategory({ name: "Student meal" }), "food");
  assert.equal(inferLegacyItemCategory({ name: "Document printing" }), "service");
  assert.equal(inferLegacyItemCategory({ id: "item-water", name: "Bottled water", category: "service" }), "drinks");
});
