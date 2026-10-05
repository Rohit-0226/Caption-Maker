'use strict';

/**
 * Caption Maker desktop window.
 *
 * The desktop app is a window onto the same live project the Web & Share
 * launcher serves, never a frozen copy of it. On start it picks one of three
 * ways in:
 *
 *  1. attach   — a Caption Maker stack already answers (the launcher started
 *                it, or another window did): load it and start nothing.
 *  2. owner    — the project source is reachable: run `npm run dev` there,
 *                hidden, and load it. On quit, stop only what was started here.
 *  3. bundled  — a packaged copy installed far from the source: run the
 *                bundled server with the desktop app's own data folder.
 *
 * So there is one server per machine, and a project uploaded through the
 * public link shows up here, and the other way round. Both owner and attach
 * load the same relative-URL web app other machines open over the LAN.
 *
 * Diagnostics go to %APPDATA%\caption-maker\logs (desktop.log, dev-stack.log).
 */

const { app, BrowserWindow, shell, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const support = require('./support.cjs');

app.setName('Caption Maker');
// The profile (window state, the bundled server's data, the remembered project
// folder) has always lived in %APPDATA%\caption-maker. Pin it, so the display
// name above, or starting Electron from another folder, never moves it.
app.setPath('userData', path.join(app.getPath('appData'), 'caption-maker'));
app.setAppUserModelId('com.captionmaker.app');

const PORTS = support.resolvePorts();
const WEB_URL = `http://localhost:${PORTS.webPort}`;
const BUNDLED_URL = `http://localhost:${PORTS.apiPort}`;
// Put in the stack's environment and echoed by /api/health, so this process
// can tell its own stack from one another app started at the same moment.
const OWNER_TAG = `electron:${process.pid}`;

const STARTUP_TIMEOUT_MS = 120000; // a cold Vite start plus a first tsx compile
const TAKEOVER_AFTER_MS = 20000; // longer than the launcher needs to restart its stack
const MONITOR_INTERVAL_MS = 3000;
// `npm run electron:dev` starts the stack beside this window; give it time to come up
const SIBLING_STARTING = process.argv.includes('--dev');
const FORCE_BUNDLED = (process.env.CM_DESKTOP_MODE || '').trim().toLowerCase() === 'bundled';

const USER_DATA = app.getPath('userData');
const LOG_DIR = path.join(USER_DATA, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'desktop.log');
const STACK_LOG_FILE = path.join(LOG_DIR, 'dev-stack.log');
const REMEMBERED_ROOT_FILE = path.join(USER_DATA, 'project-root.json');
const LEGACY_DATA_DIR = path.join(USER_DATA, 'data');

let mainWindow = null;
let mode = null; // 'attached' | 'owner' | 'bundled'
let projectRoot = null;
let stackChild = null; // the `npm run dev` tree started here, if any
let bundledServer = null;
let monitorTimer = null;
let envWatcher = null;
let busy = false;
let quitting = false;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const rotate = (file, maxBytes) => {
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.old`);
  } catch {}
};

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  rotate(LOG_FILE, 2 * 1024 * 1024);
  rotate(STACK_LOG_FILE, 5 * 1024 * 1024);
} catch {}

const log = (message) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const statusPage = (title, detail = '') =>
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>Caption Maker</title></head>` +
      `<body style="margin:0;background:#0b0d11;color:#e5e7eb;font:14px 'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">` +
      `<div style="max-width:720px;padding:24px"><h2 style="margin:0 0 12px;font-weight:600">${escapeHtml(title)}</h2>` +
      `<pre style="white-space:pre-wrap;color:#9ca3af;font:12px Consolas,monospace;margin:0">${escapeHtml(detail)}</pre></div></body></html>`,
  );

const showStatus = (title, detail) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(statusPage(title, detail));
};

const loadApp = (url) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  log(`Loading ${url}`);
  mainWindow.loadURL(url);
};

