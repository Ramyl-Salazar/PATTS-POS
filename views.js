import { filterStudents } from "./students.js";
import { formatPeso, TRANSACTION_TYPES } from "./wallet.js";

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function getRoute(hash) {
  const requested = String(hash).replace(/^#/, "");
  return ["wallet", "students", "inventory", "activity", "settings"].includes(requested) ? requested : "wallet";
}

function avatar(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function renderStudentOptions({ students, query, activeStudentId }) {
  const matches = filterStudents(students, query);
  if (!matches.length) return `<div class="search-empty"><strong>No wallet found</strong><span>Try a name or student ID.</span><button class="text-button" data-action="clear-search">Clear search</button></div>`;
  return matches.map((item) => `<button class="student-option ${item.id === activeStudentId ? "selected" : ""}" data-student-id="${escapeHtml(item.id)}"><span class="avatar">${avatar(item.name)}</span><span class="student-option-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></span><span class="student-option-balance">${formatPeso(item.balance)}</span></button>`).join("");
}

export function renderStudentCards({ students, query }) {
  const matches = filterStudents(students, query);
  if (!matches.length) return `<div class="search-empty wide"><strong>No students match “${escapeHtml(query)}”</strong><span>Search by full or partial name or student ID.</span><button class="text-button" data-action="clear-search">Clear search</button></div>`;
  return matches.map((student) => `<article class="student-card"><span class="avatar large">${avatar(student.name)}</span><span class="student-card-copy"><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.id)}</small></span><span class="student-card-balance"><small>Balance</small><b>${formatPeso(student.balance)}</b></span><div class="student-card-actions"><button class="button button-primary" data-use-student="${escapeHtml(student.id)}">Use in Main</button><button class="button button-quiet" data-edit-student="${escapeHtml(student.id)}">Edit</button><button class="text-button danger-text" data-delete-student="${escapeHtml(student.id)}">Remove</button></div></article>`).join("");
}

function transactionLabel(type) {
  return type === TRANSACTION_TYPES.PAYMENT ? "Payment" : "Funds added";
}

function renderTransactionRows(items, emptyText = "No transactions recorded yet.") {
  if (!items.length) return `<div class="empty-state"><strong>Nothing here yet</strong><p>${emptyText}</p></div>`;
  return `<div class="transaction-list">${items.map((item) => {
    const type = item.type === TRANSACTION_TYPES.PAYMENT ? TRANSACTION_TYPES.PAYMENT : TRANSACTION_TYPES.TOP_UP;
    return `
    <article class="transaction-row">
      <span class="transaction-icon ${type}" aria-hidden="true">${type === TRANSACTION_TYPES.PAYMENT ? "−" : "+"}</span>
      <div><strong>${escapeHtml(item.note || transactionLabel(item.type))}</strong><span>${escapeHtml(item.studentName)} · ${new Date(item.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} · ${escapeHtml(item.teller || "Unknown teller")}</span></div>
      <div class="transaction-amount ${type}">${type === TRANSACTION_TYPES.PAYMENT ? "−" : "+"}${formatPeso(item.amount)}<small>Bal. ${formatPeso(item.newBalance)}</small></div>
    </article>`;
  }).join("")}</div>`;
}

function renderWallet(state) {
  const student = state.students.find((item) => item.id === state.activeStudentId);
  const amountPreview = state.enteredCentavos ? formatPeso(Number(state.enteredCentavos)) : "₱0.00";
  const isTopUp = state.transactionMode === TRANSACTION_TYPES.TOP_UP;
  const controlsDisabled = student ? "" : "disabled";
  const orderLines = state.activeOrderItems || [];
  const total = isTopUp ? Number(state.enteredCentavos || 0) : orderLines.reduce((sum, line) => sum + (line.price * line.quantity), 0);
  const orderCount = isTopUp ? (total ? 1 : 0) : orderLines.reduce((count, line) => count + line.quantity, 0);
  const itemQuery = String(state.itemQuery || "").trim().toLocaleLowerCase();
  const activeCategory = ["food", "drinks", "service"].includes(state.itemCategory) ? state.itemCategory : "all";
  const topUpItem = state.items.find((item) => item.transactionType === TRANSACTION_TYPES.TOP_UP);
  const visibleItems = state.items.filter((item) => !item.transactionType
    && (activeCategory === "all" || (item.category || "service") === activeCategory)
    && (!itemQuery || `${item.name} ${item.details || ""}`.toLocaleLowerCase().includes(itemQuery)));
  const itemButtons = visibleItems.length
    ? visibleItems.map((item) => `<button class="menu-item" data-item-id="${escapeHtml(item.id)}" ${controlsDisabled} aria-label="Add ${escapeHtml(item.name)}, ${formatPeso(item.price)}"><span class="menu-item-copy"><span class="item-category-label">${escapeHtml(item.category || "service")}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.details || "Tap to add to order")}</small></span><span class="menu-item-footer"><b>${formatPeso(item.price)}</b><span aria-hidden="true">+ Add</span></span></button>`).join("")
    : `<div class="checkout-items-empty"><strong>${state.items.length ? "No matching items" : "No items yet"}</strong><span>${state.items.length ? "Try another category or search." : "Add products from the Items tab."}</span></div>`;
  const categoryFilters = [["all", "All"], ["food", "Food"], ["drinks", "Drinks"], ["service", "Services"]]
    .map(([value, label]) => `<button class="category-filter ${activeCategory === value ? "selected" : ""}" data-item-category="${value}" aria-pressed="${activeCategory === value}">${label}</button>`).join("");
  const orderMarkup = isTopUp && total
    ? `<article class="order-line topup-line"><div class="order-line-copy"><strong>Add funds</strong><small>Credit to student wallet</small></div><b>${formatPeso(total)}</b></article>`
    : !isTopUp && orderLines.length
    ? orderLines.map((line) => `<article class="order-line"><div class="order-line-copy"><strong>${escapeHtml(line.name)}</strong><small>${formatPeso(line.price)} each</small></div><div class="quantity-control" aria-label="Quantity for ${escapeHtml(line.name)}"><button data-order-line="${escapeHtml(line.lineId)}" data-order-adjust="-1" aria-label="Remove one ${escapeHtml(line.name)}">−</button><span>${line.quantity}</span><button data-order-line="${escapeHtml(line.lineId)}" data-order-adjust="1" aria-label="Add one ${escapeHtml(line.name)}">+</button></div><b>${formatPeso(line.price * line.quantity)}</b></article>`).join("")
    : `<div class="order-empty"><span class="order-empty-mark" aria-hidden="true">+</span><strong>${student ? (isTopUp ? "Enter a funding amount" : "No items added") : "Waiting for a student card"}</strong><small>${student ? (isTopUp ? "Use the keypad below, then confirm the wallet credit." : "Tap an item from the menu or add a manual amount.") : "Tap a registered NFC card or choose a student from the Students tab."}</small></div>`;
  const walletMarkup = student
    ? `<div class="wallet-card-top"><span>Student wallet</span><span>Connected</span></div><div class="compact-wallet-main"><span class="avatar light">${avatar(student.name)}</span><span><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.id)}</small></span><div class="compact-balance"><small>Available</small><strong>${formatPeso(student.balance)}</strong></div></div>`
    : `<div class="wallet-waiting"><span class="reader-ready-pulse" aria-hidden="true"></span><span><strong>Waiting for NFC card</strong><small>No wallet selected</small></span></div>`;
  return `
    <section class="page checkout-page ${isTopUp ? "topup-mode" : ""}">
      <div class="pos-workspace">
        <section class="pos-panel item-menu-panel" aria-labelledby="menu-title">
          <div class="pos-panel-head"><div><span>Products and fees</span><h2 id="menu-title">Item menu</h2></div><a href="#inventory">Manage</a></div>
          <label class="menu-search"><span class="search-glyph" aria-hidden="true"></span><input type="search" data-item-search value="${escapeHtml(state.itemQuery || "")}" placeholder="Search menu" autocomplete="off" aria-label="Search item menu" /></label>
          <div class="category-filters" aria-label="Filter items by category">${categoryFilters}</div>
          ${topUpItem ? `<button class="menu-item menu-item-topup" data-item-id="${escapeHtml(topUpItem.id)}" ${controlsDisabled}><span class="topup-item-icon" aria-hidden="true">+</span><span class="menu-item-copy"><span class="item-category-label">Wallet credit</span><strong>${escapeHtml(topUpItem.name)}</strong><small>Increases the student's balance — does not charge it.</small></span><span class="menu-item-footer"><b>Variable amount</b><span aria-hidden="true">Enter amount</span></span></button>` : ""}
          <div class="item-menu-grid" aria-live="polite">${itemButtons}</div>
        </section>
        <div class="checkout-side ${state.checkoutControlsCollapsed ? "controls-collapsed" : ""}">
          <section class="pos-panel order-panel" aria-labelledby="order-title">
            <article class="checkout-wallet compact-wallet" aria-label="Student wallet">${walletMarkup}</article>
            ${isTopUp ? `<div class="topup-mode-alert" role="status"><span class="topup-alert-icon" aria-hidden="true">+</span><span><strong>ADD FUNDS MODE</strong><small>This increases the wallet balance. It will not deduct a payment.</small></span><button class="button button-quiet" type="button" data-action="cancel-topup">Back to checkout</button></div>` : ""}
            <div class="pos-panel-head"><div><span>${orderCount} item${orderCount === 1 ? "" : "s"}</span><h2 id="order-title">Transaction summary</h2></div><div class="summary-head-actions"><button class="text-button" data-action="clear-order" ${total || orderLines.length ? "" : "disabled"}>Clear</button><button class="collapse-controls" data-action="toggle-checkout-controls" aria-expanded="${!state.checkoutControlsCollapsed}" aria-label="${state.checkoutControlsCollapsed ? "Show" : "Hide"} total and keypad"><span aria-hidden="true">${state.checkoutControlsCollapsed ? "↑" : "↓"}</span></button></div></div>
            <div class="order-lines" aria-live="polite">${orderMarkup}</div>
            <div class="order-footer ${isTopUp ? "topup-order-footer" : ""}"><div><span>${isTopUp ? "Funds to add" : "Total due"}</span><strong>${formatPeso(total)}</strong></div><button class="button button-payment ${isTopUp ? "topup-payment" : ""}" data-action="payment" ${student && total ? "" : "disabled"}>${isTopUp ? "Confirm adding funds" : "Charge wallet"} · ${isTopUp ? "+" : ""}${formatPeso(total)}</button></div>
          </section>
          <section class="pos-panel keypad-panel" aria-labelledby="keypad-title" ${state.checkoutControlsCollapsed ? "hidden" : ""}>
            <div class="pos-panel-head"><div><span>${isTopUp ? "Funding amount" : "Manual entry"}</span><h2 id="keypad-title">Transaction keypad</h2></div></div>
            <div class="manual-amount"><span>PHP</span><strong>${amountPreview.replace("₱", "")}</strong></div>
            <div class="keypad" aria-label="Amount keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "00", 0, "←"].map((key) => `<button data-key="${key}" ${controlsDisabled} aria-label="${key === "←" ? "Delete digit" : `Enter ${key}`}">${key}</button>`).join("")}</div>
            <div class="keypad-actions">${isTopUp ? `<span class="keypad-hint">Amount credits the connected wallet</span>` : `<button class="button button-primary" data-action="add-manual" ${student && state.enteredCentavos ? "" : "disabled"}>Add to order</button>`}</div>
          </section>
        </div>
      </div>
    </section>`;
}

function renderInventory({ items }) {
  const card = (item) => `<article class="inventory-card"><div><span class="inventory-price">${formatPeso(item.price)}</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.details || "No details")}</p></div><div class="inventory-actions"><button class="button button-quiet" data-edit-item="${escapeHtml(item.id)}">Edit</button><button class="text-button danger-text" data-delete-item="${escapeHtml(item.id)}">Delete</button></div></article>`;
  const topUp = items.find((item) => item.transactionType === TRANSACTION_TYPES.TOP_UP);
  const sections = [["food", "Food"], ["drinks", "Drinks"], ["service", "Services"]].map(([category, label]) => {
    const categoryItems = items.filter((item) => !item.transactionType && (item.category || "service") === category);
    return `<section class="inventory-category"><div class="inventory-category-head"><h2>${label}</h2><span>${categoryItems.length} item${categoryItems.length === 1 ? "" : "s"}</span></div><div class="inventory-grid">${categoryItems.length ? categoryItems.map(card).join("") : `<div class="empty-state"><strong>No ${label.toLocaleLowerCase()} yet</strong><p>Add an item and choose this category.</p></div>`}</div></section>`;
  }).join("");
  const special = topUp ? `<section class="inventory-category inventory-special"><div class="inventory-category-head"><h2>Wallet action</h2><span>Special item</span></div><div class="inventory-grid"><article class="inventory-card"><div><span class="inventory-price">Variable amount</span><h2>${escapeHtml(topUp.name)}</h2><p>${escapeHtml(topUp.details)}</p></div><small class="system-item-label">Built-in wallet action</small></article></div></section>` : "";
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Categorized inventory</p><h1>Quick-price items.</h1><p>Organize products and services for faster checkout.</p></div><button class="button button-primary" data-action="new-item">Add item</button></div>${special}${sections}</section>`;
}

function renderStudents(state) {
  const matches = filterStudents(state.students, state.studentQuery);
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Wallet directory</p><h1>Manage student wallets.</h1><p>${state.students.length} wallets stored locally on this device.</p></div><button class="button button-primary" data-action="new-student">Create wallet</button></div><div class="directory-toolbar"><label class="search-field large"><span class="search-glyph" aria-hidden="true"></span><input type="search" data-student-search placeholder="Search name or student ID" value="${escapeHtml(state.studentQuery)}" autocomplete="off" /></label><span id="search-count">${matches.length} result${matches.length === 1 ? "" : "s"}</span></div><div class="student-grid" id="student-grid" aria-live="polite">${renderStudentCards({ students: state.students, query: state.studentQuery })}</div></section>`;
}

function renderActivity({ transactions, students, activityStudentId }) {
  students ||= [];
  const visibleTransactions = activityStudentId ? transactions.filter((item) => item.studentId === activityStudentId) : transactions;
  const payments = visibleTransactions.filter((item) => item.type === TRANSACTION_TYPES.PAYMENT).reduce((sum, item) => sum + item.amount, 0);
  const topups = visibleTransactions.filter((item) => item.type === TRANSACTION_TYPES.TOP_UP).reduce((sum, item) => sum + item.amount, 0);
  const selectedName = students.find((item) => item.id === activityStudentId)?.name;
  const options = students.map((student) => `<option value="${escapeHtml(student.id)}" ${student.id === activityStudentId ? "selected" : ""}>${escapeHtml(student.name)} · ${escapeHtml(student.id)}</option>`).join("");
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Local ledger</p><h1>A clear record of every movement.</h1><p>Newest transactions appear first and remain available offline.</p></div></div><div class="activity-filter"><label for="activity-student">Student history</label><select id="activity-student" data-activity-student><option value="">All students</option>${options}</select></div><div class="metric-row"><article class="metric-feature"><span>${selectedName ? "Selected student" : "Total activity"}</span><strong>${visibleTransactions.length}</strong><small>${selectedName ? escapeHtml(selectedName) : "Recorded transactions"}</small></article><article><span>Payments</span><strong>${formatPeso(payments)}</strong></article><article><span>Funds added</span><strong>${formatPeso(topups)}</strong></article></div><section class="surface ledger-surface"><div class="section-head"><div><span>Audit trail</span><h2>${selectedName ? `${escapeHtml(selectedName)} transaction history` : "Transaction history"}</h2></div><span class="local-label">On-device storage</span></div>${renderTransactionRows(visibleTransactions, selectedName ? `No transactions recorded for ${escapeHtml(selectedName)}.` : undefined)}</section></section>`;
}

function renderSettings({ readerStatus, operatorName }) {
  return `<section class="page"><div class="page-intro compact"><div><p class="eyebrow">Device controls</p><h1>Keep the station ready.</h1><p>Protect, move, or reset data stored on this device.</p></div></div><div class="settings-layout">
    <section class="surface settings-section"><h2>Data backup</h2><p>Export wallet data before clearing Chrome data or changing devices. Teller PIN access stays on this device.</p><div class="button-row"><button class="button button-primary" data-action="export">Export backup</button><button class="button button-quiet" data-action="import">Restore backup</button></div></section>
    <section class="surface settings-section"><h2>Prototype status</h2><dl><div><dt>Storage</dt><dd>IndexedDB, local device only</dd></div><div><dt>Network</dt><dd>Not required after installation</dd></div><div><dt>Card reader</dt><dd>${escapeHtml(readerStatus)}</dd></div><div><dt>Teller</dt><dd>${escapeHtml(operatorName)} · PIN protected</dd></div></dl><div class="button-row"><button class="button button-quiet" data-action="lock">Lock teller station</button><button class="button button-quiet" data-action="share-nfc-report">Share NFC support report</button></div></section>
    <section class="surface settings-section danger-zone"><h2>Reset prototype</h2><p>Deletes local transactions and restores the 20 demo wallets.</p><button class="button button-danger" data-action="reset">Reset demo data</button></section>
  </div></section>`;
}

export function renderAppView(route, state) {
  if (route === "wallet") return renderWallet(state);
  if (route === "students") return renderStudents(state);
  if (route === "inventory") return renderInventory(state);
  if (route === "activity") return renderActivity(state);
  return renderSettings(state);
}
