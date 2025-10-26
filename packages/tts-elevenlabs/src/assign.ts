import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type VoiceCatalog = {
  voices: {
    id: string;
    name: string;
    category?: string | null;
    labels?: Record<string, any>;
    preview_url?: string | null;
  }[];
};

export type SpeakerMeta = {
  gender?: "male" | "female" | "child" | "neutral";
  role?: "narrator" | "teacher" | "student" | "system";
};

let cachedCatalog: VoiceCatalog | null = null;

export async function loadVoicesCatalog(
  file = "configs/elevenlabs.voices.json"
): Promise<VoiceCatalog> {
  if (cachedCatalog) return cachedCatalog;
  try {
    const raw = await readFile(resolve(file), "utf8");
    cachedCatalog = JSON.parse(raw) as VoiceCatalog;
    return cachedCatalog!;
  } catch {
    // If missing, caller should either run voices:sync or provide overrides.
    return { voices: [] };
  }
}

// crude heuristic for gender from speaker name if user didn't provide metadata
function guessGenderFromName(name: string): SpeakerMeta["gender"] {
  const n = name.trim().toLowerCase();
  if (!n) return "neutral";
  // simple heuristic: names ending with 'a' or common female markers
  if (/[ae]$/.test(n) || /(anna|maria|olga|mara|sofia|eva|lisa|emma)$/.test(n)) return "female";
  if (/(alex|john|mike|jack|dan|peter|paul|martin)$/.test(n)) return "male";
  return "neutral";
}

function getLabel(voice: any, key: string): string {
  const v = voice?.labels?.[key];
  return typeof v === "string" ? v.toLowerCase() : "";
}

function score(voice: any, need: SpeakerMeta): number {
  // higher is better
  let s = 0;

  const gender = (need.gender || "").toLowerCase();
  const role = (need.role || "").toLowerCase();

  const vGender = getLabel(voice, "gender"); // "male"|"female"|...
  const vUse = getLabel(voice, "use_case");  // e.g. "narration", "news", etc.
  const vCat = (voice.category || "").toLowerCase();

  if (gender) {
    if (vGender === gender) s += 40;
    else if (vGender && vGender !== gender) s -= 15;
  }

  if (role === "narrator") {
    if (vUse.includes("narration") || vCat.includes("narration")) s += 30;
  } else if (role === "teacher") {
    // prefer “narration”, “news” or “conversational” tones for clarity
    if (vUse.includes("narration") || vUse.includes("news") || vUse.includes("conversation")) s += 20;
  } else if (role === "student") {
    // neutral/conversational is fine
    if (vUse.includes("conversation")) s += 10;
  }

  // small bonus if there's an accent label (variety), but not critical
  if (getLabel(voice, "accent")) s += 3;

  return s;
}

export async function pickVoiceForSpeaker(
  speakerName: string,
  meta: SpeakerMeta = {}
): Promise<string | null> {
  const catalog = await loadVoicesCatalog();
  if (!catalog.voices.length) return null;

  const guessed: SpeakerMeta = {
    gender: meta.gender ?? guessGenderFromName(speakerName),
    role: meta.role ?? (speakerName.toLowerCase() === "narrator" ? "narrator" : undefined)
  };

  let best = { id: "", score: -Infinity };
  for (const v of catalog.voices) {
    const sc = score(v, guessed);
    if (sc > best.score) best = { id: v.id, score: sc };
  }

  return best.id || null;
}
