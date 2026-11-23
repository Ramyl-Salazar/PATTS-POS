// Local, bounded support history. Never include student identity, wallet data,
// teller information, PIN records, or a complete database/backup.
export function readerDiagnostic(event, card, student = null, now = new Date()) {
  return {
    event,
    recordedAt: now.toISOString(),
    detectedKey: String(card?.cardKey || ""),
    detectedType: String(card?.cardType || ""),
    reader: String(card?.reader || ""),
    ...(student ? {
      savedKey: String(student.cardKey || ""),
      savedType: String(student.cardType || ""),
      savedAliases: [...(student.cardAliases || [])],
    } : {}),
  };
}

export function appendReaderDiagnostic(history, entry) {
  return [...(Array.isArray(history) ? history : []).slice(-11), entry];
}
