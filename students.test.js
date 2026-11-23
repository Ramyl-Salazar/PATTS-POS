import test from "node:test";
import assert from "node:assert/strict";
import { demoStudents } from "./db.js";
import { filterStudents } from "./students.js";

test("ships with 20 unique demo wallets", () => {
  assert.equal(demoStudents.length, 20);
  assert.equal(new Set(demoStudents.map((student) => student.id)).size, 20);
});

test("finds students by partial name regardless of case", () => {
  assert.deepEqual(filterStudents(demoStudents, "soFIA").map((student) => student.id), ["2026-0005"]);
});

test("finds students by ID and does not expose removed program data", () => {
  assert.deepEqual(filterStudents(demoStudents, "0019").map((student) => student.name), ["Elena Valdez"]);
  assert.deepEqual(filterStudents(demoStudents, "avionics"), []);
});
