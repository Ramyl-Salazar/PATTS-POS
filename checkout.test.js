import test from "node:test";
import assert from "node:assert/strict";
import { prepareTransaction, updateEnteredCentavos } from "./checkout.js";
import { TRANSACTION_TYPES } from "./wallet.js";

test("handles keypad entry, leading zeros, deletion, and the digit limit", () => {
  assert.equal(updateEnteredCentavos("", 0), "0");
  assert.equal(updateEnteredCentavos("0", 5), "5");
  assert.equal(updateEnteredCentavos("1250", "←"), "125");
  assert.equal(updateEnteredCentavos("12345678", 9), "12345678");
});

test("prepares the main checkout transaction with a deterministic balance", () => {
  const student = { id: "1", name: "Alyssa", balance: 10000 };
  const result = prepareTransaction({
    student, type: TRANSACTION_TYPES.PAYMENT, enteredCentavos: "2500",
    note: "Student meal", teller: "Bernard", now: new Date("2026-10-15T00:00:00.000Z"),
  });
  assert.equal(result.amount, 2500);
  assert.equal(result.newBalance, 7500);
  assert.equal(result.transaction.note, "Student meal");
  assert.equal(result.transaction.teller, "Bernard");
});

test("requires a wallet and amount before checkout", () => {
  assert.throws(() => prepareTransaction({ enteredCentavos: "100" }), /student wallet/);
  assert.throws(() => prepareTransaction({ student: { balance: 1000 }, enteredCentavos: "" }), /amount/);
});