const iconPath = () =>
  [
    projectRoot && path.join(projectRoot, 'resources', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(__dirname, '..', 'resources', 'icon.ico'),
  ].find((p) => p && fs.existsSync(p));

const createWindow = () => {
  const options = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Caption Maker',
    backgroundColor: '#0b0d11',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };
  const icon = iconPath();
  if (icon) options.icon = icon;

  mainWindow = new BrowserWindow(options);

  // Open external links (Groq Console, OpenRouter, etc.) in the user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // The stack can vanish between the health check and the load (the owner
  // quitting, a restart). Retry once it answers; until then say so, and the
  // monitor reloads the app when the server is back or takes over for it.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('data:')) return;
    log(`Load failed (${code} ${description}) for ${url}`);
    setTimeout(async () => {
      if (quitting || busy || !mainWindow || mainWindow.isDestroyed()) return;
      const up =
        mode === 'bundled'
          ? Boolean(await support.probeHealth(`http://127.0.0.1:${PORTS.apiPort}/api/health`))
          : (await support.probeStack(PORTS)).healthy;
      if (up) mainWindow.loadURL(url);
      else showStatus('Reconnecting…', 'The Caption Maker server stopped answering. This window reconnects when it is back.');
    }, 2000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  showStatus('Starting Caption Maker…');
};

// ---------------------------------------------------------------------------
// Finding the project
// ---------------------------------------------------------------------------

const readRememberedRoot = () => {
  try {
    return JSON.parse(fs.readFileSync(REMEMBERED_ROOT_FILE, 'utf8')).root || null;
  } catch {
    return null;
  }
};

const rememberRoot = (root) => {
  if (support.samePath(readRememberedRoot(), root)) return;
  try {
    fs.writeFileSync(REMEMBERED_ROOT_FILE, JSON.stringify({ root, savedAt: new Date().toISOString() }, null, 2));
  } catch {}
};

/**
 * The source, from (in order) an explicit CAPTION_MAKER_PROJECT, the folder
 * Electron was pointed at, this file's folder, the executable's folder, and
 * the folder remembered from an earlier run — the last lets an installed copy
 * on this machine still run the live project.
 */
const locateProjectRoot = () =>
  support.findProjectRoot([
    process.env.CAPTION_MAKER_PROJECT,
    app.getAppPath(),
    __dirname,
    path.dirname(process.execPath),
    readRememberedRoot(),
  ]);

// ---------------------------------------------------------------------------
// The dev stack
// ---------------------------------------------------------------------------

const portsInUse = async () => {
  const [web, api] = await Promise.all([support.isPortInUse(PORTS.webPort), support.isPortInUse(PORTS.apiPort)]);
  return { web, api, any: web || api, both: web && api };
};

const waitForHealthyStack = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let stack = await support.probeStack(PORTS);
  while (!stack.healthy && Date.now() < deadline && !quitting) {
    await delay(500);
    stack = await support.probeStack(PORTS);
  }
  return stack;
};

const describeStack = (stack) => {
  const h = stack.web || {};
  return `owner ${h.owner || 'unknown'}, server pid ${h.pid}, data ${h.dataDir || '(not reported)'}`;
};

