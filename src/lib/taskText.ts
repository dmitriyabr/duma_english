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

export function extractReadingPassage(taskPrompt: string) {
  const prompt = (taskPrompt || "").trim();
  if (!prompt) return "";

  const passageSection = prompt.match(/passage\s*:\s*([\s\S]*?)(?:\n+\s*question\s*:|$)/i);
  if (passageSection?.[1]) {
    return passageSection[1].trim();
  }

  const quoted = prompt.match(/["“”'‘’]([^"“”'‘’]{12,600})["“”'‘’]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  return "";
}

export function extractReadingQuestion(taskPrompt: string) {
  const prompt = (taskPrompt || "").trim();
  if (!prompt) return "";

  const questionSection = prompt.match(/question\s*:\s*([^\n]+)/i);
  if (questionSection?.[1]) {
    return questionSection[1].trim();
  }

  const trailingQuestion = prompt.match(/([A-Z][^!?]*\?)/);
  if (trailingQuestion?.[1]) {
    return trailingQuestion[1].trim();
  }

  return "";
}

export function extractListeningScript(taskPrompt: string) {
  const prompt = (taskPrompt || "").trim();
  if (!prompt) return "";

  const audioSection = prompt.match(/(?:audio|listening\s+script)\s*:\s*([\s\S]*?)(?:\n+\s*question\s*:|$)/i);
  if (audioSection?.[1]) {
    return audioSection[1].trim();
  }

  const listenSection = prompt.match(/listen(?:\s+to)?(?:\s+this)?\s*[:\-]\s*([\s\S]*?)(?:\n+\s*question\s*:|$)/i);
  if (listenSection?.[1]) {
    return listenSection[1].trim();
  }

  return extractReadingPassage(prompt);
}

export function extractListeningQuestion(taskPrompt: string) {
  const prompt = (taskPrompt || "").trim();
  if (!prompt) return "";

  const questionSection = prompt.match(/question\s*:\s*([^\n]+)/i);
  if (questionSection?.[1]) {
    return questionSection[1].trim();
  }

  return extractReadingQuestion(prompt);
}
