import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { api, ApiError } from './api';
import { useEditor } from './store';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { TopBar } from './TopBar';
import { NavRail, type RailSection } from './NavRail';
import { TranscribeWorkspace } from '../features/workspace/TranscribeWorkspace';
import { SystemWorkspace } from '../features/workspace/SystemWorkspace';
import { TemplatesPanel } from '../features/styling/TemplatesPanel';
import { AIPanel } from '../features/ai/AIPanel';
import { MediaImport } from '../features/media/MediaImport';
import { Preview } from '../features/preview/Preview';
import { Timeline } from '../features/timeline/Timeline';
import { Inspector } from '../features/styling/Inspector';
import { ExportDialog } from '../features/export/ExportDialog';
import { PanelResizer } from '../components/PanelResizer';
import { Button } from '../components/controls';
import { EmptyState, ErrorState, Spinner } from '../components/feedback';
import { IconLayers, IconLogo, IconSparkle } from '../components/icons';

const LAST_PROJECT_KEY = 'caption-maker:last-project';
const PANEL_LEFT_WIDTH_KEY = 'caption-maker:panel-left-width';
const PANEL_RIGHT_WIDTH_KEY = 'caption-maker:panel-right-width';
const PANEL_LEFT_COLLAPSED_KEY = 'caption-maker:left-collapsed';
const PANEL_RIGHT_COLLAPSED_KEY = 'caption-maker:right-collapsed';
const TIMELINE_HEIGHT_KEY = 'caption-maker:timeline-height';

const DEFAULT_LEFT_WIDTH = 460;
const DEFAULT_RIGHT_WIDTH = 340;
const DEFAULT_TIMELINE_HEIGHT = 200;

