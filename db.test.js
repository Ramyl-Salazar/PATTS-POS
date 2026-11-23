import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { clearAndRestore, commitTransaction, DB_NAME, deleteStudent, getAll, getOne, linkStudentCard, openDatabase, putOne, stores } from "./db.js";
import { findStudentByCard } from "./cards.js";

function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function createVersionThreeDatabase(items) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(stores.STUDENTS, { keyPath: "id" });
      db.createObjectStore(stores.TRANSACTIONS, { keyPath: "id" });
      db.createObjectStore(stores.SETTINGS, { keyPath: "key" });
      const itemStore = db.createObjectStore(stores.ITEMS, { keyPath: "id" });
      items.forEach((item) => itemStore.put(item));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("restores a backup and atomically commits a wallet transaction", async () => {
  await deleteDatabase();
  const db = await openDatabase();
  const student = { id: "1", name: "Alyssa", program: "BS Aero", balance: 10000, active: true };
  await clearAndRestore(db, { students: [student], transactions: [], settings: [], items: [] });
  assert.deepEqual(await getOne(db, stores.STUDENTS, "1"), student);

  const transaction = {
    id: "txn-1", studentId: "1", studentName: "Alyssa", type: "payment",
    amount: 2500, previousBalance: 10000, newBalance: 7500,
    note: "Meal", teller: "Bernard", createdAt: "2026-10-15T00:00:00.000Z",
  };
  await commitTransaction(db, student, transaction);
  assert.equal((await getOne(db, stores.STUDENTS, "1")).balance, 7500);
  assert.deepEqual(await getAll(db, stores.TRANSACTIONS), [transaction]);

  await deleteStudent(db, student.id);
  assert.equal(await getOne(db, stores.STUDENTS, student.id), undefined);
  assert.deepEqual(await getAll(db, stores.TRANSACTIONS), []);

  const throttle = { key: "authThrottle", value: { failures: 0, lockedUntil: 123456 } };
  await putOne(db, stores.SETTINGS, throttle);
  db.close();
  const reopened = await openDatabase();
  assert.deepEqual(await getOne(reopened, stores.SETTINGS, "authThrottle"), throttle);
  reopened.close();
  await deleteDatabase();
});

test("repairs prototype item categories when upgrading an existing database", async () => {
  await deleteDatabase();
  const legacyDb = await createVersionThreeDatabase([
    { id: "item-water", name: "Bottled water", price: 2000, category: "service" },
    { id: "item-meal", name: "Student meal", price: 8500, category: "drinks" },
    { id: "custom-item", name: "Custom service", price: 1000, category: "service" },
  ]);
  legacyDb.close();

  const upgradedDb = await openDatabase();
  assert.equal((await getOne(upgradedDb, stores.ITEMS, "item-water")).category, "drinks");
  assert.equal((await getOne(upgradedDb, stores.ITEMS, "item-meal")).category, "food");
  assert.equal((await getOne(upgradedDb, stores.ITEMS, "custom-item")).category, "service");
  upgradedDb.close();
  await deleteDatabase();
});

test("repair persists across restart and stale balance updates cannot erase it", async () => {
  await deleteDatabase();
  let db = await openDatabase();
  const cached = { id: "a", name: "Student", balance: 10000, cardKey: "HF:AABBCCDD", cardType: "HF" };
  await putOne(db, stores.STUDENTS, cached);
  await linkStudentCard(db, "a", { cardKey: "LF:1122334455", cardType: "LF" }, { preserveExisting: true });
  await commitTransaction(db, cached, { id: "one", studentId: "a", previousBalance: 10000, newBalance: 9000 });
  db.close(); db = await openDatabase();
  const saved = await getAll(db, stores.STUDENTS);
  assert.equal(findStudentByCard(saved, "LF:1122334455").id, "a");
  assert.equal(findStudentByCard(saved, cached.cardKey).id, "a");
  assert.equal(saved[0].balance, 9000);
  await assert.rejects(commitTransaction(db, cached, { id: "two", studentId: "a", previousBalance: 10000, newBalance: 8000 }), /wallet changed/);
  assert.equal((await getAll(db, stores.TRANSACTIONS)).length, 1);
  db.close(); await deleteDatabase();
});

test("competing repairs cannot assign one identifier to two students", async () => {
  await deleteDatabase();
  const db = await openDatabase();
  for (const id of ["a", "b"]) await putOne(db, stores.STUDENTS, { id, name: id, balance: 1000 });
  const card = { cardKey: "HF:11223344", cardType: "HF" };
  const outcomes = await Promise.allSettled([linkStudentCard(db, "a", card), linkStudentCard(db, "b", card)]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  const saved = await getAll(db, stores.STUDENTS);
  assert.equal(saved.filter((s) => s.cardKey === card.cardKey).length, 1);
  db.close(); await deleteDatabase();
});
