import test from "node:test";
import assert from "node:assert/strict";
import { calculateBalance, pesosToCentavos, TRANSACTION_TYPES } from "./wallet.js";

test("converts peso strings to integer centavos", () => {
  assert.equal(pesosToCentavos("125.50"), 12550);
  assert.equal(pesosToCentavos("1,000"), 100000);
});

test("rejects invalid amounts", () => {
  for (const value of ["0", "-1", "10.001", "abc"]) assert.throws(() => pesosToCentavos(value));
});

test("adds and deducts funds using integer arithmetic", () => {
  assert.equal(calculateBalance(50000, TRANSACTION_TYPES.TOP_UP, 12550), 62550);
  assert.equal(calculateBalance(50000, TRANSACTION_TYPES.PAYMENT, 12550), 37450);
});

test("prevents a negative wallet", () => {
  assert.throws(() => calculateBalance(1000, TRANSACTION_TYPES.PAYMENT, 1001), /Insufficient/);
});