export const App: React.FC = () => {
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [rail, setRail] = useState<RailSection>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('rail');
      if (param && ['captions', 'templates', 'ai', 'system'].includes(param)) {
        return param as RailSection;
      }
    }
    return 'captions';
  });

  const [isLeftCollapsed, setIsLeftCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_LEFT_COLLAPSED_KEY);
      if (saved !== null) return saved === 'true';
    } catch {}
    return false;
  });

  const [isRightCollapsed, setIsRightCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_RIGHT_COLLAPSED_KEY);
      if (saved !== null) return saved === 'true';
    } catch {}
    return false; // Open by default for instant access to styles & templates
  });

  const handleToggleLeft = useCallback(() => {
    setIsLeftCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PANEL_LEFT_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleToggleRight = useCallback(() => {
    setIsRightCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PANEL_RIGHT_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const [leftWidth, setLeftWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_LEFT_WIDTH_KEY);
      if (saved) {
        const val = Number(saved);
        if (val >= 240 && val <= 700) return val;
      }
    } catch {}
    return DEFAULT_LEFT_WIDTH;
  });

  const [rightWidth, setRightWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_RIGHT_WIDTH_KEY);
      if (saved) {
        const val = Number(saved);
        if (val >= 240 && val <= 600) return val;
      }
    } catch {}
    return DEFAULT_RIGHT_WIDTH;
  });

  const [timelineHeight, setTimelineHeight] = useState(() => {
    try {
      const saved = localStorage.getItem(TIMELINE_HEIGHT_KEY);
      if (saved) {
        const val = Number(saved);
        if (val >= 100 && val <= 460) return val;
      }
    } catch {}
    return DEFAULT_TIMELINE_HEIGHT;
  });

  const handleResizeLeft = useCallback((w: number) => {
    setLeftWidth(w);
    try {
      localStorage.setItem(PANEL_LEFT_WIDTH_KEY, String(w));
    } catch {}
  }, []);

  const handleResizeRight = useCallback((w: number) => {
    setRightWidth(w);
    try {
      localStorage.setItem(PANEL_RIGHT_WIDTH_KEY, String(w));
    } catch {}
  }, []);

  const handleResizeTimeline = useCallback((h: number) => {
    setTimelineHeight(h);
    try {
      localStorage.setItem(TIMELINE_HEIGHT_KEY, String(h));
    } catch {}
  }, []);

  const playerRef = useRef<PlayerRef>(null);

  const openExport = useCallback(() => setExportOpen(true), []);
  useKeyboardShortcuts({
    playerRef,
    onExport: openExport,
    onToggleLeft: handleToggleLeft,
    onToggleRight: handleToggleRight,
  });

  /** Reopen whatever was last worked on, or start a fresh project. */
  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      // Resilient connection: retry up to 6 times with 800ms delays in case
      // the server is spinning up right as the browser opens
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          await api.health();
          break;
        } catch (err) {
          if (attempt === 6) throw err;
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      // Check URL search params for deep-linked ?project=...
      const urlProject = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('project')
        : null;
      if (urlProject) {
        try {
          setProject(await api.loadProject(urlProject));
          return;
        } catch {
          // If specified project ID is invalid or deleted, fall back normally
        }
      }

      const remembered = localStorage.getItem(LAST_PROJECT_KEY);
      if (remembered) {
        try {
          setProject(await api.loadProject(remembered));
          return;
        } catch {
          localStorage.removeItem(LAST_PROJECT_KEY);
        }
      }

      const existing = await api.listProjects();
      setProject(
        existing.length > 0
          ? await api.loadProject(existing[0].id)
          : await api.createProject('Untitled project'),
      );
    } catch (error) {
      setBootError(
        error instanceof ApiError && error.status === 0
          ? 'The Caption Maker server is not responding. Start it with "npm run dev" and reload.'
          : (error as Error).message,
      );
    } finally {
      setBooting(false);
    }
  }, [setProject]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    (window as any).__STORE__ = useEditor;
    if (project) localStorage.setItem(LAST_PROJECT_KEY, project.id);
  }, [project?.id]);

  // a last-chance save if the window closes mid-edit
  useEffect(() => {
    const onBeforeUnload = () => {
      if (useEditor.getState().saveStatus === 'saving') void useEditor.getState().save();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (booting) {
    return (
      <div className="cm-boot">
        <IconLogo size={40} />
        <Spinner size={18} label="Starting Caption Maker" />
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="cm-boot">
        <div style={{ maxWidth: 460, width: '100%' }}>
          <ErrorState
            title="Could not start"
            message={bootError}
            onRetry={() => void boot()}
            retryLabel="Try again"
          />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="cm-boot">
        <EmptyState
          title="No project open"
          description="Create a project to get started."
          action={
            <Button
              variant="primary"
              onClick={async () => setProject(await api.createProject('Untitled project'))}
            >
              New project
            </Button>
          }
        />
      </div>
    );
  }

  if (!project.media) {
    return (
      <div className="cm-app cm-app--empty">
        <TopBar
          onExport={openExport}
          isLeftCollapsed={isLeftCollapsed}
          onToggleLeft={handleToggleLeft}
          isRightCollapsed={isRightCollapsed}
          onToggleRight={handleToggleRight}
        />
        <MediaImport projectId={project.id} />
      </div>
    );
  }

  return (
    <div className="cm-app">
      <TopBar
        onExport={openExport}
        isLeftCollapsed={isLeftCollapsed}
        onToggleLeft={handleToggleLeft}
        isRightCollapsed={isRightCollapsed}
        onToggleRight={handleToggleRight}
      />

      <div
        className={`cm-workspace ${isLeftCollapsed ? 'is-left-collapsed' : ''} ${isRightCollapsed ? 'is-right-collapsed' : ''}`}
        style={
          {
            '--panel-left-width': `${leftWidth}px`,
            '--panel-right-width': `${rightWidth}px`,
          } as React.CSSProperties
        }
      >
        <NavRail
          active={rail}
          onChange={(nextRail) => {
            if (isLeftCollapsed) {
              setIsLeftCollapsed(false);
              setRail(nextRail);
            } else if (rail === nextRail) {
              setIsLeftCollapsed(true);
            } else {
              setRail(nextRail);
            }
          }}
          isCollapsed={isLeftCollapsed}
          onToggleCollapse={handleToggleLeft}
        />

        {/* Left Panel: Captions & Transcript, Templates, AI Studio, or System Library */}
        {!isLeftCollapsed && (
          <>
            <aside className="cm-panel cm-panel--left cm-panel--kalakar">
              {rail === 'system' ? (
                <SystemWorkspace />
              ) : rail === 'templates' ? (
                <div className="cm-workspace-panel">
                  <header className="cm-workspace-panel__head cm-workspace-panel__head--modern">
                    <div className="cm-workspace-panel__title-wrap">
                      <span className="cm-workspace-panel__badge-icon">
                        <IconLayers size={18} />
                      </span>
                      <div>
                        <h2 className="cm-workspace-panel__title">Templates Gallery</h2>
                        <p className="cm-workspace-panel__subtitle">Viral creator presets & custom styles</p>
                      </div>
                    </div>
                  </header>
                  <div className="cm-workspace-panel__body">
                    <TemplatesPanel />
                  </div>
                </div>
              ) : rail === 'ai' ? (
                <div className="cm-workspace-panel">
                  <header className="cm-workspace-panel__head cm-workspace-panel__head--modern">
                    <div className="cm-workspace-panel__title-wrap">
                      <span className="cm-workspace-panel__badge-icon">
                        <IconSparkle size={18} />
                      </span>
                      <div>
                        <h2 className="cm-workspace-panel__title">AI Studio</h2>
                        <p className="cm-workspace-panel__subtitle">Smart assistant, highlights & Hinglish fixes</p>
                      </div>
                    </div>
                  </header>
                  <div className="cm-workspace-panel__body">
                    <AIPanel />
                  </div>
                </div>
              ) : (
                <TranscribeWorkspace playerRef={playerRef} />
              )}
            </aside>

            <PanelResizer
              orientation="col"
              value={leftWidth}
              min={280}
              max={640}
              defaultValue={DEFAULT_LEFT_WIDTH}
              onResize={handleResizeLeft}
              label="Left sidebar"
            />
          </>
        )}

        {/* Center Stage: Video Preview on Top + Multi-Track Timeline on Bottom */}
        <main
          className="cm-stage cm-stage--center"
          style={
            {
              '--timeline-height': `${timelineHeight}px`,
            } as React.CSSProperties
          }
        >
          <div className="cm-stage__preview-wrap">
            <Preview playerRef={playerRef} />
          </div>

          <PanelResizer
            orientation="row"
            invert
            value={timelineHeight}
            min={130}
            max={460}
            defaultValue={DEFAULT_TIMELINE_HEIGHT}
            onResize={handleResizeTimeline}
            label="Timeline panel"
          />

          <div
            className="cm-stage__timeline-wrap"
            style={{ height: `${timelineHeight}px` }}
          >
            <Timeline playerRef={playerRef} />
          </div>
        </main>

        {!isRightCollapsed && (
          <>
            <PanelResizer
              orientation="col"
              invert
              value={rightWidth}
              min={280}
              max={540}
              defaultValue={DEFAULT_RIGHT_WIDTH}
              onResize={handleResizeRight}
              label="Inspector"
            />

            {/* Right Panel: Inspector with Style/Templates/Canvas/Motion/AI tabs */}
            <Inspector
              onExport={openExport}
              playerRef={playerRef}
            />
          </>
        )}
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
};
