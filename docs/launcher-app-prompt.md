# Prompt: build a double-click launcher app for a dev project

Paste everything below the line into an AI coding assistant working in the
project you want a launcher for. It is written to be stack-agnostic — the
assistant is told to inspect the project and work out how it starts.

The "Traps" section is the valuable part. Every item in it is a real failure
that cost a debugging round the first time; leaving it in saves the next build
from repeating them.

---

## Task

Build me a launcher application for this project. I want to start the whole
thing by double-clicking one icon, without opening a terminal and without
asking an AI (which costs tokens every time).

It must also keep itself current: when I change this project — often with an AI
assistant editing files — the running app should pick those changes up on its
own, and the launcher should rebuild itself if its own source changes.

### Step 1 — work out how this project runs

Do not ask me. Inspect the project and determine:

- The package manager and dev command (`package.json` scripts, `Makefile`,
  `pyproject.toml`, `docker-compose.yml`, …).
- Every port involved, and where each is configured. Read the real config
  rather than assuming defaults, and honour env overrides the same way the app
  does.
- A readiness signal per service — a health endpoint if one exists, otherwise
  an open TCP port.
- Required tooling (Node, Python, FFmpeg, …) and how to detect it.

State what you found before you build anything.

### Step 2 — what the launcher must do

On double-click, in order:

1. **Preflight.** Verify required tooling is installed. If something is
   missing, say which, and offer to open its download page — do not fail with a
   silent error.
2. **Install.** Run the install step when dependencies are missing, or when the
   manifest or lockfile changed since the last successful install. Track this
   with a stamp file; do not reinstall on every launch.
3. **Clear stale ports.** A previous run killed the hard way leaves listeners
   behind. Find and kill them — but only processes whose names you expect
   (`node`, `python`, `cmd`), never an arbitrary PID.
4. **Start** the dev command as a child process, with output captured (not in a
   console window).
5. **Wait for readiness** by polling the health endpoint and ports. Never
   `sleep 10` and hope — that is the single most common reason a launcher opens
   a browser on a connection-refused page.
6. **Open the browser** once ready, and only on the first successful start.
7. **Show a window** with: status, the local URL, the LAN URL for other devices
   on the same Wi-Fi (with a Copy button), buttons for Open / Restart / Stop /
   Log file, and a live log pane.
8. **Stop everything on close** — the whole process tree, not just the direct
   child.

### Step 3 — keeping up with changes

Watch the project directory. Most edits need no help, because dev servers
already hot-reload their own source; the launcher exists to cover what they
cannot see. Build this table for *this* project and implement it:

| Changed | Action |
| --- | --- |
| Application source | Nothing — the dev server hot-reloads it. Log a line. |
| Manifest / lockfile | Install, then restart |
| `.env` or equivalent | Restart, so the server re-reads it at startup |
| The launcher's own source | Rebuild itself on next launch |

Debounce file events (~1.5s) — editors and formatters fire several per save.
Ignore `node_modules`, `.git`, build output, logs and your own build folder, or
the watcher will restart in a loop.

### Step 4 — self-rebuilding

The launcher compiles from a source file inside the project. On start, if that
source is newer than the built binary, rebuild and relaunch. A failed rebuild
must not be fatal: log the compiler errors and keep running the previous build,
so a syntax error can never leave me with no way to start the project.

## Platform and toolchain

Windows. Build a real `.exe` with the C# compiler that ships inside Windows:

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

WinForms, single `.cs` file, `/target:winexe`. Nothing to install, nothing to
keep updated, and it can rebuild itself anywhere Windows runs.

*(On macOS or Linux, substitute a small binary or an executable script with a
`.desktop` entry / `.app` bundle. The behaviour spec above is unchanged.)*

## Traps — read before writing code

**That compiler only understands C# 5.** No string interpolation (`$"..."`),
no null-conditional (`?.`), no expression-bodied members (`=>`), no `nameof`,
no auto-property initialisers. `async`/`await` *is* available. Getting this
wrong means the self-rebuild silently fails later.

**`Timer` is ambiguous** between `System.Threading` and `System.Windows.Forms`
when both are imported. Add `using UiTimer = System.Windows.Forms.Timer;`.

**An `AutoSize` label anchored `Top | Right` gets displaced by the first layout
pass and disappears.** Use `Dock` for anything on the right edge of a panel.
Screenshot the window and actually look at it before declaring the UI done.

**Windows will not overwrite a running exe, but it will rename one.** To
self-update: rename the running exe aside, move the new build into place,
relaunch, exit. Apply the same trick in the build script so a manual rebuild
works while the app is open.

**Self-update must run before you take the single-instance mutex** — the
relaunched process needs that mutex to be free, or it will refuse to start and
you will have no launcher at all.

**Kill process trees, not processes.** `npm run dev` is `cmd` → `npm` → `node`
→ children. Killing the child you spawned orphans everything under it and
leaves the ports held. Use `taskkill /PID <pid> /T /F`.

**A killed process reports `Exited` moments later**, after you have already
cleared your handle. Guard the handler with a reference check, or a deliberate
stop paints a false red "crashed" status.

**Set `StandardOutputEncoding = Encoding.UTF8`** or dev-server output arrives
as mojibake. Related: PowerShell 5.1's `Get-Content` reads as ANSI by default,
so a UTF-8 log looks corrupted when you check it — pass `-Encoding UTF8` before
concluding there is a bug.

**Set `BROWSER=none`** in the child environment so the dev server does not open
its own tab alongside yours.

**Cap the log pane.** Trim it periodically or a long session grows unbounded.

**PowerShell 5.1 quirks** if you write helper scripts: no `&&` or `||`; use
`-ArgumentList` for multi-argument `New-Object`; here-strings must close at
column 0.

## Deliverables

- The launcher source, in a `launcher/` folder inside the project
- A build script, and an icon generated programmatically (no binary assets
  committed by hand)
- The built executable in the project root
- A Desktop shortcut
- A README section covering how to start it and the change-handling table
- Build artefacts added to `.gitignore`

## Acceptance — verify, do not assume

Run each of these and show me the output. A claim without a check does not
count:

1. Launch the exe; confirm every port opens and the health endpoint returns
   200.
2. Close the window; confirm zero orphaned processes and every port released.
3. Backdate the launcher source; confirm it rebuilds and relaunches itself.
4. Touch the env file; confirm an automatic restart and that services come back.
5. Screenshot the window and inspect it for missing or misplaced controls.

Then tell me plainly what you did not verify, and anything I should know —
unsigned-binary warnings, runtime prerequisites, anything you created outside
the project folder.
