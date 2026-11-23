import { clearAndRestore, commitTransaction, deleteOne, deleteStudent, getAll, getOne, linkStudentCard, openDatabase, putOne, resetDatabase, seedDatabase, stores } from "./db.js";
import { formatPeso, pesosToCentavos, TRANSACTION_TYPES } from "./wallet.js";
import { filterStudents } from "./students.js";
import { findStudentByCard, normalizeCardKey, resolveCardScan } from "./cards.js";
import { createAuthRecord, PIN_ATTEMPT_LIMIT, recordFailedPin, remainingLockoutMs, verifyPin } from "./access.js";
import { createBackup, parseBackup } from "./backup.js";
import { prepareTransaction, updateEnteredCentavos } from "./checkout.js";
import { buildInventoryItem } from "./inventory.js";
import { addItemToOrder, addManualAmountToOrder, adjustOrderLine, orderItemCount, orderNote, orderTotal } from "./order.js";
import { buildReaderReport, cardResult, parseReaderReport, USB_READER_FILTER } from "./reader-protocol.js";
import { escapeHtml, getRoute, renderAppView, renderStudentCards, renderStudentOptions } from "./views.js";

import { appendReaderDiagnostic, readerDiagnostic } from "./reader-diagnostics.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const studentDialog = document.querySelector("#student-dialog");
const studentForm = document.querySelector("#student-form");
const transactionDialog = document.querySelector("#transaction-dialog");
const transactionForm = document.querySelector("#transaction-form");
const transactionSummary = document.querySelector("#transaction-summary");
const cardDialog = document.querySelector("#card-dialog");
const cardForm = document.querySelector("#card-form");
const cardSummary = document.querySelector("#card-summary");
const itemDialog = document.querySelector("#item-dialog");
const itemForm = document.querySelector("#item-form");
const backupInput = document.querySelector("#backup-input");
const installButton = document.querySelector("#install-button");
const connectionStatus = document.querySelector("#connection-status");
const operatorStatus = document.querySelector("#operator-status");
const headerReaderStatus = document.querySelector("#header-reader-status");
const navigationDrawer = document.querySelector("#primary-navigation");
const navigationScrim = document.querySelector(".navigation-scrim");
const menuButton = document.querySelector(".menu-button");

let db;
let students = [];
let transactions = [];
let items = [];
let activeStudentId = null;
let enteredCentavos = "";
let deferredInstallPrompt = null;
let toastTimer;
let authenticated = false;
let operatorName = "";
let authRecord = null;
let authThrottle = null;
let pendingTransaction = null;
let pendingOrderCharge = false;
let studentQuery = "";
let readerStatus = "Checking reader…";
let readerBusy = false;
let readerReady = false;
let useSimulatedReader = true;
let pendingCard = null;
let repairingCard = false;
let readerDiagnosticQueue = Promise.resolve();
let cardForNewStudent = null;
let activeOrderItems = [];
let transactionMode = TRANSACTION_TYPES.PAYMENT;
let itemQuery = "";
let itemCategory = "all";
let activityStudentId = "";
let checkoutControlsCollapsed = true;
let editingStudentId = null;
let manualLineSequence = 0;
let autoReaderTimer = null;
let lastCardStudentId = null;
let studentSelectionRevision = 0;
let lastMotionRoute = null;

const nativePlugin = (name) => window.Capacitor?.Plugins?.[name];
const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
const supportsWebHid = "hid" in navigator;
useSimulatedReader = !nativePlugin("NfcReader") && !supportsWebHid;
let preferredWebCardType = "HF";
const CARD_PROBE_TIMEOUT_MS = { HF: 1400, LF: 4200 };

function exchangeWebHid(device, command, payload, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => { device.removeEventListener("inputreport", onReport); resolve(null); }, timeoutMs);
    function onReport(event) {
      const response = parseReaderReport(event.data, command);
      if (!response) return;
      clearTimeout(timeout); device.removeEventListener("inputreport", onReport); resolve(response);
    }
    device.addEventListener("inputreport", onReport);
    try { await device.sendReport(0, buildReaderReport(command, payload)); }
    catch (error) { clearTimeout(timeout); device.removeEventListener("inputreport", onReport); reject(error); }
  });
}

