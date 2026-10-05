/**
 * Sync audit — how closely a project's caption words follow its audio.
 *
 *   npm run audit:sync                    every project here and in the desktop app's data folder
 *   npm run audit:sync -- <projectDir>    specific projects
 *   npm run audit:sync -- --refine        also show what timing refinement alone would change
 *
 * Three numbers, all measured against the audio rather than trusted from a model:
 *
 *   pauses respected   real pauses (>= 300 ms) that fall between two words; low means captions
 *                      change while the speaker is silent and sit still while they talk
 *   starts in silence  words that begin before anyone is talking
 *   speech, no words   speech with no caption word near it — speech that was lost
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseWavPcm16 } from '../src/core/speech/pcm';
import { buildSpeechMap } from '../src/core/speech/speechMap';
import { measureTimingQuality, refineWordTimings, type TimingQuality } from '../src/core/speech/timing';
import type { CaptionProject } from '../src/core/types/project';

const args = process.argv.slice(2);
const showRefined = args.includes('--refine');
const explicit = args.filter((arg) => !arg.startsWith('--'));

const roots = [
  path.resolve('projects'),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'caption-maker', 'data', 'projects')] : []),
];

const projectDirs = explicit.length > 0
  ? explicit.map((dir) => path.resolve(dir))
  : roots.flatMap((root) => (fs.existsSync(root) ? fs.readdirSync(root).map((id) => path.join(root, id)) : []));

const percent = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);

const describe = (label: string, quality: TimingQuality, wordCount: number) =>
  [
    `  ${label.padEnd(9)}`,
    `pauses respected ${percent(quality.pausesRespected).padStart(4)} of ${quality.pauseCount}`,
    `starts in silence ${String(quality.startsInSilence).padStart(3)}/${wordCount}`,
    `speech, no words ${quality.uncoveredSpeechSeconds.toFixed(1)}s of ${quality.speechSeconds.toFixed(1)}s (coverage ${percent(quality.coverage)})`,
  ].join('  |  ');

let audited = 0;

for (const dir of projectDirs) {
  const projectFile = path.join(dir, 'project.json');
  const audioFile = path.join(dir, 'audio.wav');
  if (!fs.existsSync(projectFile) || !fs.existsSync(audioFile)) continue;

  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as CaptionProject;
  if (!project.transcript?.words.length) continue;

  const bytes = fs.readFileSync(audioFile);
  const audio = parseWavPcm16(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (!audio) {
    console.log(`\n${path.basename(dir)}: audio.wav is not 16-bit PCM — skipped`);
    continue;
  }

  const map = buildSpeechMap(audio.samples, audio.sampleRate);
  const words = project.transcript.words;

  console.log(`\n${project.media?.fileName ?? path.basename(dir)}  (${path.basename(dir)})`);
  console.log(`  engine    ${project.transcript.providerId} · ${project.transcript.modelId} · ${project.transcript.language}`);
  if (!map.reliable) console.log('  note      background too constant to locate pauses; numbers are not meaningful');

  console.log(describe('stored', measureTimingQuality(words, map), words.length));

  if (showRefined) {
    const refined = refineWordTimings(words, map).words;
    console.log(describe('refined', measureTimingQuality(refined, map), refined.length));
  }

  audited++;
}

if (audited === 0) {
  console.log('No projects with both a transcript and audio.wav were found.');
  process.exitCode = 1;
}
