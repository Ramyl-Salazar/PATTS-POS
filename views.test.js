import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, getRoute, renderAppView } from "./views.js";

test("escapes untrusted values and normalizes routes", () => {
  assert.equal(escapeHtml(`<script>"x"</script>`), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  assert.equal(getRoute("#inventory"), "inventory");
  assert.equal(getRoute("#unknown"), "wallet");
});

test("renders the main checkout controls for the canonical wallet state", () => {
  const html = renderAppView("wallet", {
    students: [{ id: "1", name: "Alyssa Reyes", program: "BS Aero", balance: 5000 }],
    transactions: [], items: [{ id: "water", name: "Water", price: 2000, details: "Bottle" }],
    activeStudentId: "1", enteredCentavos: "2000", transactionMode: "payment", itemQuery: "",
    activeOrderItems: [{ lineId: "item:water", itemId: "water", name: "Water", price: 2000, quantity: 2 }],
    studentQuery: "", readerStatus: "Ready", readerBusy: false, readerReady: true,
    useSimulatedReader: false, operatorName: "Bernard",
  });
  assert.match(html, /Transaction keypad/);
  assert.match(html, /Transaction summary/);
  assert.match(html, /Item menu/);
  assert.match(html, /Student wallet/);
  assert.doesNotMatch(html, /Main transaction|<h1>Checkout<\/h1>|Reader ready/);
  assert.match(html, /Charge wallet · ₱40\.00/);
  assert.doesNotMatch(html, /data-quick-amount/);
  assert.match(html, /Add to order/);
  assert.match(html, /data-item-id="water"/);
  assert.match(html, /Filter items by category/);
  assert.match(html, />2<\/span>/);
});

test("keeps the charge action visible when the keypad is collapsed", () => {
  const html = renderAppView("wallet", {
    students: [{ id: "1", name: "Alyssa Reyes", balance: 5000 }], transactions: [],
    items: [], activeStudentId: "1", enteredCentavos: "", transactionMode: "payment",
    itemQuery: "", itemCategory: "all", activeOrderItems: [], checkoutControlsCollapsed: true,
  });
  assert.match(html, /Transaction summary/);
  assert.match(html, /aria-label="Show total and keypad"/);
  assert.match(html, /class="order-footer[^"]*"><div>/);
  assert.match(html, /Charge wallet · ₱0\.00/);
  assert.match(html, /class="pos-panel keypad-panel"[^>]* hidden/);
});

test("renders explicit student management actions without program data or whole-card activation", () => {
  const html = renderAppView("students", {
    students: [{ id: "1", name: "Alyssa Reyes", program: "Hidden program", balance: 5000 }], studentQuery: "",
  });
  assert.match(html, /data-use-student="1"/);
  assert.match(html, /data-edit-student="1"/);
  assert.match(html, /data-delete-student="1"/);
  assert.doesNotMatch(html, /data-open-student|Hidden program|Program \/ section/);
});

test("filters activity to a selected student", () => {
  const html = renderAppView("activity", {
    students: [{ id: "1", name: "Alyssa", balance: 5000 }, { id: "2", name: "Marco", balance: 5000 }],
    activityStudentId: "1",
    transactions: [
      { id: "a", studentId: "1", studentName: "Alyssa", type: "payment", amount: 100, newBalance: 4900, createdAt: "2026-10-15T00:00:00.000Z", note: "Water", teller: "Bernard" },
      { id: "b", studentId: "2", studentName: "Marco", type: "payment", amount: 200, newBalance: 4800, createdAt: "2026-10-15T00:00:00.000Z", note: "Meal", teller: "Bernard" },
    ],
  });
  assert.match(html, /Alyssa transaction history/);
  assert.match(html, /Water/);
  assert.doesNotMatch(html, /Meal/);
});

test("renders a disabled waiting state until a student is explicitly selected", () => {
  const html = renderAppView("wallet", {
    students: [{ id: "1", name: "Alyssa Reyes", program: "BS Aero", balance: 5000 }],
    transactions: [], items: [{ id: "water", name: "Water", price: 2000, details: "Bottle" }],
    activeStudentId: null, enteredCentavos: "", transactionMode: "payment", itemQuery: "",
    activeOrderItems: [], studentQuery: "", readerStatus: "Ready", readerBusy: false,
    readerReady: true, useSimulatedReader: false, operatorName: "Bernard",
  });
  assert.match(html, /Waiting for NFC card/);
  assert.match(html, /data-item-id="water" disabled/);
  assert.match(html, /data-key="1" disabled/);
  assert.doesNotMatch(html, /More details \/ change/);
});

test("renders Add funds as a variable wallet credit", () => {
  const html = renderAppView("wallet", {
    students: [{ id: "1", name: "Alyssa Reyes", program: "BS Aero", balance: 5000 }],
    transactions: [], items: [{ id: "item-add-funds", name: "Add funds", price: 0, details: "Custom", transactionType: "topup" }],
    activeStudentId: "1", enteredCentavos: "2500", transactionMode: "topup", itemQuery: "",
    activeOrderItems: [], studentQuery: "", readerStatus: "Ready", readerBusy: false,
    readerReady: true, useSimulatedReader: false, operatorName: "Bernard", checkoutControlsCollapsed: false,
  });
  assert.match(html, /Variable amount/);
  assert.match(html, /ADD FUNDS MODE/);
  assert.match(html, /does not charge it/);
  assert.match(html, /Confirm adding funds/);
  assert.match(html, /topup-payment/);
  assert.match(html, /Funds to add/);
  assert.match(html, /₱25\.00/);
});

test("never uses a restored transaction type as HTML markup", () => {
  const payload = '\" onmouseover=\"alert(1)';
  const html = renderAppView("activity", {
    students: [], items: [], activeStudentId: null, enteredCentavos: "", activeOrderItems: [], transactionMode: "payment", itemQuery: "",
    studentQuery: "", readerStatus: "Ready", readerBusy: false, readerReady: true,
    useSimulatedReader: false, operatorName: "Bernard",
    transactions: [{ id: "x", studentName: "Alyssa", type: payload, amount: 1, newBalance: 1, createdAt: "2026-10-15T00:00:00.000Z", note: "", teller: "Bernard" }],
  });
  assert.doesNotMatch(html, /onmouseover/);
  assert.match(html, /transaction-icon topup/);
});
