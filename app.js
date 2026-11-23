import { clearAndRestore, commitTransaction, getAll, getOne, openDatabase, putOne, resetDatabase, seedDatabase, stores } from "./db.js";
import { calculateBalance, createTransaction, formatPeso, pesosToCentavos, TRANSACTION_TYPES } from "./wallet.js";
import { filterStudents } from "./students.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const studentDialog = document.querySelector("#student-dialog");
const studentForm = document.querySelector("#student-form");
const transactionDialog = document.querySelector("#transaction-dialog");
const transactionForm = document.querySelector("#transaction-form");
const transactionSummary = document.querySelector("#transaction-summary");
const backupInput = document.querySelector("#backup-input");
const installButton = document.querySelector("#install-button");
const connectionStatus = document.querySelector("#connection-status");
const operatorStatus = document.querySelector("#operator-status");

let db;
let students = [];
let transactions = [];
let activeStudentId = null;
let enteredCentavos = "";
let deferredInstallPrompt = null;
let toastTimer;
let authenticated = false;
let operatorName = "";
let authRecord = null;
let failedPinAttempts = 0;
let pendingTransaction = null;
let studentQuery = "";

const nativePlugin = (name) => window.Capacitor?.Plugins?.[name];

async function confirmWithHaptics(type = "SUCCESS") {
  try { await nativePlugin("Haptics")?.notification({ type }); } catch { /* Haptics are optional. */ }
}

const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function hexToBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) throw new Error("Stored access data is invalid.");
  return new Uint8Array(value.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

async function derivePinHash(pin, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function hashesMatch(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function renderAccessGate() {
  document.body.classList.add("access-locked");
  operatorStatus.hidden = true;
  const isSetup = !authRecord;
  app.innerHTML = `
    <section class="access-page">
      <article class="access-card">
        <span class="access-mark" aria-hidden="true">P</span>
        <p class="eyebrow">Offline teller station</p>
        <h1>${isSetup ? "Set up teller access" : "Unlock PATTS POS"}</h1>
        <p>${isSetup ? "Create the local teller profile for this device. The PIN is stored as a one-way hash and never leaves the tablet." : `Enter the PIN for <strong>${escapeHtml(authRecord.value.tellerName)}</strong>.`}</p>
        <form id="access-form" class="access-form">
          ${isSetup ? `<label>Teller name<input name="tellerName" required maxlength="60" autocomplete="name" placeholder="Cashier or teller name" /></label>` : ""}
          <label>${isSetup ? "Create PIN" : "Teller PIN"}<input name="pin" required inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="${isSetup ? "new-password" : "current-password"}" placeholder="4–8 digits" /></label>
          ${isSetup ? `<label>Confirm PIN<input name="confirmPin" required inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" placeholder="Repeat PIN" /></label>` : ""}
          <p class="form-error" id="access-error" role="alert"></p>
          <button class="button button-primary" type="submit">${isSetup ? "Create teller access" : "Unlock station"}</button>
        </form>
        <small class="access-note">Local prototype security · no internet connection required</small>
      </article>
    </section>`;
  document.title = `${isSetup ? "Set up" : "Unlock"} · PATTS POS`;
  requestAnimationFrame(() => document.querySelector('#access-form input')?.focus());
}

async function handleAccessSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const error = form.querySelector("#access-error");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  const pin = String(data.get("pin"));
  button.disabled = true;
  error.textContent = "";
  try {
    if (!/^\d{4,8}$/.test(pin)) throw new Error("Use a PIN containing 4 to 8 digits.");
    if (!authRecord) {
      const tellerName = String(data.get("tellerName")).trim();
      if (!tellerName) throw new Error("Enter the teller name.");
      if (pin !== String(data.get("confirmPin"))) throw new Error("The PIN entries do not match.");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      authRecord = { key: "auth", value: { tellerName, salt: bytesToHex(salt), hash: await derivePinHash(pin, salt), createdAt: new Date().toISOString() } };
      await putOne(db, stores.SETTINGS, authRecord);
    } else {
      const attemptedHash = await derivePinHash(pin, hexToBytes(authRecord.value.salt));
      if (!hashesMatch(attemptedHash, authRecord.value.hash)) {
        failedPinAttempts += 1;
        const remaining = 5 - failedPinAttempts;
        await confirmWithHaptics("ERROR");
        if (remaining <= 0) {
          button.disabled = true;
          throw new Error("Too many attempts. Close and reopen the app to try again.");
        }
        throw new Error(`Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
      }
    }
    authenticated = true;
    failedPinAttempts = 0;
    operatorName = authRecord.value.tellerName;
    document.body.classList.remove("access-locked");
    operatorStatus.textContent = `${operatorName} · Lock`;
    operatorStatus.hidden = false;
    await confirmWithHaptics();
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    showToast(`Station unlocked for ${operatorName}.`);
  } catch (cause) {
    error.textContent = cause.message;
    if (failedPinAttempts < 5) button.disabled = false;
  }
}

