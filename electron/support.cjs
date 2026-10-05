'use strict';

/**
 * Plain Node helpers for the desktop app: finding the project source, probing
 * a running Caption Maker stack, and moving the desktop app's old data into
 * the project. They live apart from main.cjs so tests can load them without
 * Electron, and so the migration can also be run by hand:
 *
 *   node electron/support.cjs migrate --dry-run
 *   node electron/support.cjs migrate
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');

const APP_ID = 'caption-maker';
const DEFAULT_WEB_PORT = 5173;
const DEFAULT_API_PORT = 5180;

const readPort = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};

/** The same variables vite.config.ts and the server read, so all three agree. */
const resolvePorts = (env = process.env) => ({
  webPort: readPort(env.CM_WEB_PORT, DEFAULT_WEB_PORT),
  apiPort: readPort(env.CM_API_PORT || env.PORT, DEFAULT_API_PORT),
});

/** Real path where possible: `E:\Desktop\Caption Maker` is a link to the real folder. */
const canonical = (dir) => {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
};

const samePath = (a, b) => {
  if (!a || !b) return false;
  const x = canonical(a);
  const y = canonical(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/**
 * A project root is our package.json with the server source beside it. The
 * packaged app carries a package.json with the same name but no source, so it
 * never counts — that is what sends an installed copy to the bundled server.
 */
const isProjectRoot = (dir) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === APP_ID && fs.existsSync(path.join(dir, 'server', 'index.ts'));
  } catch {
    return false;
  }
};

/** Walks up from each start folder in turn; the first project root found wins. */
const findProjectRoot = (startDirs) => {
  for (const start of startDirs) {
    if (!start || typeof start !== 'string') continue;
    let dir = path.resolve(start);
    for (;;) {
      if (isProjectRoot(dir)) return canonical(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
};

/** GETs a health URL; resolves to the parsed JSON, or null for anything else. */
const probeHealth = (url, timeoutMs = 1500) =>
  new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs, headers: { accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 65536) body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });

/** Servers from before the health identity answered `{ ok: true }` only; those do not count. */
const isCaptionMakerHealth = (health) =>
  Boolean(health) && health.ok === true && health.app === APP_ID;

/**
 * Whether something accepts connections on the port. A connection test, not a
 * bind test, so it never disturbs the owner; a timeout counts as busy.
 */
const isPortInUse = (port, host = '127.0.0.1', timeoutMs = 800) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', (err) => done(err && err.code !== 'ECONNREFUSED'));
  });

/**
 * A stack is usable when the web server answers /api/health through its proxy
 * with our identity (so the page and its API both work) and the API answers
 * directly too.
 */
const probeStack = async ({ webPort, apiPort }, timeoutMs = 1500) => {
  const [web, api] = await Promise.all([
    probeHealth(`http://127.0.0.1:${webPort}/api/health`, timeoutMs),
    probeHealth(`http://127.0.0.1:${apiPort}/api/health`, timeoutMs),
  ]);
  return { web, api, healthy: isCaptionMakerHealth(web) && isCaptionMakerHealth(api) };
};

/** Minimal .env reader, matching the server's: KEY=value, # comments, optional quotes. */
const parseEnvFile = (file) => {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
};

/**
 * What the server would use for each setting with no user_settings.json entry.
 * Mirrors ConfigStore.getSettings (server/services/configStore.ts) — keep the
 * two in step.
 */
const SETTING_FALLBACKS = {
  groqApiKey: (env) => env.GROQ_API_KEY || env.AI_API_KEY,
  openRouterApiKey: (env) => env.OPENROUTER_API_KEY,
  openaiApiKey: (env) => env.OPENAI_API_KEY,
  geminiApiKey: (env) => env.GEMINI_API_KEY,
  geminiModel: (env) => env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  defaultProvider: (env) => env.AI_PROVIDER || 'groq',
  groqWhisperModel: (env) => env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
};

const listDirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

/** Every file under `dir` as a relative path, for copying and for checking a copy. */
const listFiles = (dir, base = dir) => {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
};

const treeSignature = (dir) =>
  listFiles(dir)
    .map((rel) => `${rel.toLowerCase()}:${fs.statSync(path.join(dir, rel)).size}`)
    .sort()
    .join('|');

const pad = (n) => String(n).padStart(2, '0');
const dateStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStamp = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const MARKER_FILE = '.migrated-to-project.json';

