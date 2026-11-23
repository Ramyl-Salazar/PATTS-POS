export const TRANSACTION_TYPES = Object.freeze({ PAYMENT: "payment", TOP_UP: "topup" });

export function pesosToCentavos(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) throw new Error("Enter a valid amount with up to two decimal places.");
  const amount = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function formatPeso(centavos) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(centavos / 100);
}

export function calculateBalance(currentBalance, type, amount) {
  if (!Number.isSafeInteger(currentBalance) || currentBalance < 0) throw new Error("Wallet balance is invalid.");
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Transaction amount is invalid.");
  if (type === TRANSACTION_TYPES.TOP_UP) return currentBalance + amount;
  if (type !== TRANSACTION_TYPES.PAYMENT) throw new Error("Unknown transaction type.");
  if (amount > currentBalance) throw new Error("Insufficient wallet balance.");
  return currentBalance - amount;
}

export function createTransaction({ student, type, amount, note = "", teller = "Demo Teller", now = new Date() }) {
  const previousBalance = student.balance;
  const newBalance = calculateBalance(previousBalance, type, amount);
  return { id: crypto.randomUUID(), studentId: student.id, studentName: student.name, type, amount, previousBalance, newBalance, note: note.trim(), teller, createdAt: now.toISOString() };
}