function route() {
  const requested = location.hash.slice(1);
  return ["wallet", "students", "activity", "settings"].includes(requested) ? requested : "wallet";
}

function showToast(message, tone = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("is-open");
  toastTimer = setTimeout(() => toast.classList.remove("is-open"), 2800);
}

async function refreshData() {
  students = (await getAll(db, stores.STUDENTS)).sort((a, b) => a.name.localeCompare(b.name));
  transactions = (await getAll(db, stores.TRANSACTIONS)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!students.some((student) => student.id === activeStudentId)) activeStudentId = students[0]?.id ?? null;
}

function updateNavigation() {
  const current = route();
  document.querySelectorAll("[data-route]").forEach((link) => {
    const active = link.dataset.route === current;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
}

function avatar(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function transactionLabel(type) {
  return type === TRANSACTION_TYPES.PAYMENT ? "Payment" : "Funds added";
}

function matchingStudents() {
  return filterStudents(students, studentQuery);
}

function renderStudentOptions() {
  const matches = matchingStudents();
  if (!matches.length) return `<div class="search-empty"><strong>No wallet found</strong><span>Try a name, student ID, or program.</span><button class="text-button" data-action="clear-search">Clear search</button></div>`;
  return matches.map((item) => `<button class="student-option ${item.id === activeStudentId ? "selected" : ""}" data-student-id="${escapeHtml(item.id)}"><span class="avatar">${avatar(item.name)}</span><span class="student-option-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></span><span class="student-option-balance">${formatPeso(item.balance)}</span></button>`).join("");
}

function renderStudentCards() {
  const matches = matchingStudents();
  if (!matches.length) return `<div class="search-empty wide"><strong>No students match “${escapeHtml(studentQuery)}”</strong><span>Search by full or partial name, student ID, or program.</span><button class="text-button" data-action="clear-search">Clear search</button></div>`;
  return matches.map((student) => `<button class="student-card" data-open-student="${escapeHtml(student.id)}"><span class="avatar large">${avatar(student.name)}</span><span class="student-card-copy"><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.id)}</small><small>${escapeHtml(student.program)}</small></span><span class="student-card-balance"><small>Balance</small><b>${formatPeso(student.balance)}</b></span></button>`).join("");
}

function initializeMotion() {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!gsap || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger?.getAll().forEach((trigger) => trigger.kill());
  gsap.fromTo(".page-intro > *", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, stagger: 0.08, ease: "power3.out" });
  gsap.fromTo(".wallet-card, .amount-panel, .surface, .metric-row article", { y: 24, opacity: 0, scale: 0.985 }, { y: 0, opacity: 1, scale: 1, duration: 0.72, stagger: 0.07, ease: "power3.out" });
  gsap.fromTo(".student-card, .transaction-row", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.46, stagger: 0.025, ease: "power2.out" });
  if (ScrollTrigger && innerWidth >= 1100 && document.querySelector(".wallet-bento")) {
    ScrollTrigger.create({ trigger: ".wallet-bento", start: "top 92px", end: "bottom bottom", pin: ".student-picker", pinSpacing: false });
  }
}

function renderTransactionRows(items, emptyText = "No transactions recorded yet.") {
  if (!items.length) return `<div class="empty-state"><strong>Nothing here yet</strong><p>${emptyText}</p></div>`;
  return `<div class="transaction-list">${items.map((item) => `
    <article class="transaction-row">
      <span class="transaction-icon ${item.type}" aria-hidden="true">${item.type === TRANSACTION_TYPES.PAYMENT ? "−" : "+"}</span>
      <div><strong>${escapeHtml(transactionLabel(item.type))}</strong><span>${escapeHtml(item.studentName)} · ${new Date(item.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} · ${escapeHtml(item.teller || "Unknown teller")}</span></div>
      <div class="transaction-amount ${item.type}">${item.type === TRANSACTION_TYPES.PAYMENT ? "−" : "+"}${formatPeso(item.amount)}<small>Bal. ${formatPeso(item.newBalance)}</small></div>
    </article>`).join("")}</div>`;
}

function renderWallet() {
  const student = students.find((item) => item.id === activeStudentId);
  if (!student) return `<section class="page"><div class="page-head"><div><p class="eyebrow">Teller station</p><h1>Student wallet</h1></div></div><div class="empty-state"><strong>No student wallets</strong><p>Create a student wallet to begin.</p><button class="button button-primary" data-action="new-student">Create student</button></div></section>`;
  const amountPreview = enteredCentavos ? formatPeso(Number(enteredCentavos)) : "₱0.00";
  const recent = transactions.filter((item) => item.studentId === student.id).slice(0, 4);
  return `
    <section class="page wallet-page">
      <div class="page-intro"><div><p class="eyebrow">Offline wallet console</p><h1>Move through the line, faster.</h1><p>Select a student, enter an amount, and confirm. Every action stays on this device.</p></div><button class="button button-scan" data-action="simulate-tap"><span class="scan-wave" aria-hidden="true"></span> Simulate ID tap</button></div>
      <div class="wallet-bento">
        <aside class="student-picker" aria-label="Student wallets">
          <div class="panel-heading"><div><span>Student directory</span><strong>${students.length} wallets</strong></div><button class="mini-action" data-action="new-student" aria-label="Create student wallet">New</button></div>
          <label class="search-field"><span class="search-glyph" aria-hidden="true"></span><input type="search" data-student-search placeholder="Search name, ID, or program" value="${escapeHtml(studentQuery)}" autocomplete="off" /></label>
          <div id="student-picker-list" class="student-picker-list" aria-live="polite">${renderStudentOptions()}</div>
        </aside>
        <article class="wallet-card">
          <div class="wallet-orbit" aria-hidden="true"></div>
          <div class="wallet-card-top"><span class="wallet-chip" aria-hidden="true"></span><span>PATTS STUDENT WALLET</span></div>
          <div class="balance-block"><p>Available balance</p><strong class="balance">${formatPeso(student.balance)}</strong></div>
          <div class="wallet-owner"><span class="avatar light">${avatar(student.name)}</span><span><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.id)}</small></span><span class="program-name">${escapeHtml(student.program)}</span></div>
        </article>
        <section class="amount-panel">
          <div class="panel-heading"><div><span>Transaction</span><strong>Enter amount</strong></div><span class="secure-copy">Local only</span></div>
          <div class="amount-display"><span>PHP</span><strong>${amountPreview.replace("₱", "")}</strong></div>
          <div class="quick-amounts" aria-label="Quick amounts">${[5000,10000,20000].map((amount) => `<button data-quick-amount="${amount}">${formatPeso(amount)}</button>`).join("")}</div>
          <div class="keypad" aria-label="Amount keypad">${[1,2,3,4,5,6,7,8,9,"00",0,"←"].map((key) => `<button data-key="${key}" aria-label="${key === "←" ? "Delete digit" : `Enter ${key}`}">${key}</button>`).join("")}</div>
          <div class="transaction-actions"><button class="button button-payment" data-action="payment" ${enteredCentavos ? "" : "disabled"}>Deduct</button><button class="button button-topup" data-action="topup" ${enteredCentavos ? "" : "disabled"}>Add funds</button></div>
        </section>
        <section class="recent-section"><div class="section-head"><div><span>Selected wallet</span><h2>Recent movement</h2></div><a href="#activity">Full ledger</a></div>${renderTransactionRows(recent, "This wallet has no transactions yet.")}</section>
      </div>
    </section>`;
}

function renderStudents() {
  const matches = matchingStudents();
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Wallet directory</p><h1>Every student, one tap away.</h1><p>${students.length} wallets stored locally on this device.</p></div><button class="button button-primary" data-action="new-student">Create wallet</button></div><div class="directory-toolbar"><label class="search-field large"><span class="search-glyph" aria-hidden="true"></span><input type="search" data-student-search placeholder="Search name, ID, or program" value="${escapeHtml(studentQuery)}" autocomplete="off" /></label><span id="search-count">${matches.length} result${matches.length === 1 ? "" : "s"}</span></div><div class="student-grid" id="student-grid" aria-live="polite">${renderStudentCards()}</div></section>`;
}

function renderActivity() {
  const payments = transactions.filter((item) => item.type === TRANSACTION_TYPES.PAYMENT).reduce((sum, item) => sum + item.amount, 0);
  const topups = transactions.filter((item) => item.type === TRANSACTION_TYPES.TOP_UP).reduce((sum, item) => sum + item.amount, 0);
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Local ledger</p><h1>A clear record of every movement.</h1><p>Newest transactions appear first and remain available offline.</p></div></div><div class="metric-row"><article class="metric-feature"><span>Total activity</span><strong>${transactions.length}</strong><small>Recorded transactions</small></article><article><span>Payments</span><strong>${formatPeso(payments)}</strong></article><article><span>Funds added</span><strong>${formatPeso(topups)}</strong></article></div><section class="surface ledger-surface"><div class="section-head"><div><span>Audit trail</span><h2>Transaction history</h2></div><span class="local-label">On-device storage</span></div>${renderTransactionRows(transactions)}</section></section>`;
}

function renderSettings() {
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Device controls</p><h1>Keep the station ready.</h1><p>Protect, move, or reset data stored on this device.</p></div></div><div class="settings-layout">
    <section class="surface settings-section"><h2>Data backup</h2><p>Export a JSON backup before clearing Chrome data or changing devices.</p><div class="button-row"><button class="button button-primary" data-action="export">Export backup</button><button class="button button-quiet" data-action="import">Restore backup</button></div></section>
    <section class="surface settings-section"><h2>Prototype status</h2><dl><div><dt>Storage</dt><dd>IndexedDB, local device only</dd></div><div><dt>Network</dt><dd>Not required after installation</dd></div><div><dt>Card reader</dt><dd>Simulated until hardware arrives</dd></div><div><dt>Teller</dt><dd>${escapeHtml(operatorName)} · PIN protected</dd></div></dl><button class="button button-quiet" data-action="lock">Lock teller station</button></section>
    <section class="surface settings-section danger-zone"><h2>Reset prototype</h2><p>Deletes local transactions and restores the 20 demo wallets.</p><button class="button button-danger" data-action="reset">Reset demo data</button></section>
  </div></section>`;
}

function render() {
  if (!authenticated) return renderAccessGate();
  updateNavigation();
  const current = route();
  app.innerHTML = current === "wallet" ? renderWallet() : current === "students" ? renderStudents() : current === "activity" ? renderActivity() : renderSettings();
  document.title = `${current[0].toUpperCase()}${current.slice(1)} · PATTS POS`;
  requestAnimationFrame(initializeMotion);
}

async function processTransaction(type) {
  const student = students.find((item) => item.id === activeStudentId);
  if (!student) return;
  try {
    if (!enteredCentavos) throw new Error("Enter an amount first.");
    const amount = Number(enteredCentavos);
    const nextBalance = calculateBalance(student.balance, type, amount);
    pendingTransaction = createTransaction({ student, type, amount, teller: operatorName });
    const label = type === TRANSACTION_TYPES.PAYMENT ? "Deduct payment" : "Add funds";
    document.querySelector("#transaction-dialog-title").textContent = label;
    document.querySelector("#confirm-transaction-button").textContent = `Confirm ${type === TRANSACTION_TYPES.PAYMENT ? "deduction" : "addition"}`;
    transactionSummary.innerHTML = `<dl><div><dt>Student</dt><dd>${escapeHtml(student.name)}</dd></div><div><dt>Student ID</dt><dd>${escapeHtml(student.id)}</dd></div><div><dt>${type === TRANSACTION_TYPES.PAYMENT ? "Amount to deduct" : "Amount to add"}</dt><dd>${formatPeso(amount)}</dd></div><div class="summary-total"><dt>New balance</dt><dd>${formatPeso(nextBalance)}</dd></div></dl>`;
    document.querySelector("#transaction-error").textContent = "";
    transactionDialog.showModal();
  } catch (error) {
    await confirmWithHaptics("ERROR");
    showToast(error.message, "error");
    document.querySelector(".amount-panel")?.classList.add("attention");
    setTimeout(() => document.querySelector(".amount-panel")?.classList.remove("attention"), 900);
  }
}

async function commitPendingTransaction(event) {
  event.preventDefault();
  if (!pendingTransaction) return;
  const button = document.querySelector("#confirm-transaction-button");
  const error = document.querySelector("#transaction-error");
  button.disabled = true;
  try {
    const student = students.find((item) => item.id === pendingTransaction.studentId);
    if (!student) throw new Error("The selected student wallet is no longer available.");
    const transaction = pendingTransaction;
    await commitTransaction(db, student, transaction);
    pendingTransaction = null; enteredCentavos = "";
    transactionDialog.close();
    await refreshData(); render();
    await confirmWithHaptics();
    showToast(transaction.type === TRANSACTION_TYPES.PAYMENT ? `Payment of ${formatPeso(transaction.amount)} deducted.` : `${formatPeso(transaction.amount)} added to wallet.`);
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    button.disabled = false;
  }
}

function handleKey(key) {
  if (key === "←") enteredCentavos = enteredCentavos.slice(0, -1);
  else if (enteredCentavos.length < 8) enteredCentavos += String(key);
  enteredCentavos = enteredCentavos.replace(/^0+(?=\d)/, "");
  render();
}

function simulateTap() {
  if (!students.length) return;
  const index = Math.max(0, students.findIndex((item) => item.id === activeStudentId));
  activeStudentId = students[(index + 1) % students.length].id;
  enteredCentavos = ""; render();
  showToast(`ID recognized: ${students.find((item) => item.id === activeStudentId).name}`);
}

async function createStudent(event) {
  event.preventDefault();
  const data = new FormData(studentForm);
  const error = document.querySelector("#student-form-error");
  try {
    const id = String(data.get("id")).trim();
    if (await getOne(db, stores.STUDENTS, id)) throw new Error("That student ID already has a wallet.");
    const rawBalance = String(data.get("balance")).trim();
    const balance = !rawBalance || rawBalance === "0" || rawBalance === "0.00" ? 0 : pesosToCentavos(rawBalance);
    await putOne(db, stores.STUDENTS, { id, name: String(data.get("name")).trim(), program: String(data.get("program")).trim() || "Program not specified", balance, active: true });
    activeStudentId = id; await refreshData(); studentDialog.close(); studentForm.reset(); location.hash = "wallet"; render(); showToast("Student wallet created.");
  } catch (cause) { error.textContent = cause.message; }
}

async function exportBackup() {
  const settings = await getAll(db, stores.SETTINGS);
  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), students, transactions, settings }, null, 2);
  const filename = `patts-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const filesystem = nativePlugin("Filesystem");
  const share = nativePlugin("Share");
  if (filesystem && share) {
    const result = await filesystem.writeFile({ path: filename, data, directory: "CACHE", encoding: "utf8" });
    await share.share({ title: "PATTS POS backup", text: "Student wallet backup. Store this file securely.", url: result.uri, dialogTitle: "Save or share backup" });
    showToast("Backup ready to save or share.");
    return;
  }
  const blob = new Blob([data], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  showToast("Backup exported.");
}

async function restoreBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (!Array.isArray(backup.students) || !Array.isArray(backup.transactions) || !Array.isArray(backup.settings)) throw new Error("This is not a valid PATTS POS backup.");
    await clearAndRestore(db, backup);
    authRecord = await getOne(db, stores.SETTINGS, "auth");
    authenticated = false; operatorName = "";
    await refreshData(); render(); showToast("Backup restored. Unlock with the restored teller PIN.");
  } catch (error) { showToast(error.message, "error"); } finally { backupInput.value = ""; }
}

document.addEventListener("click", async (event) => {
  const key = event.target.closest("[data-key]")?.dataset.key;
  if (key !== undefined) return handleKey(key);
  const quickAmount = event.target.closest("[data-quick-amount]")?.dataset.quickAmount;
  if (quickAmount) { enteredCentavos = quickAmount; return render(); }
  const studentId = event.target.closest("[data-student-id]")?.dataset.studentId;
  if (studentId) { activeStudentId = studentId; enteredCentavos = ""; return render(); }
  const openStudent = event.target.closest("[data-open-student]")?.dataset.openStudent;
  if (openStudent) { activeStudentId = openStudent; location.hash = "wallet"; return; }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "payment") return processTransaction(TRANSACTION_TYPES.PAYMENT);
  if (action === "topup") return processTransaction(TRANSACTION_TYPES.TOP_UP);
  if (action === "simulate-tap") return simulateTap();
  if (action === "new-student") { document.querySelector("#student-form-error").textContent = ""; return studentDialog.showModal(); }
  if (action === "close-dialog") { studentForm.reset(); return studentDialog.close(); }
  if (action === "close-transaction") { pendingTransaction = null; return transactionDialog.close(); }
  if (action === "export") return exportBackup();
  if (action === "import") return backupInput.click();
  if (action === "clear-search") { studentQuery = ""; return render(); }
  if (action === "lock") {
    authenticated = false; operatorName = ""; enteredCentavos = "";
    return render();
  }
  if (action === "reset" && confirm("Reset all local prototype data? Export a backup first if you need these records.")) { await resetDatabase(db); await refreshData(); render(); showToast("Demo data restored."); }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "access-form") handleAccessSubmit(event);
});

