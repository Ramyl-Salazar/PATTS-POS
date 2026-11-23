import { inferLegacyItemCategory } from "./inventory.js";
import { findStudentByCard, linkCardToStudent } from "./cards.js";

export const DB_NAME = "patts-pos-prototype";
const DB_VERSION = 4;
const STUDENTS = "students";
const TRANSACTIONS = "transactions";
const SETTINGS = "settings";
const ITEMS = "items";

export const defaultInventory = [
  { id: "item-add-funds", name: "Add funds", price: 0, details: "Enter a custom amount with the keypad", transactionType: "topup" },
  { id: "item-meal", name: "Student meal", price: 8500, details: "Standard canteen meal", category: "food" },
  { id: "item-snack", name: "Snack", price: 3500, details: "Quick snack item", category: "food" },
  { id: "item-water", name: "Bottled water", price: 2000, details: "Single bottle", category: "drinks" },
  { id: "item-print", name: "Document printing", price: 500, details: "Per page", category: "service" },
  { id: "item-id", name: "ID replacement", price: 15000, details: "Replacement school ID", category: "service" },
  { id: "item-fee", name: "School fee", price: 50000, details: "Common fixed fee", category: "service" },
];

export const demoStudents = [
  { id: "2026-0001", name: "Alyssa Reyes", program: "BS Aeronautical Engineering", balance: 75000, active: true },
  { id: "2026-0002", name: "Marco Santos", program: "BS Aircraft Maintenance Technology", balance: 32550, active: true },
  { id: "2026-0003", name: "Nica Villanueva", program: "BS Air Transportation", balance: 12000, active: true },
  { id: "2026-0004", name: "Gabriel Mendoza", program: "BS Avionics Technology", balance: 48000, active: true },
  { id: "2026-0005", name: "Sofia Lim", program: "BS Aeronautical Engineering", balance: 61575, active: true },
  { id: "2026-0006", name: "Enzo Bautista", program: "BS Aircraft Maintenance Technology", balance: 28700, active: true },
  { id: "2026-0007", name: "Mika dela Cruz", program: "BS Air Transportation", balance: 94000, active: true },
  { id: "2026-0008", name: "Rafael Navarro", program: "BS Avionics Technology", balance: 17325, active: true },
  { id: "2026-0009", name: "Isabella Garcia", program: "BS Aeronautical Engineering", balance: 52200, active: true },
  { id: "2026-0010", name: "Luis Fernandez", program: "BS Aircraft Maintenance Technology", balance: 80650, active: true },
  { id: "2026-0011", name: "Chloe Ramos", program: "BS Air Transportation", balance: 35900, active: true },
  { id: "2026-0012", name: "Miguel Aquino", program: "BS Avionics Technology", balance: 68000, active: true },
  { id: "2026-0013", name: "Andrea Castillo", program: "BS Aeronautical Engineering", balance: 21450, active: true },
  { id: "2026-0014", name: "Paolo Dominguez", program: "BS Aircraft Maintenance Technology", balance: 73500, active: true },
  { id: "2026-0015", name: "Julia Mercado", program: "BS Air Transportation", balance: 44525, active: true },
  { id: "2026-0016", name: "Nathaniel Flores", program: "BS Avionics Technology", balance: 19800, active: true },
  { id: "2026-0017", name: "Bianca Torres", program: "BS Aeronautical Engineering", balance: 87000, active: true },
  { id: "2026-0018", name: "Carlos Pascual", program: "BS Aircraft Maintenance Technology", balance: 26475, active: true },
  { id: "2026-0019", name: "Elena Valdez", program: "BS Air Transportation", balance: 55750, active: true },
  { id: "2026-0020", name: "Joaquin Manalo", program: "BS Avionics Technology", balance: 39000, active: true },
];

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STUDENTS)) db.createObjectStore(STUDENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TRANSACTIONS)) {
        const store = db.createObjectStore(TRANSACTIONS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("studentId", "studentId");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: "id" });
      if (event.oldVersion > 0 && event.oldVersion < 4) {
        const itemStore = request.transaction.objectStore(ITEMS);
        itemStore.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          const item = cursor.value;
          if (!item.transactionType) {
            const category = inferLegacyItemCategory(item);
            if (category !== item.category) cursor.update({ ...item, category });
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function seedDatabase(db) {
  const existing = await requestToPromise(db.transaction(STUDENTS).objectStore(STUDENTS).getAllKeys());
  const missing = demoStudents.filter((student) => !existing.includes(student.id));
  const itemKeys = await requestToPromise(db.transaction(ITEMS).objectStore(ITEMS).getAllKeys());
  const missingItems = defaultInventory.filter((item) => !itemKeys.includes(item.id));
  if (!missing.length && !missingItems.length) return;
  const tx = db.transaction([STUDENTS, SETTINGS, ITEMS], "readwrite");
  missing.forEach((student) => tx.objectStore(STUDENTS).put(student));
  missingItems.forEach((item) => tx.objectStore(ITEMS).put(item));
  tx.objectStore(SETTINGS).put({ key: "tellerName", value: "Demo Teller" });
  await transactionDone(tx);
}

export function getAll(db, storeName) {
  return requestToPromise(db.transaction(storeName).objectStore(storeName).getAll());
}

export function getOne(db, storeName, key) {
  return requestToPromise(db.transaction(storeName).objectStore(storeName).get(key));
}

export async function putOne(db, storeName, value) {
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
}

export function linkStudentCard(db, studentId, card, options) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STUDENTS, "readwrite");
    const store = tx.objectStore(STUDENTS);
    let linked;
    let failure;
    tx.oncomplete = () => resolve(linked);
    tx.onabort = tx.onerror = () => reject(failure || tx.error);
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const student = request.result.find((item) => item.id === studentId);
        const owner = findStudentByCard(request.result, card.cardKey, card.cardType);
        if (owner && owner.id !== studentId) throw new Error("This card is already linked to another student. Check the student's identity before continuing.");
        linked = linkCardToStudent(student, card, options);
        store.put(linked);
      } catch (error) { failure = error; tx.abort(); }
    };
  });
}

