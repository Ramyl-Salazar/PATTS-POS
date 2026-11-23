import { calculateBalance, createTransaction } from "./wallet.js";

export function updateEnteredCentavos(current, key, maxDigits = 8) {
  let next = String(current ?? "");
  if (key === "←") next = next.slice(0, -1);
  else if (/^(?:\d|00)$/.test(String(key)) && next.length < maxDigits) next += String(key);
  return next.replace(/^0+(?=\d)/, "").slice(0, maxDigits);
}

export function prepareTransaction({ student, type, enteredCentavos, note = "", teller, now = new Date() }) {
  if (!student) throw new Error("Choose a student wallet first.");
  if (!enteredCentavos) throw new Error("Enter an amount first.");
  const amount = Number(enteredCentavos);
  const newBalance = calculateBalance(student.balance, type, amount);
  return {
    amount,
    newBalance,
    transaction: createTransaction({ student, type, amount, note, teller, now }),
  };
}