document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-student-search]")) return;
  studentQuery = event.target.value;
  const picker = document.querySelector("#student-picker-list");
  if (picker) picker.innerHTML = renderStudentOptions();
  const grid = document.querySelector("#student-grid");
  if (grid) grid.innerHTML = renderStudentCards();
  const count = document.querySelector("#search-count");
  const total = matchingStudents().length;
  if (count) count.textContent = `${total} result${total === 1 ? "" : "s"}`;
});

studentForm.addEventListener("submit", createStudent);
transactionForm.addEventListener("submit", commitPendingTransaction);
transactionDialog.addEventListener("close", () => { pendingTransaction = null; });
backupInput.addEventListener("change", () => backupInput.files[0] && restoreBackup(backupInput.files[0]));
window.addEventListener("hashchange", render);
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false; });
installButton.addEventListener("click", async () => { deferredInstallPrompt?.prompt(); await deferredInstallPrompt?.userChoice; deferredInstallPrompt = null; installButton.hidden = true; });

function updateConnection() {
  const online = navigator.onLine;
  connectionStatus.classList.toggle("online", online);
  connectionStatus.querySelector("span:last-child").textContent = online ? "Online · local mode" : "Offline ready";
}

async function initialize() {
  try {
    db = await openDatabase(); await seedDatabase(db); authRecord = await getOne(db, stores.SETTINGS, "auth"); await refreshData(); updateConnection(); render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    app.innerHTML = `<div class="fatal-error"><h1>Unable to open local storage</h1><p>${escapeHtml(error.message)}</p><p>Try allowing site storage in Chrome and reload.</p></div>`;
  }
}

initialize();
