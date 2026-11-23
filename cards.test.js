import test from "node:test";
import assert from "node:assert/strict";
import { cardIdentityCandidates, cardKeysMatch, findStudentByCard, linkCardToStudent, normalizeCardKey, resolveCardScan } from "./cards.js";

test("normalizes card keys across casing and separators", () => {
  assert.equal(normalizeCardKey(" hf:aa-bb cc "), "HF:AABBCC");
  assert.equal(normalizeCardKey("aabbcc", "HF"), "HF:AABBCC");
});

test("matches legacy card keys that omitted their HF or LF prefix", () => {
  assert.equal(cardKeysMatch({ cardKey: "aabbcc", cardType: "HF" }, "HF:AABBCC"), true);
  assert.equal(findStudentByCard([{ id: "1", cardKey: "LF:0011" }], "0011", "LF")?.id, "1");
});

test("does not match different card payloads", () => {
  assert.equal(cardKeysMatch({ cardKey: "HF:AABBCC" }, "HF:AABBCD"), false);
});

test("matches stable UIDs across NFC-X metadata variants and byte order", () => {
  assert.equal(cardKeysMatch({ cardKey: "HF:04A1B2C3D4" }, "HF:9904A1B2C3D400"), true);
  assert.equal(cardKeysMatch({ cardKey: "HF:04A1B2C3D4" }, "HF:D4C3B2A1"), true);
  assert.deepEqual([...cardIdentityCandidates("HF:9904A1B2C3D400")].sort(), ["9904A1B2C3D400", "A1B2C3D4", "D4C3B2A1", "00D4C3B2A10499"].sort());
});

test("links a normalized card to the selected student without mutating the original", () => {
  const student = { id: "2026-0001", name: "Alyssa", balance: 5000 };
  const linked = linkCardToStudent(student, { cardKey: "aa-bb", cardType: "HF" });
  assert.deepEqual(linked, { ...student, cardKey: "HF:AABB", cardType: "HF" });
  assert.equal(student.cardKey, undefined);
});

test("explicit repair retains original key and matches the confirmed alternate exactly", () => {
  const student = { id: "a", cardKey: "HF:AABBCCDD", cardType: "HF", balance: 1234 };
  const repaired = linkCardToStudent(student, { cardKey: "LF:1122334455", cardType: "LF" }, { preserveExisting: true });
  assert.equal(repaired.cardKey, student.cardKey);
  assert.equal(repaired.balance, student.balance);
  assert.equal(cardKeysMatch(repaired, "HF:AABBCCDD"), true);
  assert.equal(cardKeysMatch(repaired, "LF:1122334455"), true);
  assert.equal(cardKeysMatch(repaired, "HF:1122334455"), false);
  assert.equal(cardKeysMatch(repaired, "LF:5544332211"), false);
  assert.deepEqual(linkCardToStudent(repaired, { cardKey: "LF:1122334455" }, { preserveExisting: true }), repaired);
  assert.equal(student.cardAliases, undefined);
  const replaced = linkCardToStudent(repaired, { cardKey: "HF:66778899" });
  assert.equal(replaced.cardAliases, undefined);
  assert.equal(cardKeysMatch(replaced, "LF:1122334455"), false);
  assert.equal(cardKeysMatch(replaced, student.cardKey), false);
});

test("repair limits do not silently evict previously saved identifiers", () => {
  const student = { id: "a", cardKey: "HF:AABBCCDD", cardType: "HF", cardAliases: Array.from({ length: 8 }, (_, i) => `LF:00${String(i).padStart(2, "0")}`) };
  assert.throws(() => linkCardToStudent(student, { cardKey: "HF:66778899" }, { preserveExisting: true }), /too many/);
  assert.equal(student.cardAliases.length, 8);
});

test("does not confuse HF and LF cards with the same bytes", () => {
  assert.equal(cardKeysMatch({ cardKey: "HF:AABBCCDD" }, "LF:AABBCCDD"), false);
});

test("ambiguous saved links stop lookup instead of choosing a wallet", () => {
  assert.throws(() => findStudentByCard([
    { id: "a", cardKey: "HF:04A1B2C3D4" },
    { id: "b", cardKey: "HF:D4C3B2A1" },
  ], "HF:A1B2C3D4"), /more than one student/);
});

const card = (cardKey) => ({ cardKey, cardType: "HF" });

test("known metadata variants use one read and preserve the enrolled record", async () => {
  const student = { id: "a", cardKey: "HF:04A1B2C3D4", balance: 900 };
  const original = structuredClone(student);
  for (const key of ["HF:9904A1B2C3D400", "HF:D4C3B2A1", "HF:04A1B2C3D4"]) {
    let reads = 0;
    const result = await resolveCardScan(async () => { reads++; return card(key); }, [student], () => assert.fail("Known card needs no reload"));
    assert.equal(result.student.id, "a");
    assert.equal(reads, 1);
    assert.deepEqual(student, original);
  }
});

test("reloads persisted enrollment before showing a new-card prompt", async () => {
  const student = { id: "a", cardKey: "HF:AABBCCDD" };
  let reads = 0;
  const result = await resolveCardScan(async () => { reads++; return card(student.cardKey); }, [], async () => [student]);
  assert.equal(result.student.id, "a");
  assert.equal(reads, 1);
});

test("one noisy read followed by a registered card opens the registered wallet", async () => {
  const student = { id: "a", cardKey: "HF:AABBCCDD" };
  const queue = [card("HF:11223344"), card(student.cardKey)];
  const result = await resolveCardScan(async () => queue.shift(), [student], async () => [student]);
  assert.equal(result.student.id, "a");
  assert.equal(queue.length, 0);
});

test("only identical consecutive unknown reads may start enrollment", async () => {
  let queue = [card("HF:11223344"), card("HF:55667788")];
  await assert.rejects(resolveCardScan(async () => queue.shift(), [], async () => []), /reliably/);
  queue = [card("HF:11223344"), card("HF:11223344")];
  const result = await resolveCardScan(async () => queue.shift(), [], async () => []);
  assert.equal(result.student, null);
  assert.equal(result.card.cardKey, "HF:11223344");
});

test("a card saved during confirmation is recognized, and interrupted reads cannot enroll", async () => {
  const student = { id: "a", cardKey: "HF:AABBCCDD" };
  let loads = 0;
  const result = await resolveCardScan(async () => card(student.cardKey), [], async () => ++loads === 1 ? [] : [student]);
  assert.equal(result.student.id, "a");
  let reads = 0;
  await assert.rejects(resolveCardScan(async () => ++reads === 1 ? card(student.cardKey) : { noCard: true }, [], async () => []), /No card/);
  await assert.rejects(resolveCardScan(async () => card("HF:123"), [], async () => []), /reliably/);
});