/**
 * A project stores absolute paths (its media file, rendered output), and the
 * server reads them as they are, so a moved project must have them rewritten
 * to its new home or its video goes missing. Replacing the JSON-escaped prefix
 * in the text keeps the file's formatting and every other value untouched.
 * Returns how many paths changed.
 */
const rewriteProjectPaths = (projectDir, prefixes) => {
  let changed = 0;
  for (const name of ['project.json', 'project.json.bak']) {
    const file = path.join(projectDir, name);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    const before = text;
    for (const [from, to] of prefixes) {
      const needle = JSON.stringify(from).slice(1, -1);
      const replacement = JSON.stringify(to).slice(1, -1);
      // only whole folder names: the prefix must be followed by a separator or the closing quote
      const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\\\\\\\|/|")', process.platform === 'win32' ? 'gi' : 'g');
      text = text.replace(pattern, () => {
        changed++;
        return replacement;
      });
    }
    if (text !== before) {
      JSON.parse(text); // never write back something the store could not read
      fs.writeFileSync(file, text, 'utf8');
    }
  }
  return changed;
};

/**
 * Moves the desktop app's old data folder into the project, so both apps read
 * one library:
 *
 *  - projects: copied when the id is not in the project yet. Each copy is made
 *    in a staging folder, checked file by file, then moved in with one rename,
 *    so a running server never lists a half-copied project.
 *  - output/ and fonts/: files the project does not have yet.
 *  - user_settings.json, once: keys the project's file lacks, and only when
 *    the value differs from what the project would use anyway (its .env or a
 *    built-in default). Copying an identical key would only pin today's value
 *    and quietly override a later .env change, because saved settings win.
 *
 * Nothing is deleted. Once every old project is in the project, the old
 * projects folder is renamed to `projects.migrated-<date>`, so the bundled
 * fallback does not show the same projects again and they can still be
 * restored by hand.
 */
