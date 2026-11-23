export function normalizeCardKey(value, fallbackType = "") {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  const separator = raw.indexOf(":");
  const explicitType = separator >= 0 ? raw.slice(0, separator) : fallbackType;
  const type = String(explicitType || "").trim().toUpperCase();
  const payload = (separator >= 0 ? raw.slice(separator + 1) : raw).replace(/[^0-9A-F]/g, "");
  if (!payload) return "";
  return type === "HF" || type === "LF" ? `${type}:${payload}` : payload;
}

function reverseBytes(payload) {
  return payload.match(/../g)?.reverse().join("") || payload;
}

export function cardIdentityCandidates(value, fallbackType = "") {
  const normalized = normalizeCardKey(value, fallbackType);
  const payload = normalized.replace(/^(HF|LF):/, "");
  if (!payload) return new Set();
  const candidates = new Set([payload, reverseBytes(payload)]);
  const bytes = payload.match(/../g) || [];

  // NFC-X firmware variants may wrap a UID with one or two metadata bytes.
  // Only accept standard UID lengths to avoid broad or ambiguous substring matches.
  for (let index = 0; index < Math.min(bytes.length, 3); index += 1) {
    const length = Number.parseInt(bytes[index], 16);
    if (![4, 7, 10].includes(length) || index + 1 + length > bytes.length) continue;
    const uid = bytes.slice(index + 1, index + 1 + length).join("");
    candidates.add(uid);
    candidates.add(reverseBytes(uid));
  }
  return candidates;
}

export function cardKeysMatch(student, detectedKey, detectedType = "") {
  const detected = normalizeCardKey(detectedKey, detectedType);
  // Additional identifiers are learned only through the teller's explicit
  // repair flow. Match these exactly, never by guessed substrings.
  if (detected && student?.cardAliases?.some((key) => normalizeCardKey(key) === detected)) return true;
  const stored = normalizeCardKey(student?.cardKey, student?.cardType);
  if (!stored || !detected) return false;
  const storedType = stored.match(/^(HF|LF):/)?.[1];
  const detectedCardType = detected.match(/^(HF|LF):/)?.[1];
  if (storedType && detectedCardType && storedType !== detectedCardType) return false;
  if (stored === detected) return true;
  const storedCandidates = cardIdentityCandidates(stored, student?.cardType);
  const detectedCandidates = cardIdentityCandidates(detected, detectedType);
  return [...storedCandidates].some((candidate) => detectedCandidates.has(candidate));
}

export function findStudentByCard(students, detectedKey, detectedType = "") {
  const matches = students.filter((student) => cardKeysMatch(student, detectedKey, detectedType));
  if (matches.length > 1) throw new Error("This card matches more than one student. Check the saved card links before continuing.");
  return matches[0];
}

// A new-card prompt requires two identical reads, including a manual scan.
// Recheck persisted wallets before declaring a card new; enrollment may have
// completed since the in-memory list was loaded. Never rewrite a saved identity
// merely because a compatibility candidate matched a different reader record.
export async function resolveCardScan(readCard, students, loadStudents) {
  const read = async () => {
    const card = await readCard();
    if (card.noCard) throw new Error("No card detected. Hold the card on the reader and try again.");
    const cardKey = normalizeCardKey(card.cardKey, card.cardType);
    if (!cardKey || !/^(HF|LF):(?:[0-9A-F]{2})+$/.test(cardKey)) {
      throw new Error("The card could not be read reliably. Remove it and tap again.");
    }
    return { ...card, cardKey };
  };
  let card = await read();
  let student = findStudentByCard(students, card.cardKey, card.cardType);
  if (student) return { card, student };
  let savedStudents = await loadStudents();
  student = findStudentByCard(savedStudents, card.cardKey, card.cardType);
  if (student) return { card, student };
  const firstKey = card.cardKey;
  card = await read();
  savedStudents = await loadStudents();
  student = findStudentByCard(savedStudents, card.cardKey, card.cardType);
  if (student) return { card, student };
  if (firstKey !== card.cardKey) throw new Error("The card could not be read reliably. Remove it and tap again.");
  return { card, student: null };
}

export function linkCardToStudent(student, card, { preserveExisting = false } = {}) {
  if (!student) throw new Error("Choose a student wallet for this card.");
  const key = normalizeCardKey(card.cardKey, card.cardType);
  if (!/^(HF|LF):(?:[0-9A-F]{2})+$/.test(key)) throw new Error("The card identifier is invalid. Tap the card again.");
  if (preserveExisting && student.cardKey) {
    const original = normalizeCardKey(student.cardKey, student.cardType);
    const aliases = [...new Set([...(student.cardAliases || []), key])].filter((alias) => alias !== original);
    if (aliases.length > 8) throw new Error("This wallet has too many repaired identifiers. Share the NFC report before making further changes.");
    return { ...student, cardAliases: aliases };
  }
  // Replacing a card explicitly revokes all previously repaired identifiers.
  const { cardAliases, ...wallet } = student;
  return {
    ...wallet,
    cardKey: key,
    cardType: key.slice(0, 2),
  };
}
