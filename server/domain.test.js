import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProject,
  makeScenes,
  quote,
  hashPassword,
  verifyPassword,
  assText,
  assTime,
} from "./domain.js";
test("credentials use salted password hashes and reject a different password", async () => {
  const hash = await hashPassword("a correct horse battery");
  assert.notEqual(hash, await hashPassword("a correct horse battery"));
  assert.equal(await verifyPassword("a correct horse battery", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
});
test("scene grouping preserves the full narration and bounds local scene count", () => {
  const script = Array.from(
    { length: 55 },
    (_, i) => `This is sentence ${i}.`,
  ).join(" ");
  const scenes = makeScenes(script, "forest");
  assert.ok(scenes.length <= 12);
  assert.equal(scenes.map((s) => s.text).join(" "), script);
  assert.ok(scenes.every((s) => s.background === "forest"));
});
test("input rejects empty/oversized scripts and normalizes unsafe options", () => {
  assert.throws(() => validateProject({}), /script or upload/);
  assert.throws(() => validateProject({ script: "x".repeat(8001) }), /8,000/);
  const p = validateProject({
    script: "A sufficiently long story.",
    voice: "not-a-voice",
    background: "../../file",
    musicVolume: 100,
    scenes: [{ text: "Hello", background: "/etc/passwd" }],
  });
  assert.equal(p.voice, "slt");
  assert.equal(p.background, "mountains");
  assert.equal(p.scenes[0].background, "mountains");
  assert.equal(p.musicVolume, 0.3);
  assert.equal(
    validateProject({ script: "A sufficiently long story.", musicVolume: 0 })
      .musicVolume,
    0,
  );
});
test("subtitle content cannot inject ASS overrides and timestamps carry correctly", () => {
  assert.equal(assText("{\\pos(0,0)}Hello\nworld"), "pos(0,0)Hello\\Nworld");
  assert.equal(assTime(59.999), "0:01:00.00");
  assert.equal(assTime(3661.25), "1:01:01.25");
});
test("quotes respect actual narration duration when audio is uploaded", () => {
  assert.equal(quote("short", 121).credits, 9);
  assert.equal(quote("short", 121).seconds, 121);
});