const migrateLegacyData = async ({ legacyDir, root, dryRun = false, log = () => {}, now = new Date() }) => {
  const report = {
    legacyDir,
    root,
    dryRun,
    projects: { copied: [], alreadyPresent: [], failed: [] },
    pathsRewritten: 0,
    files: { copied: [], alreadyPresent: 0 },
    settings: { added: [], sameAsProject: [], projectHasKey: [], skippedEarlier: false, file: null },
    renamedProjectsTo: null,
  };
  if (!legacyDir || !root || !fs.existsSync(legacyDir)) return report;
  if (samePath(legacyDir, root) || samePath(legacyDir, path.join(root, 'data'))) return report;

  // 1. Projects
  const fromProjects = path.join(legacyDir, 'projects');
  const toProjects = path.join(root, 'projects');
  const staging = path.join(root, 'data', '.migration-staging');
  const ids = listDirs(fromProjects);
  for (const id of ids) {
    const src = path.join(fromProjects, id);
    const dest = path.join(toProjects, id);
    if (fs.existsSync(dest)) {
      report.projects.alreadyPresent.push(id);
      continue;
    }
    if (dryRun) {
      report.projects.copied.push(id);
      continue;
    }
    const temp = path.join(staging, id);
    try {
      await fsp.rm(temp, { recursive: true, force: true });
      await fsp.mkdir(staging, { recursive: true });
      await fsp.cp(src, temp, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      if (treeSignature(src) !== treeSignature(temp)) throw new Error('copy does not match the original');
      report.pathsRewritten += rewriteProjectPaths(temp, [
        [src, dest],
        [path.join(legacyDir, 'output'), path.join(root, 'output')],
        [path.join(legacyDir, 'fonts'), path.join(root, 'fonts')],
      ]);
      await fsp.mkdir(toProjects, { recursive: true });
      await fsp.rename(temp, dest);
      report.projects.copied.push(id);
      log(`[migrate] copied project ${id}`);
    } catch (err) {
      report.projects.failed.push({ id, error: err && err.message ? err.message : String(err) });
      log(`[migrate] could not copy project ${id}: ${err && err.message}`);
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (!dryRun) {
    try {
      if (fs.existsSync(staging) && fs.readdirSync(staging).length === 0) fs.rmdirSync(staging);
    } catch {}
  }

  // 2. Rendered output and uploaded fonts
  for (const sub of ['output', 'fonts']) {
    for (const rel of listFiles(path.join(legacyDir, sub))) {
      const dest = path.join(root, sub, rel);
      if (fs.existsSync(dest)) {
        report.files.alreadyPresent++;
        continue;
      }
      report.files.copied.push(path.join(sub, rel));
      if (!dryRun) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(path.join(legacyDir, sub, rel), dest, fs.constants.COPYFILE_EXCL);
      }
    }
  }

  // 3. Settings, once
  const markerPath = path.join(legacyDir, MARKER_FILE);
  const legacySettingsPath = path.join(legacyDir, 'user_settings.json');
  const projectSettingsPath = path.join(root, 'data', 'user_settings.json');
  report.settings.file = projectSettingsPath;
  if (fs.existsSync(markerPath)) {
    // a key cleared in the app afterwards must stay cleared, not come back from here
    report.settings.skippedEarlier = true;
  } else if (fs.existsSync(legacySettingsPath)) {
    let legacy = {};
    let current = {};
    try {
      legacy = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf8')) || {};
    } catch {}
    try {
      if (fs.existsSync(projectSettingsPath)) current = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf8')) || {};
    } catch {
      current = null; // unreadable: leave it alone rather than overwrite it
    }
    if (current) {
      const env = parseEnvFile(path.join(root, '.env'));
      const merged = { ...current };
      for (const [key, value] of Object.entries(legacy)) {
        if (value === undefined || value === null || value === '') continue;
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          report.settings.projectHasKey.push(key);
          continue;
        }
        const fallback = SETTING_FALLBACKS[key];
        if (fallback && fallback(env) === value) {
          report.settings.sameAsProject.push(key);
          continue;
        }
        merged[key] = value;
        report.settings.added.push(key);
      }
      if (!dryRun && report.settings.added.length > 0) {
        await fsp.mkdir(path.dirname(projectSettingsPath), { recursive: true });
        await fsp.writeFile(projectSettingsPath, JSON.stringify(merged, null, 2), 'utf8');
      }
    }
  }

  // 4. Retire the old projects folder once everything in it is in the project
  const allPresent = ids.length > 0 && ids.every((id) => fs.existsSync(path.join(toProjects, id)));
  if (!dryRun && allPresent) {
    let target = path.join(legacyDir, `projects.migrated-${dateStamp(now)}`);
    if (fs.existsSync(target)) target = `${target}-${timeStamp(now)}`;
    try {
      await fsp.rename(fromProjects, target);
      report.renamedProjectsTo = target;
      log(`[migrate] old projects folder kept as ${target}`);
    } catch (err) {
      log(`[migrate] could not rename ${fromProjects}: ${err && err.message}`);
    }
  }

  const changed = report.projects.copied.length > 0 || report.files.copied.length > 0 || report.renamedProjectsTo;
  if (!dryRun && (changed || !fs.existsSync(markerPath))) {
    const marker = { root, migratedAt: now.toISOString(), projects: report.projects.copied, settingsAdded: report.settings.added };
    try {
      const previous = fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath, 'utf8')) : null;
      await fsp.writeFile(markerPath, JSON.stringify(previous ? { ...previous, last: marker } : marker, null, 2), 'utf8');
    } catch {}
  }
  return report;
};

module.exports = {
  APP_ID,
  DEFAULT_WEB_PORT,
  DEFAULT_API_PORT,
  resolvePorts,
  canonical,
  samePath,
  isProjectRoot,
  findProjectRoot,
  probeHealth,
  isCaptionMakerHealth,
  isPortInUse,
  probeStack,
  parseEnvFile,
  listFiles,
  rewriteProjectPaths,
  migrateLegacyData,
};

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'migrate') {
    console.log('usage: node electron/support.cjs migrate [--dry-run] [--from <old data folder>]');
    process.exit(1);
  }
  const fromIndex = rest.indexOf('--from');
  const legacyDir =
    fromIndex >= 0 && rest[fromIndex + 1]
      ? path.resolve(rest[fromIndex + 1])
      : path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), APP_ID, 'data');
  const root = findProjectRoot([__dirname]);
  if (!root) {
    console.error('Could not find the Caption Maker project folder.');
    process.exit(1);
  }
  migrateLegacyData({ legacyDir, root, dryRun: rest.includes('--dry-run'), log: (line) => console.log(line) })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
