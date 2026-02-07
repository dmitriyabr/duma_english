function uniquePreserveOrder(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function cleanWordToken(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z'-]+$/g, "")
    .replace(/["'`“”‘’]/g, "");
}

export function extractReferenceText(taskPrompt: string) {
  const prompt = (taskPrompt || "").trim();
  if (!prompt) return "";

  const quoted = prompt.match(/["“”'‘’]([^"“”'‘’]{3,260})["“”'‘’]/);
  if (quoted && quoted[1]) return quoted[1].trim();

  const stripped = prompt.replace(/^read\s+(?:this\s+)?aloud(?:\s+clearly)?[:\s-]*/i, "").trim();
  if (stripped.length >= 3 && stripped !== prompt) return stripped;

  const afterColon = prompt.split(":").slice(1).join(":").trim();
  if (afterColon.length >= 3) return afterColon;

  return "";
}

export function extractRequiredWords(taskPrompt: string) {
  const prompt = (taskPrompt || "").trim();
  if (!prompt) return [] as string[];

  const patterns = [
    /(?:use|include|say|talk\s+using)\s+(?:these|those|the|all)?\s*words?(?:\s+in\s+(?:your\s+)?(?:short\s+)?(?:talk|answer|speech))?\s*[:\-]?\s*([^\n]+)/i,
    /(?:target|required)\s+words?\s*[:\-]\s*([^\n]+)/i,
  ];

  let source = "";
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      source = match[1];
      break;
    }
  }
  if (!source) return [] as string[];

  const firstSentence = source.split(/[.!?](?:\s|$)/)[0] || source;
  const tokens = firstSentence
    .split(/,|;|\/|\band\b/gi)
    .map(cleanWordToken)
    .filter((word) => /^[a-z][a-z'-]*$/.test(word));

  return uniquePreserveOrder(tokens).slice(0, 20);
}
