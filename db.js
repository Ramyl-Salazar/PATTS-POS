const DB_NAME = "patts-pos-prototype";
const DB_VERSION = 1;
const STUDENTS = "students";
const TRANSACTIONS = "transactions";
const SETTINGS = "settings";

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
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STUDENTS)) db.createObjectStore(STUDENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TRANSACTIONS)) {
        const store = db.createObjectStore(TRANSACTIONS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("studentId", "studentId");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function seedDatabase(db) {
  const existing = await requestToPromise(db.transaction(STUDENTS).objectStore(STUDENTS).getAllKeys());
  const missing = demoStudents.filter((student) => !existing.includes(student.id));
  if (!missing.length) return;
  const tx = db.transaction([STUDENTS, SETTINGS], "readwrite");
  missing.forEach((student) => tx.objectStore(STUDENTS).put(student));
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

export async function commitTransaction(db, student, transaction) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS], "readwrite");
  tx.objectStore(STUDENTS).put({ ...student, balance: transaction.newBalance });
  tx.objectStore(TRANSACTIONS).add(transaction);
  await transactionDone(tx);
}

export async function clearAndRestore(db, backup) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS, SETTINGS], "readwrite");
  for (const store of [STUDENTS, TRANSACTIONS, SETTINGS]) tx.objectStore(store).clear();
  backup.students.forEach((item) => tx.objectStore(STUDENTS).put(item));
  backup.transactions.forEach((item) => tx.objectStore(TRANSACTIONS).put(item));
  backup.settings.forEach((item) => tx.objectStore(SETTINGS).put(item));
  await transactionDone(tx);
}

export async function resetDatabase(db) {
  const tx = db.transaction([STUDENTS, TRANSACTIONS], "readwrite");
  for (const store of [STUDENTS, TRANSACTIONS]) tx.objectStore(store).clear();
  demoStudents.forEach((student) => tx.objectStore(STUDENTS).put(student));
  await transactionDone(tx);
}

export const stores = { STUDENTS, TRANSACTIONS, SETTINGS };