async function scanWebHid() {
  let [device] = (await navigator.hid.getDevices()).filter((item) => item.vendorId === USB_READER_FILTER.vendorId && item.productId === USB_READER_FILTER.productId);
  if (!device) [device] = await navigator.hid.requestDevice({ filters: [USB_READER_FILTER] });
  if (!device) throw new Error("No NFC-X reader was selected.");
  if (!device.opened) await device.open();
  const probes = preferredWebCardType === "LF"
    ? [["LF", 0x0072, [0, 0]], ["HF", 0x0069, []]]
    : [["HF", 0x0069, []], ["LF", 0x0072, [0, 0]]];
  let cardType = preferredWebCardType;
  let payload = null;
  for (const [type, command, commandPayload] of probes) {
    cardType = type;
    payload = await exchangeWebHid(device, command, commandPayload, CARD_PROBE_TIMEOUT_MS[type]);
    if (payload?.length > 1 && payload[0] !== 0) break;
    payload = null;
  }
  if (!payload) throw new Error("No card detected. Hold the card on the reader and try again.");
  preferredWebCardType = cardType;
  return cardResult(cardType, payload, device.productName || "NFC-X reader");
}

async function confirmWithHaptics(type = "SUCCESS") {
  try { await nativePlugin("Haptics")?.notification({ type }); } catch { /* Haptics are optional. */ }
}

