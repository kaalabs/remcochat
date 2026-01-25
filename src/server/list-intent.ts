export function isListsOverviewIntent(text: string): boolean {
  const trimmed = String(text ?? "").trim().toLowerCase();
  if (!trimmed) return false;

  const patterns = [
    /\b(my|mijn)\s+lists\b/,
    /\b(all|alle)\s+lists\b/,
    /\b(what|which)\s+lists\b/,
    /\b(show|toon|laat)\b.*\b(lists|lijsten)\b/,
    /\boverview\b.*\b(lists|lijsten)\b/,
    /\b(lists|lijsten)\b.*\boverview\b/,
    /\b(welke|wat)\s+lijsten\b/,
    /\b(mijn|alle)\s+lijsten\b/,
  ];

  return patterns.some((pattern) => pattern.test(trimmed));
}

export function isListIntent(text: string): boolean {
  const trimmed = String(text ?? "").trim().toLowerCase();
  if (!trimmed) return false;
  if (isListsOverviewIntent(trimmed)) return true;

  const patterns = [
    /\bissues?\s+list\b/,
    /\bissue\s+tracker\b/,
    /\bbacklog\b/,
    /\bboodschappenlijst\b/,
    /\bboodschappen\b/,
    /\b(grocery|shopping)\s+list\b/,
    /\b(todo|to-do)\s+list\b/,
    /\b(task|tasks)\s+list\b/,
    /\b(takenlijst|to-dolijst|todo-lijst)\b/,
    /\b(mijn|my)\s+list\b/,
    /\b(add|voeg|zet|plaats|remove|verwijder|delete|show|toon|maak|create|open|clear|share|unshare|rename|hernoem)\b.*\b(list|lijst)\b/,
    /\b(list|lijst)\b.*\b(add|voeg|zet|plaats|remove|verwijder|delete|show|toon|maak|create|open|clear|share|unshare|rename|hernoem)\b/,
  ];

  return patterns.some((pattern) => pattern.test(trimmed));
}
