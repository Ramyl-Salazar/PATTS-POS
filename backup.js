import { TRANSACTION_TYPES } from "./wallet.js";
import { inferLegacyItemCategory } from "./inventory.js";

const BACKUP_VERSION = 2;
const MAX_RECORDS = 100_000;
const AUTH_SETTING_KEYS = new Set(["auth", "authThrottle"]);

function invalid() {
  throw new Error("This is not a valid PATTS POS backup.");
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value;
}

function text(value, { required = false, max = 500 } = {}) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) invalid();
  return value;
}

function money(value, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) invalid();
  return value;
}

function list(value, validator, { optional = false } = {}) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RECORDS) invalid();
  const normalized = value.map(validator);
  const ids = normalized.map((item) => item?.id ?? item?.key).filter(Boolean);
  if (new Set(ids).size !== ids.length) invalid();
  return normalized;
}

function student(value) {
  const item = record(value);
  if (item.active !== undefined && typeof item.active !== "boolean") invalid();
  if ((item.cardKey === undefined) !== (item.cardType === undefined)) invalid();
  if (item.cardAliases !== undefined && (!item.cardKey || !Array.isArray(item.cardAliases)
      || item.cardAliases.length > 8 || item.cardAliases.some((key) => typeof key !== "string"
        || key.length > 160 || !/^(HF|LF):(?:[0-9A-F]{2})+$/.test(key)))) invalid();
  return {
    id: text(item.id, { required: true, max: 80 }),
    name: text(item.name, { required: true, max: 120 }),
    balance: money(item.balance),
    active: item.active === undefined ? true : Boolean(item.active),
    ...(item.cardKey === undefined ? {} : { cardKey: text(item.cardKey, { required: true, max: 160 }) }),
    ...(item.cardType === undefined ? {} : { cardType: text(item.cardType, { required: true, max: 20 }) }),
    ...(item.cardAliases === undefined ? {} : { cardAliases: [...new Set(item.cardAliases)] }),
  };
}

function transaction(value) {
  const item = record(value);
  if (![TRANSACTION_TYPES.PAYMENT, TRANSACTION_TYPES.TOP_UP].includes(item.type)) invalid();
  if (Number.isNaN(Date.parse(item.createdAt))) invalid();
  const normalized = {
    id: text(item.id, { required: true, max: 100 }),
    studentId: text(item.studentId, { required: true, max: 80 }),
    studentName: text(item.studentName, { required: true, max: 120 }),
    type: item.type,
    amount: money(item.amount, { positive: true }),
    previousBalance: money(item.previousBalance),
    newBalance: money(item.newBalance),
    note: text(item.note ?? "", { max: 500 }),
    teller: text(item.teller ?? "Unknown teller", { required: true, max: 120 }),
    createdAt: new Date(item.createdAt).toISOString(),
  };
  const expectedBalance = normalized.type === TRANSACTION_TYPES.PAYMENT
    ? normalized.previousBalance - normalized.amount
    : normalized.previousBalance + normalized.amount;
  if (expectedBalance !== normalized.newBalance || expectedBalance < 0) invalid();
  return normalized;
}

function inventoryItem(value) {
  const item = record(value);
  const isTopUp = item.transactionType === TRANSACTION_TYPES.TOP_UP;
  if (item.transactionType !== undefined && !isTopUp) invalid();
  return {
    id: text(item.id, { required: true, max: 100 }),
    name: text(item.name, { required: true, max: 120 }),
    price: money(item.price, { positive: !isTopUp }),
    details: text(item.details ?? "", { max: 500 }),
    ...(!isTopUp ? { category: inferLegacyItemCategory(item) } : {}),
    ...(isTopUp ? { transactionType: TRANSACTION_TYPES.TOP_UP } : {}),
  };
}

function setting(value) {
  const item = record(value);
  const key = text(item.key, { required: true, max: 80 });
  if (AUTH_SETTING_KEYS.has(key) || key !== "tellerName") return null;
  return { key, value: text(item.value, { max: 120 }) };
}

export function createBackup({ students, transactions, items, settings, now = new Date() }) {
  return validateBackup({
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    students,
    transactions,
    items,
    settings: settings.filter((item) => !AUTH_SETTING_KEYS.has(item?.key)),
  });
}

export function validateBackup(backup) {
  const source = record(backup);
  if (source.version !== BACKUP_VERSION || Number.isNaN(Date.parse(source.exportedAt))) invalid();
  const normalized = {
    version: BACKUP_VERSION,
    exportedAt: new Date(source.exportedAt).toISOString(),
    students: list(source.students, student),
    transactions: list(source.transactions, transaction),
    items: list(source.items, inventoryItem, { optional: true }),
    settings: list(source.settings, setting).filter(Boolean),
  };
  const studentIds = new Set(normalized.students.map((item) => item.id));
  if (normalized.transactions.some((item) => !studentIds.has(item.studentId))) invalid();
  return normalized;
}

export function parseBackup(textValue) {
  try {
    return validateBackup(JSON.parse(textValue));
  } catch (error) {
    if (error.message === "This is not a valid PATTS POS backup.") throw error;
    throw new Error("This is not a valid PATTS POS backup.");
  }
}