function renderAccessGate() {
  document.body.classList.add("access-locked");
  document.body.classList.remove("checkout-active");
  operatorStatus.hidden = true;
  headerReaderStatus.hidden = true;
  setNavigationOpen(false);
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
        ${!isNativeApp ? `<button class="text-button" type="button" data-action="demo-session">Continue with a temporary demo session</button>` : ""}
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
    if (!authRecord) {
      authRecord = await createAuthRecord({ tellerName: data.get("tellerName"), pin, confirmPin: String(data.get("confirmPin")) });
      await putOne(db, stores.SETTINGS, authRecord);
    } else {
      const lockoutMs = remainingLockoutMs(authThrottle);
      if (lockoutMs) throw new Error(`Too many attempts. Try again in ${Math.ceil(lockoutMs / 1000)} seconds.`);
      if (!await verifyPin(pin, authRecord)) {
        authThrottle = recordFailedPin(authThrottle);
        await putOne(db, stores.SETTINGS, authThrottle);
        const remaining = PIN_ATTEMPT_LIMIT - authThrottle.value.failures;
        await confirmWithHaptics("ERROR");
        if (authThrottle.value.lockedUntil) throw new Error("Too many attempts. Try again in 30 seconds.");
        throw new Error(`Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
      }
    }
    authenticated = true;
    authThrottle = null;
    await deleteOne(db, stores.SETTINGS, "authThrottle");
    operatorName = authRecord.value.tellerName;
    document.body.classList.remove("access-locked");
    operatorStatus.textContent = `${operatorName} · Lock`;
    operatorStatus.hidden = false;
    await confirmWithHaptics();
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    showToast(`Station unlocked for ${operatorName}.`);
    scheduleAutoReader(0);
  } catch (cause) {
    error.textContent = cause.message;
    const lockoutMs = remainingLockoutMs(authThrottle);
    if (lockoutMs) {
      setTimeout(() => { button.disabled = false; error.textContent = ""; }, lockoutMs + 50);
    } else {
      button.disabled = false;
    }
  }
}

function route() {
  return getRoute(location.hash);
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
  items = (await getAll(db, stores.ITEMS)).sort((a, b) => a.name.localeCompare(b.name));
  if (!students.some((student) => student.id === activeStudentId)) activeStudentId = null;
  if (!students.some((student) => student.id === activityStudentId)) activityStudentId = "";
}

function updateNavigation() {
  const current = route();
  document.querySelectorAll("[data-route]").forEach((link) => {
    const active = link.dataset.route === current;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
}

function setNavigationOpen(open) {
  navigationDrawer.classList.toggle("is-open", open);
  navigationDrawer.setAttribute("aria-hidden", String(!open));
  navigationDrawer.inert = !open;
  navigationScrim.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("navigation-open", open);
  if (open) navigationDrawer.querySelector("[data-action='close-navigation']")?.focus();
}

function updateHeaderReader() {
  headerReaderStatus.hidden = !authenticated;
  if (!authenticated) return;
  const title = headerReaderStatus.querySelector("strong");
  const detail = headerReaderStatus.querySelector("small");
  headerReaderStatus.classList.toggle("is-ready", readerReady);
  headerReaderStatus.classList.toggle("is-simulated", useSimulatedReader);
  headerReaderStatus.disabled = readerBusy;
  if (useSimulatedReader) {
    headerReaderStatus.dataset.action = "simulate-tap";
    headerReaderStatus.setAttribute("aria-label", "Simulate student card tap");
    title.textContent = "Demo reader";
    detail.textContent = "Tap to simulate";
  } else if (readerReady) {
    headerReaderStatus.dataset.action = "connect-reader";
    headerReaderStatus.setAttribute("aria-label", "Scan a student card");
    title.textContent = "Reader ready";
    detail.textContent = "Tap student card";
  } else {
    headerReaderStatus.dataset.action = "connect-reader";
    headerReaderStatus.setAttribute("aria-label", readerBusy ? "Connecting NFC reader" : "Enable NFC reader");
    title.textContent = readerBusy ? "Connecting…" : "Reader offline";
    detail.textContent = readerBusy ? "Please wait" : "Tap to enable";
  }
}

function matchingStudents() {
  return filterStudents(students, studentQuery);
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

function render() {
  if (!authenticated) return renderAccessGate();
  updateNavigation();
  updateHeaderReader();
  const current = route();
  document.body.classList.toggle("checkout-active", current === "wallet");
  app.innerHTML = renderAppView(current, {
    students, transactions, items, activeStudentId, enteredCentavos, activeOrderItems, transactionMode, itemQuery, itemCategory,
    activityStudentId, checkoutControlsCollapsed,
    studentQuery, readerStatus, readerBusy, readerReady, useSimulatedReader, operatorName,
  });
  document.title = `${current[0].toUpperCase()}${current.slice(1)} · PATTS POS`;
  if (lastMotionRoute !== current) {
    lastMotionRoute = current;
    requestAnimationFrame(initializeMotion);
  }
}

async function processTransaction(type) {
  const student = students.find((item) => item.id === activeStudentId);
  try {
    const isOrderCharge = type === TRANSACTION_TYPES.PAYMENT;
    const transactionAmount = isOrderCharge ? String(orderTotal(activeOrderItems)) : enteredCentavos;
    const note = isOrderCharge ? orderNote(activeOrderItems) : "";
    const { amount, newBalance, transaction } = prepareTransaction({ student, type, enteredCentavos: transactionAmount, note, teller: operatorName });
    pendingTransaction = transaction;
    pendingOrderCharge = isOrderCharge;
    const label = type === TRANSACTION_TYPES.PAYMENT ? "Deduct payment" : "Add funds";
    document.querySelector("#transaction-dialog-title").textContent = label;
    document.querySelector("#confirm-transaction-button").textContent = `Confirm ${type === TRANSACTION_TYPES.PAYMENT ? "deduction" : "addition"}`;
    transactionSummary.innerHTML = `${type === TRANSACTION_TYPES.TOP_UP ? `<div class="topup-confirm-warning"><strong>Add funds confirmation</strong><span>This will increase the student's wallet balance. No payment will be deducted.</span></div>` : ""}<dl><div><dt>Student</dt><dd>${escapeHtml(student.name)}</dd></div><div><dt>Student ID</dt><dd>${escapeHtml(student.id)}</dd></div>${isOrderCharge ? `<div><dt>Order</dt><dd>${orderItemCount(activeOrderItems)} item${orderItemCount(activeOrderItems) === 1 ? "" : "s"}</dd></div>` : ""}<div><dt>${type === TRANSACTION_TYPES.PAYMENT ? "Amount to deduct" : "Amount to add"}</dt><dd>${formatPeso(amount)}</dd></div><div class="summary-total"><dt>New balance</dt><dd>${formatPeso(newBalance)}</dd></div></dl>`;
    document.querySelector("#transaction-error").textContent = "";
    transactionDialog.showModal();
  } catch (error) {
    await confirmWithHaptics("ERROR");
    showToast(error.message, "error");
    const attentionPanel = document.querySelector(type === TRANSACTION_TYPES.PAYMENT ? ".order-panel" : ".keypad-panel");
    attentionPanel?.classList.add("attention");
    setTimeout(() => attentionPanel?.classList.remove("attention"), 900);
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
    if (pendingOrderCharge) activeOrderItems = [];
    transactionMode = TRANSACTION_TYPES.PAYMENT;
    checkoutControlsCollapsed = true;
    pendingOrderCharge = false;
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
  enteredCentavos = updateEnteredCentavos(enteredCentavos, key);
  render();
}

function simulateTap() {
  if (!students.length) return;
  const index = Math.max(0, students.findIndex((item) => item.id === activeStudentId));
  activeStudentId = students[(index + 1) % students.length].id;
  enteredCentavos = ""; activeOrderItems = []; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; render();
  showToast(`ID recognized: ${students.find((item) => item.id === activeStudentId).name}`);
}

async function updateReaderStatus() {
  const reader = nativePlugin("NfcReader");
  if (!reader && supportsWebHid) {
    useSimulatedReader = false;
    try {
      const granted = (await navigator.hid.getDevices()).some((item) => item.vendorId === USB_READER_FILTER.vendorId && item.productId === USB_READER_FILTER.productId);
      readerReady = granted;
      readerStatus = granted ? "NFC-X USB reader authorized · automatic detection active" : "USB reader connected after one-time authorization";
    } catch {
      readerReady = false;
      readerStatus = "USB reader authorization unavailable";
    }
    return;
  }
  if (!reader) { useSimulatedReader = true; readerReady = false; readerStatus = "Simulation mode (unsupported browser)"; return; }
  try {
    const status = await reader.status();
    useSimulatedReader = Boolean(status.emulator && !status.bridge);
    readerReady = !useSimulatedReader && Boolean(status.connected && status.permissionGranted);
    if (useSimulatedReader) { readerStatus = "Simulation mode (start the PC NFC-X bridge for real cards)"; return; }
    readerStatus = status.connected
      ? `${status.reader || "NFC-X reader"} connected${status.permissionGranted ? " · automatic detection active" : " · authorization needed"}`
      : "Connect NFC-X reader via USB OTG";
  } catch { readerReady = false; readerStatus = "Reader status unavailable"; }
}

function recordReaderDiagnostic(event, card, student = null) {
  const entry = readerDiagnostic(event, card, student);
  readerDiagnosticQueue = readerDiagnosticQueue.then(async () => {
    const saved = await getOne(db, stores.SETTINGS, "nfcDiagnostics");
    await putOne(db, stores.SETTINGS, { key: "nfcDiagnostics", value: appendReaderDiagnostic(saved?.value, entry) });
  }).catch(() => { /* Support history must not block card use. */ });
  return readerDiagnosticQueue;
}

function openCardEnrollment(result) {
  pendingCard = { ...result, cardKey: normalizeCardKey(result.cardKey, result.cardType) };
  repairingCard = false;
  recordReaderDiagnostic("unmatched_card", pendingCard);
  document.querySelector("#register-card-button").hidden = true;
  cardSummary.innerHTML = `<div class="card-detected"><span class="reader-ready-pulse" aria-hidden="true"></span><div><strong>Card not linked on this tablet</strong><small>${escapeHtml(pendingCard.cardKey)}</small></div></div><p class="dialog-copy">Already registered? Repair its link to the existing student. Their balance and history stay the same.</p><div class="card-choice"><button class="button button-primary" type="button" data-action="card-repair">Repair existing card</button><button class="button button-quiet" type="button" data-action="card-existing">Connect a new or replacement card</button><button class="button button-quiet" type="button" data-action="card-new">Create a new student</button></div>`;
  document.querySelector("#card-form-error").textContent = "";
  cardDialog.showModal();
}

function showExistingStudentCardLink(repair = false) {
  if (!pendingCard) return;
  repairingCard = repair;
  const options = students.map((student) => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)} &middot; ${escapeHtml(student.id)}</option>`).join("");
  cardSummary.innerHTML = `<div class="card-detected"><span class="reader-ready-pulse" aria-hidden="true"></span><div><strong>${repair ? "Repair this card's link" : "Connect this card"}</strong><small>${escapeHtml(pendingCard.cardKey)}</small></div></div><label>Student wallet<select name="studentId" required><option value="" selected disabled>Choose the verified student</option>${options}</select></label><p class="dialog-copy">${repair ? "Use this only for the same physical card already owned by this student. The saved identifier is kept, and this reading is remembered too." : "If this student already has a linked card, connecting this one replaces that link and removes previous card repairs."}</p><label class="card-confirm"><input type="checkbox" name="confirmOwner" required /><span>I verified the student's identity and that this card belongs to them.</span></label>`;
  const button = document.querySelector("#register-card-button");
  button.textContent = repair ? "Repair card link" : "Connect card";
  button.hidden = false;
}

async function enrollCard(event) {
  event.preventDefault();
  if (!pendingCard) return;
  const error = document.querySelector("#card-form-error");
  const submitButton = document.querySelector("#register-card-button");
  submitButton.disabled = true;
  try {
    const data = new FormData(cardForm);
    if (!data.get("confirmOwner")) throw new Error("Verify the student and confirm card ownership first.");
    const studentId = String(data.get("studentId"));
    const card = { ...pendingCard };
    const repair = repairingCard;
    const previous = await getOne(db, stores.STUDENTS, studentId);
    await recordReaderDiagnostic(repair ? "repair_requested" : "connection_requested", card, previous);
    const student = await linkStudentCard(db, studentId, card, { preserveExisting: repair });
    await recordReaderDiagnostic(repair ? "repair_saved" : "connection_saved", card, student);
    activeStudentId = student.id;
    enteredCentavos = "";
    activeOrderItems = [];
    transactionMode = TRANSACTION_TYPES.PAYMENT;
    checkoutControlsCollapsed = true;
    await refreshData();
    cardDialog.close();
    await confirmWithHaptics();
    render();
    showToast(`Card linked to ${student.name}. Remove it and tap again to check.`);
  } catch (cause) {
    error.textContent = cause.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function scanCard(automatic = false) {
  const reader = nativePlugin("NfcReader");
  if (useSimulatedReader) return simulateTap();
  if (readerBusy) return;
  const selectionRevision = studentSelectionRevision;
  readerBusy = true;
  if (!automatic) render();
  try {
    const { card: result, student: match } = await resolveCardScan(
      () => reader ? reader.scan() : scanWebHid(), students,
      () => getAll(db, stores.STUDENTS),
    );
    if (!authenticated) return;
    if (document.querySelector("dialog[open]") || (automatic && selectionRevision !== studentSelectionRevision)) {
      lastCardStudentId = match?.id || null;
      return;
    }
    if (match) {
      if (automatic && match.id === lastCardStudentId) return;
      lastCardStudentId = match.id;
      if (match.cardAliases?.includes(result.cardKey)) recordReaderDiagnostic("repaired_card_recognized", result, match);
      if (students.some((student) => student.id === match.id)) {
        students = students.map((student) => student.id === match.id ? match : student);
      } else students.push(match);
      activeStudentId = match.id; enteredCentavos = "";
      activeOrderItems = []; transactionMode = TRANSACTION_TYPES.PAYMENT;
      checkoutControlsCollapsed = true;
      render();
      await confirmWithHaptics();
      showToast(`Card recognized: ${match.name}`);
      return;
    }
    lastCardStudentId = null;
    openCardEnrollment(result);
  } catch (error) {
    const message = error.message || "The card could not be read.";
    lastCardStudentId = null;
    if (/READER_NOT_CONNECTED|READER_ERROR/.test(error.code || "")) readerReady = false;
    if (!automatic) {
      if (/permission.*denied/i.test(message)) {
        await updateReaderStatus();
        if (readerReady) { render(); return; }
      }
      await confirmWithHaptics("ERROR");
      showToast(message, "error");
    }
  } finally {
    readerBusy = false;
    if (!automatic) { await updateReaderStatus(); render(); }
  }
}

function scheduleAutoReader(delay = 300) {
  clearTimeout(autoReaderTimer);
  autoReaderTimer = setTimeout(async () => {
    let nextDelay = 650;
    try {
      if (authenticated && !document.hidden && !readerBusy && !document.querySelector("dialog[open]")) {
        if (readerReady) {
          nextDelay = 100;
          await scanCard(true);
        } else {
          await updateReaderStatus();
        }
      }
    } finally {
      scheduleAutoReader(nextDelay);
    }
  }, delay);
}

function openStudentDialog(card = null, student = null) {
  cardForNewStudent = card;
  editingStudentId = student?.id || null;
  studentForm.reset();
  studentForm.elements.id.readOnly = Boolean(student);
  studentForm.elements.id.value = student?.id || "";
  studentForm.elements.name.value = student?.name || "";
  studentForm.elements.balance.value = student ? (student.balance / 100).toFixed(2) : "0.00";
  document.querySelector("#student-dialog-eyebrow").textContent = student ? "Student details" : card ? "Card registration" : "New wallet";
  document.querySelector("#student-dialog-title").textContent = student ? "Edit student" : card ? "Create student and connect card" : "Create student";
  document.querySelector("#student-balance-label").textContent = student ? "Current balance" : "Opening balance";
  document.querySelector("#student-submit-button").textContent = student ? "Save changes" : "Create wallet";
  document.querySelector("#student-form-error").textContent = "";
  studentDialog.showModal();
}

async function createStudent(event) {
  event.preventDefault();
  const data = new FormData(studentForm);
  const error = document.querySelector("#student-form-error");
  const submitButton = studentForm.querySelector("button[type='submit']");
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Saving…";
  error.textContent = "";
  try {
    const id = String(data.get("id")).trim();
    const existing = editingStudentId ? await getOne(db, stores.STUDENTS, editingStudentId) : null;
    if (!editingStudentId && await getOne(db, stores.STUDENTS, id)) throw new Error("That student ID already has a wallet.");
    if (editingStudentId && !existing) throw new Error("This student wallet is no longer available.");
    const rawBalance = String(data.get("balance")).trim();
    const balance = !rawBalance || rawBalance === "0" || rawBalance === "0.00" ? 0 : pesosToCentavos(rawBalance);
    const card = cardForNewStudent;
    if (card) {
      const linkedStudent = findStudentByCard(await getAll(db, stores.STUDENTS), card.cardKey, card.cardType);
      if (linkedStudent) throw new Error(`This card is already registered to ${linkedStudent.name}.`);
    }
    await putOne(db, stores.STUDENTS, { ...existing, id, name: String(data.get("name")).trim(), balance, active: true, ...(card ? { cardKey: normalizeCardKey(card.cardKey, card.cardType), cardType: card.cardType } : {}) });
    cardForNewStudent = null;
    editingStudentId = null;
    if (card) { activeStudentId = id; activeOrderItems = []; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; }
    await refreshData();
    studentDialog.close();
    studentForm.reset();
    if (card) location.hash = "wallet";
    else render();
    showToast(existing ? "Student updated." : card ? "Student created and card connected." : "Student wallet created.");
  } catch (cause) {
    error.textContent = cause.message;
    error.focus?.();
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = originalLabel;
  }
}

function openItemDialog(item = null) {
  itemForm.reset();
  itemForm.elements.id.value = item?.id || "";
  itemForm.elements.name.value = item?.name || "";
  itemForm.elements.category.value = item?.category || "service";
  itemForm.elements.price.value = item ? (item.price / 100).toFixed(2) : "";
  itemForm.elements.details.value = item?.details || "";
  document.querySelector("#item-dialog-title").textContent = item ? "Edit item" : "Add item";
  document.querySelector("#item-form-error").textContent = "";
  itemDialog.showModal();
}

async function saveItem(event) {
  event.preventDefault();
  const data = new FormData(itemForm);
  const error = document.querySelector("#item-form-error");
  try {
    const existingId = String(data.get("id") || "");
    const item = buildInventoryItem({ id: existingId, name: data.get("name"), price: data.get("price"), details: data.get("details"), category: data.get("category") });
    await putOne(db, stores.ITEMS, item);
    await refreshData();
    itemDialog.close();
    render();
    showToast(existingId ? "Item updated." : "Item added.");
  } catch (cause) { error.textContent = cause.message; }
}

async function shareReaderReport() {
  try {
    await readerDiagnosticQueue;
    const saved = await getOne(db, stores.SETTINGS, "nfcDiagnostics");
    const data = JSON.stringify({ appVersion: "0.8.2", exportedAt: new Date().toISOString(), readerStatus, events: saved?.value || [] }, null, 2);
    const filename = `patts-nfc-report-${Date.now()}.json`;
    const filesystem = nativePlugin("Filesystem");
    const share = nativePlugin("Share");
    if (filesystem && share) {
      const file = await filesystem.writeFile({ path: filename, data, directory: "CACHE", encoding: "utf8" });
      await share.share({ title: "PATTS NFC support report", files: [file.uri], dialogTitle: "Share NFC report with support" });
    } else if (filesystem) {
      await filesystem.writeFile({ path: `PATTS Reports/${filename}`, data, directory: "DOCUMENTS", encoding: "utf8", recursive: true });
      showToast("NFC report saved to Files > Documents > PATTS Reports.");
    } else {
      const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("NFC report saved to Downloads.");
    }
  } catch (error) { showToast(error.message || "The NFC report could not be shared.", "error"); }
}

async function exportBackup() {
  try {
    const settings = await getAll(db, stores.SETTINGS);
    const data = JSON.stringify(createBackup({ students, transactions, items, settings }), null, 2);
    const filename = `patts-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const filesystem = nativePlugin("Filesystem");
    if (filesystem) {
      await filesystem.writeFile({ path: `PATTS Backups/${filename}`, data, directory: "DOCUMENTS", encoding: "utf8", recursive: true });
      showToast(`Backup saved to Files > Documents > PATTS Backups > ${filename}`);
      return;
    }
    const blob = new Blob([data], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
    showToast("Backup saved to your Downloads folder.");
  } catch (error) {
    showToast(error.message || "The backup could not be saved.", "error");
  }
}

async function restoreBackup(file) {
  try {
    const backup = parseBackup(await file.text());
    await clearAndRestore(db, backup);
    authRecord = null;
    authThrottle = null;
    authenticated = false; operatorName = "";
    activeOrderItems = []; enteredCentavos = ""; activeStudentId = null; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true;
    await refreshData(); render(); showToast("Backup restored. Create teller access for this device.");
  } catch (error) { showToast(error.message, "error"); } finally { backupInput.value = ""; }
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-route]")) setNavigationOpen(false);
  const key = event.target.closest("[data-key]")?.dataset.key;
  if (key !== undefined) return handleKey(key);
  const orderControl = event.target.closest("[data-order-adjust]");
  if (orderControl) {
    activeOrderItems = adjustOrderLine(activeOrderItems, orderControl.dataset.orderLine, Number(orderControl.dataset.orderAdjust));
    return render();
  }
  const selectedCategory = event.target.closest("[data-item-category]")?.dataset.itemCategory;
  if (selectedCategory) { itemCategory = selectedCategory; return render(); }
  const itemId = event.target.closest("[data-item-id]")?.dataset.itemId;
  if (itemId) {
    const item = items.find((entry) => entry.id === itemId);
    if (item) {
      if (!activeStudentId) return showToast("Tap a registered card or choose a student first.", "error");
      if (item.transactionType === TRANSACTION_TYPES.TOP_UP) {
        transactionMode = TRANSACTION_TYPES.TOP_UP;
        activeOrderItems = [];
        enteredCentavos = "";
        checkoutControlsCollapsed = false;
        render();
        showToast("Enter the amount to add with the keypad.");
        return;
      }
      if (transactionMode === TRANSACTION_TYPES.TOP_UP) { enteredCentavos = ""; checkoutControlsCollapsed = true; }
      transactionMode = TRANSACTION_TYPES.PAYMENT;
      activeOrderItems = addItemToOrder(activeOrderItems, item);
      render();
      showToast(`${item.name} added to the order.`);
    }
    return;
  }
  const studentId = event.target.closest("[data-student-id]")?.dataset.studentId;
  if (studentId) { studentSelectionRevision++; activeStudentId = studentId; enteredCentavos = ""; activeOrderItems = []; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; return render(); }
  const useStudent = event.target.closest("[data-use-student]")?.dataset.useStudent;
  if (useStudent) { studentSelectionRevision++; activeStudentId = useStudent; enteredCentavos = ""; activeOrderItems = []; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; location.hash = "wallet"; return; }
  const editStudent = event.target.closest("[data-edit-student]")?.dataset.editStudent;
  if (editStudent) return openStudentDialog(null, students.find((student) => student.id === editStudent));
  const removeStudent = event.target.closest("[data-delete-student]")?.dataset.deleteStudent;
  if (removeStudent) {
    const student = students.find((item) => item.id === removeStudent);
    if (!student) return;
    const transactionCount = transactions.filter((item) => item.studentId === removeStudent).length;
    const historyWarning = transactionCount ? ` This will also delete ${transactionCount} transaction record${transactionCount === 1 ? "" : "s"}.` : "";
    if (!confirm(`Remove ${student.name}'s wallet?${historyWarning} This cannot be undone.`)) return;
    await deleteStudent(db, removeStudent);
    if (activeStudentId === removeStudent) activeStudentId = null;
    if (activityStudentId === removeStudent) activityStudentId = "";
    await refreshData(); render(); showToast("Student wallet removed."); return;
  }
  const editItem = event.target.closest("[data-edit-item]")?.dataset.editItem;
  if (editItem) return openItemDialog(items.find((item) => item.id === editItem));
  const deleteItem = event.target.closest("[data-delete-item]")?.dataset.deleteItem;
  if (deleteItem && confirm("Delete this item from the quick-price list?")) {
    await deleteOne(db, stores.ITEMS, deleteItem);
    await refreshData(); render(); showToast("Item deleted."); return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "open-navigation") return setNavigationOpen(true);
  if (action === "close-navigation") return setNavigationOpen(false);
  if (action === "payment") return processTransaction(transactionMode);
  if (action === "topup") return processTransaction(TRANSACTION_TYPES.TOP_UP);
  if (action === "add-manual") {
    try {
      if (!activeStudentId) throw new Error("Tap a registered card or choose a student first.");
      transactionMode = TRANSACTION_TYPES.PAYMENT;
      activeOrderItems = addManualAmountToOrder(activeOrderItems, Number(enteredCentavos), ++manualLineSequence);
      enteredCentavos = "";
      render();
      showToast("Manual amount added to the order.");
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (action === "clear-order") { activeOrderItems = []; enteredCentavos = ""; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; return render(); }
  if (action === "cancel-topup") { enteredCentavos = ""; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; return render(); }
  if (action === "toggle-checkout-controls") { checkoutControlsCollapsed = !checkoutControlsCollapsed; return render(); }
  if (action === "simulate-tap") return simulateTap();
  if (action === "connect-reader") return scanCard(false);
  if (action === "card-repair") return showExistingStudentCardLink(true);
  if (action === "share-nfc-report") return shareReaderReport();
  if (action === "card-existing") return showExistingStudentCardLink();
  if (action === "card-new") {
    const detectedCard = pendingCard;
    pendingCard = null;
    cardDialog.close();
    requestAnimationFrame(() => openStudentDialog(detectedCard));
    return;
  }
  if (action === "demo-session") {
    authenticated = true; operatorName = "Demo Teller";
    document.body.classList.remove("access-locked"); operatorStatus.textContent = "Demo Teller · Lock"; operatorStatus.hidden = false;
    render(); showToast("Temporary demo session started."); scheduleAutoReader(0); return;
  }
  if (action === "new-student") return openStudentDialog();
  if (action === "close-dialog") { cardForNewStudent = null; editingStudentId = null; studentForm.elements.id.readOnly = false; studentForm.reset(); return studentDialog.close(); }
  if (action === "new-item") return openItemDialog();
  if (action === "close-item-dialog") { itemForm.reset(); return itemDialog.close(); }
  if (action === "close-transaction") { pendingTransaction = null; return transactionDialog.close(); }
  if (action === "close-card-dialog") { pendingCard = null; return cardDialog.close(); }
  if (action === "export") return exportBackup();
  if (action === "import") return backupInput.click();
  if (action === "clear-search") { studentQuery = ""; return render(); }
  if (action === "lock") {
    lastCardStudentId = null;
    authenticated = false; operatorName = ""; enteredCentavos = ""; activeOrderItems = []; activeStudentId = null; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true;
    return render();
  }
  if (action === "reset" && confirm("Reset all local prototype data? Export a backup first if you need these records.")) { await resetDatabase(db); activeOrderItems = []; enteredCentavos = ""; activeStudentId = null; transactionMode = TRANSACTION_TYPES.PAYMENT; checkoutControlsCollapsed = true; await refreshData(); render(); showToast("Demo data restored."); }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "access-form") handleAccessSubmit(event);
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-item-search]")) {
    itemQuery = event.target.value;
    const selectionStart = event.target.selectionStart;
    render();
    const search = document.querySelector("[data-item-search]");
    search?.focus();
    search?.setSelectionRange(selectionStart, selectionStart);
    return;
  }
  if (!event.target.matches("[data-student-search]")) return;
  studentQuery = event.target.value;
  const picker = document.querySelector("#student-picker-list");
  if (picker) picker.innerHTML = renderStudentOptions({ students, query: studentQuery, activeStudentId });
  const grid = document.querySelector("#student-grid");
  if (grid) grid.innerHTML = renderStudentCards({ students, query: studentQuery });
  const count = document.querySelector("#search-count");
  const total = matchingStudents().length;
  if (count) count.textContent = `${total} result${total === 1 ? "" : "s"}`;
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-activity-student]")) return;
  activityStudentId = event.target.value;
  render();
});

studentForm.addEventListener("submit", createStudent);
itemForm.addEventListener("submit", saveItem);
transactionForm.addEventListener("submit", commitPendingTransaction);
cardForm.addEventListener("submit", enrollCard);
transactionDialog.addEventListener("close", () => { pendingTransaction = null; pendingOrderCharge = false; });
cardDialog.addEventListener("close", () => { pendingCard = null; });
studentDialog.addEventListener("close", () => { cardForNewStudent = null; editingStudentId = null; studentForm.elements.id.readOnly = false; });
backupInput.addEventListener("change", () => backupInput.files[0] && restoreBackup(backupInput.files[0]));
window.addEventListener("hashchange", () => { setNavigationOpen(false); render(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && navigationDrawer.classList.contains("is-open")) { setNavigationOpen(false); menuButton.focus(); } });
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
    db = await openDatabase(); await seedDatabase(db); authRecord = await getOne(db, stores.SETTINGS, "auth"); authThrottle = await getOne(db, stores.SETTINGS, "authThrottle"); await refreshData(); await updateReaderStatus(); updateConnection(); render(); scheduleAutoReader();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    app.innerHTML = `<div class="fatal-error"><h1>Unable to open local storage</h1><p>${escapeHtml(error.message)}</p><p>Try allowing site storage in Chrome and reload.</p></div>`;
  }
}

initialize();
