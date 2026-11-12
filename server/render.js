import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assText, assTime, makeScenes } from "./domain.js";

export function command(binary, args, signal) {
  return new Promise((resolve, reject) => {
    let output = "",
      errors = "";
    const child = spawn(binary, args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => {
      output = (output + d).slice(-20000);
    });
    child.stderr.on("data", (d) => {
      errors = (errors + d).slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              signal?.aborted
                ? "Cancelled"
                : `${binary} failed: ${errors.slice(-1500)}`,
            ),
          ),
    );
  });
}
export async function probe(file) {
  return JSON.parse(
    await command("ffprobe", [
      "-v",
      "quiet",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      file,
    ]),
  );
}
function wrap(text, max) {
  const lines = [""];
  for (const word of text.split(/\s+/)) {
    if (lines.at(-1).length + word.length > max) lines.push("");
    lines[lines.length - 1] += (lines.at(-1) ? " " : "") + word;
  }
  return lines.join("\n");
}
export async function renderVideo({
  project,
  root,
  media,
  audioFile,
  musicFile,
  signal,
  progress,
  runId,
}) {
  const work = path.join(root, "renders", project.id, runId);
  await mkdir(work, { recursive: true });
  const width = project.aspect === "9:16" ? 1080 : 1920;
  const height = project.aspect === "9:16" ? 1920 : 1080;
  const ff = (args) =>
    command(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", ...args],
      signal,
    );
  let narration = path.join(work, "narration.wav");
  progress(8, "Recording narration");
  if (audioFile)
    await ff(["-i", audioFile, "-vn", "-ar", "44100", "-ac", "1", narration]);
  else {
    await writeFile(path.join(work, "script.txt"), project.script);
    await ff([
      "-f",
      "lavfi",
      "-i",
      `flite=textfile=${path.join(work, "script.txt")}:voice=${project.voice}`,
      "-ar",
      "44100",
      narration,
    ]);
  }
  const duration = Number((await probe(narration)).format.duration);
  if (!Number.isFinite(duration) || duration > 600 || duration < 0.3)
    throw new Error("Narration must be between 0.3 seconds and 10 minutes.");
  const scenes = project.scenes?.length
    ? project.scenes
    : makeScenes(project.script, project.background);
  const totalWords = scenes.reduce(
    (sum, s) => sum + Math.max(1, s.text.split(/\s+/).length),
    0,
  );
  let cursor = 0;
  const timed = scenes.map((s, i) => {
    const start = cursor;
    const seconds =
      i === scenes.length - 1
        ? duration - start
        : (duration * Math.max(1, s.text.split(/\s+/).length)) / totalWords;
    cursor += seconds;
    return { ...s, start, end: cursor, seconds };
  });
  for (let i = 0; i < timed.length; i++) {
    signal.throwIfAborted();
    const scene = timed[i];
    progress(
      15 + Math.round((i / timed.length) * 60),
      `Composing scene ${i + 1} of ${timed.length}`,
    );
    const imagePath = path.join(work, `scene-${i}.jpg`);
    if (scene.background === "minimal") {
      await sharp({
        create: { width, height, channels: 3, background: "#172a54" },
      })
        .jpeg()
        .toFile(imagePath);
    } else {
      await sharp(path.join(media, `${scene.background}.jpg`))
        .resize(width, height, { fit: "cover" })
        .jpeg()
        .toFile(imagePath);
    }
    const frames = Math.ceil(scene.seconds * 24);
    await ff([
      "-i",
      imagePath,
      "-vf",
      `scale=${width + 200}:-1,zoompan=z='min(zoom+0.0004,1.08)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${frames}:s=${width}x${height}:fps=24,setsar=1,format=yuv420p`,
      "-t",
      scene.seconds.toFixed(3),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      path.join(work, `clip-${i}.mp4`),
    ]);
  }
  const captions = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,DejaVu Sans,${project.aspect === "9:16" ? 52 : 44},&H00FFFFFF,&H00FFFFFF,&H00202020,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,2,90,90,100,1\nStyle: Title,DejaVu Sans,${project.aspect === "9:16" ? 65 : 58},&H00FFFFFF,&H00FFFFFF,&H00202020,&H90000000,-1,0,0,0,100,100,0,0,1,2,1,8,80,80,95,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  let events = "";
  if (project.captions)
    for (const scene of timed) {
      const chunks = scene.text.match(/(?:\S+\s*){1,10}/g) || [];
      chunks.forEach((chunk, i) => {
        const start = scene.start + (scene.seconds * i) / chunks.length;
        const end = scene.start + (scene.seconds * (i + 1)) / chunks.length;
        events += `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${assText(wrap(chunk.trim(), project.aspect === "9:16" ? 26 : 54))}\n`;
      });
    }
  if (project.graphics)
    events += `Dialogue: 1,${assTime(0)},${assTime(Math.min(4, duration))},Title,,0,0,0,,{\\fad(300,500)}${assText(wrap(project.title, project.aspect === "9:16" ? 20 : 45))}\n`;
  await writeFile(path.join(work, "captions.ass"), captions + events);
  await writeFile(
    path.join(work, "clips.txt"),
    timed
      .map((_, i) => `file '${path.join(work, `clip-${i}.mp4`)}'`)
      .join("\n"),
  );
  progress(82, "Adding captions and mixing sound");
  const args = [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.join(work, "clips.txt"),
    "-i",
    narration,
  ];
  if (project.music && musicFile)
    args.push("-stream_loop", "-1", "-i", musicFile);
  else if (project.music)
    args.push(
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.035*(sin(2*PI*130.81*t)+sin(2*PI*164.81*t)+sin(2*PI*196*t)):s=44100",
    );
  if (project.music)
    args.push(
      "-filter_complex",
      `[2:a]volume=${project.musicVolume}[bg];[1:a][bg]amix=inputs=2:duration=first:normalize=0[a]`,
      "-map",
      "0:v",
      "-map",
      "[a]",
    );
  else args.push("-map", "0:v", "-map", "1:a");
  args.push(
    "-vf",
    `ass=${path.join(work, "captions.ass")}`,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    path.join(work, "video.mp4"),
  );
  await ff(args);
  progress(98, "Finishing your video");
  await ff([
    "-i",
    path.join(work, "video.mp4"),
    "-frames:v",
    "1",
    "-update",
    "1",
    "-vf",
    "scale=640:-1",
    path.join(work, "poster.jpg"),
  ]);
  return {
    file: path.relative(root, path.join(work, "video.mp4")),
    poster: path.relative(root, path.join(work, "poster.jpg")),
    duration,
    scenes: timed,
  };
}
