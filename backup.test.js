import test from "node:test";
import assert from "node:assert/strict";
import { createBackup, parseBackup, validateBackup } from "./backup.js";

const student = { id: "1", name: "Alyssa", program: "BS Aero", balance: 7500, active: true };
const transaction = {
  id: "txn-1", studentId: "1", studentName: "Alyssa", type: "payment",
  amount: 2500, previousBalance: 10000, newBalance: 7500,
  note: "Meal", teller: "Bernard", createdAt: "2026-10-15T00:00:00.000Z",
};
const item = { id: "meal", name: "Meal", price: 2500, details: "Lunch", category: "food" };

test("repaired card identifiers survive backup restore, while invalid aliases are rejected", () => {
  const linked = { ...student, cardKey: "HF:AABBCCDD", cardType: "HF", cardAliases: ["LF:1122334455"] };
  const backup = createBackup({ students: [linked], transactions: [], items: [], settings: [] });
  assert.deepEqual(parseBackup(JSON.stringify(backup)).students[0].cardAliases, linked.cardAliases);
  for (const aliases of ["HF:AABB", ["junk"], ["HF:123"], Array(9).fill("HF:AABB")]) {
    assert.throws(() => validateBackup({ ...backup, students: [{ ...linked, cardAliases: aliases }] }), /valid PATTS/);
  }
});

test("creates a versioned backup without device authentication records", () => {
  const backup = createBackup({
    students: [student], transactions: [transaction], items: [item],
    settings: [{ key: "tellerName", value: "Bernard" }, { key: "auth", value: { hash: "secret" } }, { key: "authThrottle", value: { failures: 4 } }],
    now: new Date("2026-10-15T00:00:00.000Z"),
  });
  assert.deepEqual(backup.settings, [{ key: "tellerName", value: "Bernard" }]);
  assert.equal(backup.students[0].program, undefined);
  assert.equal(backup.items[0].category, "food");
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
});

test("rejects incomplete, inconsistent, or executable backup values", () => {
  const base = { version: 2, exportedAt: "2026-10-15T00:00:00.000Z", students: [student], transactions: [transaction], items: [item], settings: [] };
  assert.throws(() => validateBackup({ students: [], transactions: [] }), /valid PATTS/);
  assert.throws(() => validateBackup({ ...base, students: [{ id: "1" }] }), /valid PATTS/);
  assert.throws(() => validateBackup({ ...base, transactions: [{ ...transaction, type: '\" onmouseover=\"alert(1)' }] }), /valid PATTS/);
  assert.throws(() => validateBackup({ ...base, transactions: [{ ...transaction, newBalance: 9999 }] }), /valid PATTS/);
  assert.throws(() => parseBackup("not json"), /valid PATTS/);
});

test("drops authentication records from older version-two backups", () => {
  const restored = validateBackup({
    version: 2, exportedAt: "2026-10-15T00:00:00.000Z",
    students: [student], transactions: [], items: [],
    settings: [{ key: "auth", value: { salt: "aa", hash: "bb" } }, { key: "authThrottle", value: { failures: 4 } }],
  });
  assert.deepEqual(restored.settings, []);
});

test("preserves the built-in variable Add funds item", () => {
  const topUp = { id: "item-add-funds", name: "Add funds", price: 0, details: "Custom amount", transactionType: "topup" };
  const restored = validateBackup({
    version: 2, exportedAt: "2026-10-15T00:00:00.000Z",
    students: [student], transactions: [], items: [topUp], settings: [],
  });
  assert.deepEqual(restored.items, [topUp]);
});
