import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAXIMUM_BATCH_SIZE = 30;

export function parseBatchPersonIds(input, registeredPersonIds, { maximum = MAXIMUM_BATCH_SIZE } = {}) {
  if (typeof input !== "string") throw new Error("People hero batch IDs must be supplied as text");
  const tokens = input.split(/[\s,]+/u).filter(Boolean);
  if (tokens.length === 0) throw new Error("People hero batch must contain at least one Person ID");
  if (tokens.length > maximum) throw new Error(`People hero batch cannot exceed ${maximum} Person IDs`);

  const registered = new Set([...registeredPersonIds].map(Number));
  const selected = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!/^[1-9]\d*$/u.test(token)) throw new Error("People hero batch contains a malformed Person ID");
    const personId = Number(token);
    if (!Number.isSafeInteger(personId)) throw new Error("People hero batch contains an unsafe Person ID");
    if (seen.has(personId)) throw new Error(`People hero batch contains duplicate Person ID ${personId}`);
    if (!registered.has(personId)) throw new Error(`People hero batch contains unregistered Person ID ${personId}`);
    seen.add(personId);
    selected.push(personId);
  }
  return selected;
}

function registeredPeople() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const registry = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "data", "people.json"), "utf8"));
  if (!Array.isArray(registry.people)) throw new Error("People registry is invalid");
  return registry.people.map((person) => person.tmdbPersonId);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const personIds = parseBatchPersonIds(process.env.PEOPLE_HERO_BATCH_IDS, registeredPeople());
  process.stdout.write(`person_ids=${JSON.stringify(personIds)}\n`);
}