const startStackProcess = (root) => {
  const env = {
    ...process.env,
    CM_STACK_OWNER: OWNER_TAG,
    CM_WEB_PORT: String(PORTS.webPort),
    CM_API_PORT: String(PORTS.apiPort),
    PORT: String(PORTS.apiPort),
    BROWSER: 'none',
    NO_COLOR: '1',
  };
  // The live project keeps its data in the project folder; an inherited
  // override would split the library again.
  delete env.CAPTION_MAKER_DATA_DIR;
  delete env.CAPTION_MAKER_ROOT;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.FORCE_COLOR;

  const out = fs.createWriteStream(STACK_LOG_FILE, { flags: 'a' });
  out.on('error', () => {});
  out.write(`\n=== ${new Date().toISOString()} npm run dev in ${root} (owner ${OWNER_TAG}, web ${PORTS.webPort}, api ${PORTS.apiPort}) ===\n`);

  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('npm', ['run', 'dev'], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on('error', (err) => log(`Could not run npm: ${err.message}`));
  child.on('exit', (code) => {
    log(`Dev stack process ${child.pid} exited (code ${code})`);
    if (stackChild === child) stackChild = null;
    out.end();
  });
  stackChild = child;
  log(`Started npm run dev (pid ${child.pid}) in ${root}`);
  return child;
};

/** Stops the process tree started here, and nothing else. */
const stopOwnStack = () => {
  const child = stackChild;
  stackChild = null;
  if (!child || hasExited(child) || !child.pid) return;
  log(`Stopping the dev stack started here (pid ${child.pid} and its children)`);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
};

const tailOfStackLog = () => {
  try {
    return fs.readFileSync(STACK_LOG_FILE, 'utf8').split(/\r?\n/).slice(-25).join('\n');
  } catch {
    return '';
  }
};

/** npm run dev needs node_modules; install once, as the launcher does. */
const ensureDependencies = (root) =>
  new Promise((resolve) => {
    if (fs.existsSync(path.join(root, 'node_modules', '.bin'))) return resolve(true);
    log('node_modules missing; running npm install');
    showStatus('Installing dependencies…', 'First run in this folder: npm install');
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm install'], { cwd: root, windowsHide: true, stdio: 'ignore' })
        : spawn('npm', ['install'], { cwd: root, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });

const attach = (stack) => {
  mode = 'attached';
  log(`Attached to the running Caption Maker stack (${describeStack(stack)}); started nothing`);
  if (projectRoot && stack.web && stack.web.dataDir && !support.samePath(stack.web.dataDir, projectRoot)) {
    log(`Warning: that stack serves ${stack.web.dataDir}, not ${projectRoot}`);
  }
  loadApp(WEB_URL);
};

/** Runs the dev stack from the project and loads it, or attaches if another app won the race. */
const becomeOwner = async () => {
  const ports = await portsInUse();
  if (ports.any) {
    const which = [ports.web && PORTS.webPort, ports.api && PORTS.apiPort].filter(Boolean).join(' and ');
    log(`Port ${which} is in use but not by a working Caption Maker; not starting a second stack`);
    showStatus(
      'Caption Maker could not start',
      `Port ${which} is in use by another program, or by a Caption Maker server that is not answering.\n` +
        `Close it (or wait for it to finish starting) and this window will connect by itself.\n\nLog: ${LOG_FILE}`,
    );
    return false;
  }

  if (!(await ensureDependencies(projectRoot))) {
    showStatus('Caption Maker could not start', `npm install failed in ${projectRoot}.\n\nLog: ${LOG_FILE}`);
    return false;
  }

  showStatus('Starting Caption Maker…', `Running the project from ${projectRoot}`);
  const child = startStackProcess(projectRoot);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && !quitting) {
    const stack = await support.probeStack(PORTS);
    if (stack.healthy) {
      if (stack.web.owner === OWNER_TAG && stack.api.owner === OWNER_TAG) {
        mode = 'owner';
        log(`Dev stack is up (${describeStack(stack)})`);
        loadApp(WEB_URL);
        watchEnvFile();
        return true;
      }
      // Another app started its stack at the same moment and got the ports.
      log('Another app owns the stack that answered; stopping the copy started here');
      stopOwnStack();
      attach(stack);
      return true;
    }
    if (hasExited(child)) break;
    await delay(500);
  }

  if (quitting) return false;
  const stack = await support.probeStack(PORTS);
  stopOwnStack();
  if (stack.healthy) {
    attach(stack);
    return true;
  }
  log('The dev stack did not come up');
  showStatus('Caption Maker could not start', `The dev server did not answer.\n\n${tailOfStackLog()}\n\nFull log: ${STACK_LOG_FILE}`);
  return false;
};

/** `.env` is read once at server start; when it changes, restart the stack this app owns. */
const watchEnvFile = () => {
  if (envWatcher || !projectRoot) return;
  let timer = null;
  try {
    envWatcher = fs.watch(projectRoot, (_event, filename) => {
      if (filename !== '.env' || mode !== 'owner') return;
      clearTimeout(timer);
      timer = setTimeout(restartOwnStack, 1500);
    });
  } catch (err) {
    log(`Cannot watch .env: ${err.message}`);
  }
};

const restartOwnStack = async () => {
  if (busy || quitting || mode !== 'owner') return;
  busy = true;
  try {
    log('.env changed; restarting the dev stack to load it');
    stopOwnStack();
    const deadline = Date.now() + 10000;
    while ((await portsInUse()).any && Date.now() < deadline) await delay(300);
    await becomeOwner();
  } finally {
    busy = false;
  }
};

/**
 * Keeps the window working when the stack goes away. Attached: once the
 * owner has been gone long enough and both ports are free, start our own —
 * the launcher restarting its stack frees them for a few seconds only. Owner:
 * only if our own `npm run dev` has died; a server crash inside it recovers
 * by itself on the next file change, so restarting would not help.
 */
const startMonitor = () => {
  if (monitorTimer || !projectRoot) return;
  let downSince = 0;
  monitorTimer = setInterval(async () => {
    if (busy || quitting) return;
    const stack = await support.probeStack(PORTS);
    if (stack.healthy) {
      if (downSince) log(`Stack answering again (${describeStack(stack)})`);
      downSince = 0;
      // after a failed start nothing is loaded yet; after an outage a status page may be showing
      if (!mode) attach(stack);
      else if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL().startsWith('data:')) loadApp(WEB_URL);
      return;
    }
    if (!downSince) {
      downSince = Date.now();
      log('Stack stopped answering');
      return;
    }
    if (Date.now() - downSince < TAKEOVER_AFTER_MS) return;
    if (mode === 'owner' && stackChild) return;
    if ((await portsInUse()).any) return;

    busy = true;
    try {
      log(mode === 'owner' ? 'Our dev stack has stopped; starting it again' : 'The stack this window used has gone; starting one here');
      downSince = 0;
      await becomeOwner();
    } finally {
      busy = false;
    }
  }, MONITOR_INTERVAL_MS);
};

// ---------------------------------------------------------------------------
// Bundled fallback (packaged copy without the source)
// ---------------------------------------------------------------------------

const startBundled = async () => {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist-server', 'index.js'),
    path.join(app.getAppPath(), 'dist-server', 'index.js'),
    path.join(__dirname, '..', 'dist-server', 'index.js'),
  ];
  const serverPath = candidates.find((p) => fs.existsSync(p));
  if (!serverPath) {
    log('No project source and no bundled server found');
    showStatus('Caption Maker could not start', 'Neither the project folder nor a bundled server was found.');
    return;
  }

  if ((await portsInUse()).api) {
    showStatus('Caption Maker could not start', `Port ${PORTS.apiPort} is in use by another program.`);
    return;
  }

  // Far from the source, the desktop app keeps its own data folder (the
  // variable lets a test point it elsewhere).
  const dataDir = (process.env.CAPTION_MAKER_DATA_DIR || '').trim() || LEGACY_DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  const targetEnv = path.join(dataDir, '.env');
  const sourceEnv = path.join(process.resourcesPath || '', '.env');
  if (!fs.existsSync(targetEnv) && fs.existsSync(sourceEnv)) {
    try {
      fs.copyFileSync(sourceEnv, targetEnv);
    } catch {}
  }

  const rootPath = app.isPackaged ? path.join(process.resourcesPath || '', 'app.asar.unpacked') : path.resolve(__dirname, '..');
  log(`Starting the bundled server ${serverPath} (data ${dataDir}, port ${PORTS.apiPort})`);
  bundledServer = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(PORTS.apiPort),
      CAPTION_MAKER_DATA_DIR: dataDir,
      CAPTION_MAKER_ROOT: rootPath,
      CM_STACK_OWNER: OWNER_TAG,
      RESOURCES_PATH: process.resourcesPath || '',
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
  });
  bundledServer.stdout?.on('data', (data) => log(`[server] ${data.toString().trim()}`));
  bundledServer.stderr?.on('data', (data) => log(`[server] ${data.toString().trim()}`));
  bundledServer.on('exit', (code) => {
    log(`Bundled server exited (code ${code})`);
    bundledServer = null;
  });

  // our own process, so a plain `{ ok: true }` from an older bundle is enough
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !quitting) {
    const health = await support.probeHealth(`http://127.0.0.1:${PORTS.apiPort}/api/health`);
    if (health && health.ok === true) {
      mode = 'bundled';
      loadApp(BUNDLED_URL);
      return;
    }
    if (!bundledServer) break;
    await delay(400);
  }
  showStatus('Caption Maker could not start', `The bundled server did not answer.\n\nLog: ${LOG_FILE}`);
};