export async function deleteOne(db, storeName, key) {
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

export async function deleteStudent(db, studentId) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS], "readwrite");
  tx.objectStore(STUDENTS).delete(studentId);
  const cursorRequest = tx.objectStore(TRANSACTIONS).index("studentId").openCursor(studentId);
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(tx);
}

export async function commitTransaction(db, student, transaction) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS], "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore(STUDENTS);
  let failure;
  const request = store.get(student.id);
  request.onsuccess = () => {
    const saved = request.result;
    if (!saved || saved.balance !== transaction.previousBalance || saved.id !== transaction.studentId) {
      failure = new Error("The wallet changed. Cancel and review the transaction again.");
      tx.abort();
      return;
    }
    // A balance update must not restore a stale card link from the UI cache.
    store.put({ ...saved, balance: transaction.newBalance });
    tx.objectStore(TRANSACTIONS).add(transaction);
  };
  try { await done; } catch (error) { throw failure || error; }
}

export async function clearAndRestore(db, backup) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS, SETTINGS, ITEMS], "readwrite");
  for (const store of [STUDENTS, TRANSACTIONS, SETTINGS, ITEMS]) tx.objectStore(store).clear();
  backup.students.forEach((item) => tx.objectStore(STUDENTS).put(item));
  backup.transactions.forEach((item) => tx.objectStore(TRANSACTIONS).put(item));
  backup.settings.forEach((item) => tx.objectStore(SETTINGS).put(item));
  (backup.items || defaultInventory).forEach((item) => tx.objectStore(ITEMS).put(item));
  await transactionDone(tx);
}

export async function resetDatabase(db) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS, ITEMS], "readwrite");
  for (const store of [STUDENTS, TRANSACTIONS, ITEMS]) tx.objectStore(store).clear();
  demoStudents.forEach((student) => tx.objectStore(STUDENTS).put(student));
  defaultInventory.forEach((item) => tx.objectStore(ITEMS).put(item));
  await transactionDone(tx);
}

export const stores = { STUDENTS, TRANSACTIONS, SETTINGS, ITEMS };
