import test from "node:test";
import assert from "node:assert/strict";
import { addItemToOrder, addManualAmountToOrder, adjustOrderLine, orderItemCount, orderNote, orderTotal } from "./order.js";

test("adds menu items directly to an order and groups repeat taps", () => {
  const water = { id: "water", name: "Bottled water", price: 2000 };
  const once = addItemToOrder([], water);
  const twice = addItemToOrder(once, water);
  assert.deepEqual(twice, [{ lineId: "item:water", itemId: "water", name: "Bottled water", price: 2000, quantity: 2 }]);
  assert.equal(orderItemCount(twice), 2);
  assert.equal(orderTotal(twice), 4000);
  assert.equal(orderNote(twice), "Bottled water x2");
});

test("supports manual order lines and quantity removal", () => {
  const lines = addManualAmountToOrder([], 1250, 1);
  assert.equal(orderTotal(lines), 1250);
  assert.deepEqual(adjustOrderLine(lines, "manual:1", -1), []);
  assert.throws(() => addManualAmountToOrder([], 0, 2), /amount/);
});
