import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const BACKGROUNDS = [
  "mountains",
  "ocean",
  "forest",
  "space",
  "night",
  "minimal",
];
export const VOICES = ["slt", "rms", "awb", "kal"];
export function validateProject(input) {
  const script = String(input.script || "").trim();
  if (script.length > 8000)
    throw new Error(
      "Keep your script under 8,000 characters for local rendering.",
    );
  if (!script && !input.audioId)
    throw new Error("Add a script or upload narration first.");
  if (script && script.length < 12)
    throw new Error("Your script needs at least 12 characters.");
  const title = String(
    input.title || script.split(/[.!?\n]/)[0] || "Untitled video",
  )
    .trim()
    .slice(0, 100);
  return {
    title,
    script,
    audioId: input.audioId || null,
    musicId: input.musicId || null,
    voice: VOICES.includes(input.voice) ? input.voice : "slt",
    background: BACKGROUNDS.includes(input.background)
      ? input.background
      : "mountains",
    aspect: input.aspect === "9:16" ? "9:16" : "16:9",
    captions: input.captions !== false,
    graphics: input.graphics !== false,
    music: !!input.music,
    musicVolume: Math.max(
      0,
      Math.min(
        0.3,
        Number.isFinite(Number(input.musicVolume))
          ? Number(input.musicVolume)
          : 0.08,
      ),
    ),
    scenes: Array.isArray(input.scenes)
      ? input.scenes.slice(0, 40).map((s) => ({
          text: String(s.text || "").slice(0, 1200),
          background: BACKGROUNDS.includes(s.background)
            ? s.background
            : "mountains",
        }))
      : [],
  };
}
export function makeScenes(script, background = "mountains") {
  const sentences =
    script
      .match(/[^.!?\n]+[.!?]?/g)
      ?.map((s) => s.trim())
      .filter(Boolean) || [];
  const size = Math.max(1, Math.ceil(sentences.length / 12));
  const scenes = [];
  for (let i = 0; i < sentences.length; i += size)
    scenes.push({ text: sentences.slice(i, i + size).join(" "), background });
  return scenes.length ? scenes : [{ text: "", background }];
}
export function quote(script, audioDuration = 0) {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const seconds = audioDuration || Math.max(3, words / 2.25);
  return {
    words,
    seconds: Math.round(seconds),
    credits: Math.max(1, Math.ceil(seconds / 15)),
  };
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return (
    salt + ":" + Buffer.from(await scrypt(password, salt, 64)).toString("hex")
  );
}
export async function verifyPassword(password, hash) {
  const [salt, stored] = hash.split(":");
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function assText(text) {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, "\\N");
}
export function assTime(seconds) {
  const cs = Math.round(seconds * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