// ---------------------------------------------------------------------------
// Start-up and shutdown
// ---------------------------------------------------------------------------

const migrateLegacyData = async () => {
  if (!projectRoot || !fs.existsSync(LEGACY_DATA_DIR)) return;
  try {
    const report = await support.migrateLegacyData({ legacyDir: LEGACY_DATA_DIR, root: projectRoot, log });
    if (report.projects.copied.length || report.files.copied.length || report.settings.added.length) {
      log(
        `Moved the desktop app's older data into the project: ${report.projects.copied.length} project(s), ` +
          `${report.files.copied.length} file(s), settings ${report.settings.added.join(', ') || 'none'}`,
      );
    }
  } catch (err) {
    log(`Data migration failed: ${err.message}`);
  }
};

const launch = async () => {
  log(`Desktop app starting (pid ${process.pid}, web ${PORTS.webPort}, api ${PORTS.apiPort}, packaged ${app.isPackaged})`);
  projectRoot = FORCE_BUNDLED ? null : locateProjectRoot();
  if (projectRoot) {
    log(`Project folder: ${projectRoot}`);
    rememberRoot(projectRoot);
    await migrateLegacyData();
  } else {
    log('Project folder not found; using the bundled server');
  }

  // 1. Attach to a stack that is up, or about to be (ports already taken, or
  //    `electron:dev` starting one beside us).
  let stack = await support.probeStack(PORTS);
  if (!stack.healthy) {
    const waitMs = SIBLING_STARTING ? 60000 : (await portsInUse()).any ? 30000 : 0;
    if (waitMs) {
      log(`Waiting up to ${waitMs / 1000}s for a stack that is starting`);
      stack = await waitForHealthyStack(waitMs);
    }
  }
  if (quitting) return;
  if (stack.healthy) {
    attach(stack);
    startMonitor();
    return;
  }

  // 2. Run the live project; 3. or the bundled server.
  if (projectRoot) {
    await becomeOwner();
    startMonitor();
  } else {
    await startBundled();
  }
};

if (!app.requestSingleInstanceLock()) {
  // a second launch only brings the open window forward
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    launch().catch((err) => {
      log(`Start-up failed: ${err && err.stack ? err.stack : err}`);
      showStatus('Caption Maker could not start', String(err && err.message ? err.message : err));
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    quitting = true;
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = null;
    if (envWatcher) envWatcher.close();
    envWatcher = null;
  });

  app.on('will-quit', () => {
    if (mode === 'attached') log('Closing; the shared stack keeps running for its owner');
    stopOwnStack();
    if (bundledServer) {
      try {
        bundledServer.kill();
      } catch {}
      bundledServer = null;
    }
    log('Desktop app closed');
  });

  // an uncaught error ending this process must not leave its stack running
  process.on('exit', stopOwnStack);
}
