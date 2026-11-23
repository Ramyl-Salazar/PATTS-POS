export function addItemToOrder(lines, item) {
  if (!item?.id || !item?.name || !Number.isInteger(item.price) || item.price <= 0) {
    throw new Error("Choose a valid item.");
  }
  const existing = lines.find((line) => line.itemId === item.id);
  if (existing) {
    return lines.map((line) => line.lineId === existing.lineId
      ? { ...line, quantity: line.quantity + 1 }
      : line);
  }
  return [...lines, { lineId: `item:${item.id}`, itemId: item.id, name: item.name, price: item.price, quantity: 1 }];
}

export function addManualAmountToOrder(lines, amount, sequence) {
  const normalizedAmount = Number(amount);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error("Enter an amount first.");
  return [...lines, {
    lineId: `manual:${sequence}`,
    itemId: null,
    name: "Manual amount",
    price: normalizedAmount,
    quantity: 1,
  }];
}

export function adjustOrderLine(lines, lineId, delta) {
  const line = lines.find((entry) => entry.lineId === lineId);
  if (!line || ![-1, 1].includes(delta)) return lines;
  if (line.quantity + delta <= 0) return lines.filter((entry) => entry.lineId !== lineId);
  return lines.map((entry) => entry.lineId === lineId
    ? { ...entry, quantity: entry.quantity + delta }
    : entry);
}

export function orderTotal(lines) {
  return lines.reduce((total, line) => total + (line.price * line.quantity), 0);
}

export function orderItemCount(lines) {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function orderNote(lines) {
  return lines.map((line) => `${line.name}${line.quantity > 1 ? ` x${line.quantity}` : ""}`).join(", ");
}
