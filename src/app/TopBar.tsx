import React, { useEffect, useRef, useState } from 'react';
import { api, type ProjectSummary } from './api';
import { useEditor } from './store';
import { useCurrentTime } from './playbackClock';
import { projectDuration } from '../core/rendering/scene';
import { LANGUAGES } from '../core/transcription/languages';
import { Button, IconButton } from '../components/controls';
import { Badge, Banner, Modal } from '../components/feedback';
import {
  IconChevron,
  IconDownload,
  IconFolder,
  IconLayers,
  IconLogo,
  IconRedo,
  IconSettings,
  IconSliders,
  IconText,
  IconTrash,
  IconUndo,
  IconUpload,
  IconWand,
} from '../components/icons';
import { SettingsDialog } from '../features/settings/SettingsDialog';

export type StudioTab = 'captions' | 'templates' | 'style' | 'ai' | 'fonts' | 'library';

const SaveIndicator: React.FC = () => {
  const status = useEditor((s) => s.saveStatus);
  const error = useEditor((s) => s.saveError);

  if (status === 'error') {
    return (
      <span className="cm-save cm-save--error" title={error ?? undefined}>
        <span className="cm-save__dot cm-save__dot--error" />
        Not saved
      </span>
    );
  }
  if (status === 'saving') {
    return (
      <span className="cm-save cm-save--saving">
        <span className="cm-save__dot cm-save__dot--saving" />
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="cm-save cm-save--saved">
        <span className="cm-save__dot cm-save__dot--saved" />
        Saved
      </span>
    );
  }
  return null;
};

const TimecodePill: React.FC = () => {
  const current = useCurrentTime();
  // the player's own length, so this agrees with the transport readout
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  const format = (sec: number) => {
    // whole tenths first, so a frame time a hair under x.1 does not read x.0
    const tenths = Math.round(Math.max(0, sec) * 10);
    const m = Math.floor(tenths / 600);
    const second = Math.floor(tenths / 10) % 60;
    const ds = tenths % 10;
    return `${String(m).padStart(2, '0')}:${String(second).padStart(2, '0')}.${ds}`;
  };
  return (
    <div className="cm-topbar-timecode mono" title="Current Playhead / Total Duration">
      <span className="cm-timecode-now">{format(current)}</span>
      <span className="cm-timecode-sep">/</span>
      <span className="cm-timecode-total">{format(duration)}</span>
    </div>
  );
};

const ProjectMenu: React.FC = () => {
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);

  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api.listProjects().then(setProjects).catch(() => setProjects([]));

    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!project) return null;

  const rename = () => {
    const name = draft.trim();
    setRenaming(false);
    if (name && name !== project.name) useEditor.getState().update({ name });
  };

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      // Clear any delayed autosave before deleting the open project, otherwise
      // it could recreate the folder just after removal.
      if (deleteTarget.id === project.id) await useEditor.getState().save();
      await api.deleteProject(deleteTarget.id);

      const remaining = await api.listProjects();
      setProjects(remaining);
      if (deleteTarget.id === project.id) {
        const next = remaining[0]
          ? await api.loadProject(remaining[0].id)
          : await api.createProject('Untitled project');
        setProject(next);
      }

      setDeleteTarget(null);
      setOpen(false);
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="cm-project-menu" ref={ref}>
        <button
          type="button"
          className="cm-topbar__home-btn"
          title="Project menu & dashboard"
          aria-label="Project menu & dashboard"
          onClick={() => setOpen((v) => !v)}
        >
          <IconLogo size={18} />
        </button>
        <span className="cm-project-menu__sep" aria-hidden>/</span>

        {renaming ? (
          <input
            className="cm-project-menu__rename"
            value={draft}
            autoFocus
            aria-label="Project name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setRenaming(false);
                setDraft(project.name);
              }
            }}
          />
        ) : (
          <button type="button" className="cm-project-menu__trigger" onClick={() => setOpen((v) => !v)}>
            <span className="cm-project-menu__name truncate">{project.name}</span>
            <IconChevron size={12} open={open} />
          </button>
        )}

        {open ? (
          <div className="cm-menu">
            <button
              type="button"
              className="cm-menu__item"
              onClick={() => {
                setDraft(project.name);
                setRenaming(true);
                setOpen(false);
              }}
            >
              Rename project
            </button>
            <button
              type="button"
              className="cm-menu__item"
              onClick={async () => {
                const created = await api.createProject('Untitled project');
                setProject(created);
                setOpen(false);
              }}
            >
              New project
            </button>

            {projects.length > 0 ? (
              <>
                <div className="cm-menu__separator" />
                <div className="cm-menu__label">Projects</div>
                {projects.slice(0, 10).map((p) => (
                  <div className="cm-menu__project" key={p.id}>
                    <button
                      type="button"
                      className={`cm-menu__item cm-menu__item--project ${
                        p.id === project.id ? 'is-active' : ''
                      }`}
                      onClick={async () => {
                        if (p.id !== project.id) setProject(await api.loadProject(p.id));
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="cm-menu__meta mono">{p.captionCount}</span>
                    </button>
                    <IconButton
                      label={`Delete ${p.name}`}
                      className="cm-menu__delete"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(p);
                        setOpen(false);
                      }}
                    >
                      <IconTrash size={14} />
                    </IconButton>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        title="Delete project?"
        description={deleteTarget?.name}
        width={440}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        footer={
          <>
            <Button variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void deleteProject()}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="cm-delete-copy">
          This removes the project, its imported media, terminology PDF and saved captions from
          this computer. This action cannot be undone.
        </p>
        {deleteError ? <Banner tone="danger">{deleteError}</Banner> : null}
      </Modal>
    </>
  );
};

export const TopBar: React.FC<{
  onExport: () => void;
  activeTab?: StudioTab;
  onTabChange?: (tab: StudioTab) => void;
  isLeftCollapsed?: boolean;
  onToggleLeft?: () => void;
  isRightCollapsed?: boolean;
  onToggleRight?: () => void;
}> = ({
  onExport,
  activeTab = 'captions',
  onTabChange,
  isLeftCollapsed,
  onToggleLeft,
  isRightCollapsed,
  onToggleRight,
}) => {
  const project = useEditor((s) => s.project);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasGroqKey, setHasGroqKey] = useState<boolean | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setHasGroqKey(s.hasGroqKey);
      if (!s.hasGroqKey) {
        try {
          const prompted = localStorage.getItem('caption-maker:settings-prompted');
          if (!prompted) {
            setSettingsOpen(true);
            localStorage.setItem('caption-maker:settings-prompted', 'true');
          }
        } catch {}
      }
    }).catch(() => {});
  }, []);


  return (
    <header className="cm-topbar">
      {onToggleLeft ? (
        <button
          type="button"
          className={`cm-rail-toggle-btn ${isLeftCollapsed ? 'is-collapsed' : ''}`}
          onClick={onToggleLeft}
          title={isLeftCollapsed ? 'Expand Creative Drawer' : 'Collapse Creative Drawer (Cinema Mode)'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      ) : null}

      <ProjectMenu />

      {onTabChange ? (
        <nav className="cm-topbar__tabs" aria-label="Studio Mode">
          <button
            type="button"
            className={`cm-topbar__tab ${activeTab === 'captions' ? 'is-active' : ''}`}
            onClick={() => onTabChange('captions')}
            title="Captions & Transcript"
          >
            <IconText size={15} />
            <span>Captions</span>
          </button>
          <button
            type="button"
            className={`cm-topbar__tab ${activeTab === 'templates' ? 'is-active' : ''}`}
            onClick={() => onTabChange('templates')}
            title="Templates & Presets"
          >
            <IconLayers size={15} />
            <span>Templates</span>
          </button>
          <button
            type="button"
            className={`cm-topbar__tab ${activeTab === 'style' ? 'is-active' : ''}`}
            onClick={() => onTabChange('style')}
            title="Design & Style Inspector"
          >
            <IconSliders size={15} />
            <span>Design</span>
          </button>
          <button
            type="button"
            className={`cm-topbar__tab ${activeTab === 'ai' ? 'is-active' : ''}`}
            onClick={() => onTabChange('ai')}
            title="AI Magic Studio"
          >
            <IconWand size={15} />
            <span>AI Studio</span>
          </button>
          <button
            type="button"
            className={`cm-topbar__tab ${activeTab === 'fonts' ? 'is-active' : ''}`}
            onClick={() => onTabChange('fonts')}
            title="Custom Fonts"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 18L10.5 6h3L19 18M8 14h8"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Fonts</span>
          </button>
          <button
            type="button"
            className={`cm-topbar__tab ${activeTab === 'library' ? 'is-active' : ''}`}
            onClick={() => onTabChange('library')}
            title="Project Library"
          >
            <IconFolder size={15} />
            <span>Library</span>
          </button>
        </nav>
      ) : null}

      <div className="cm-topbar__spacer" />

      <div className="cm-topbar__status-center">
        <TimecodePill />

        {project ? (
          <Badge tone="accent">
            {project.language === 'auto'
              ? project.transcript?.detectedLanguage
                ? `Auto · ${LANGUAGES[project.transcript.detectedLanguage as import('../core/types/project').LanguageCode]?.label ?? project.transcript.detectedLanguage}`
                : 'Auto Detect'
              : (LANGUAGES[project.language]?.label ?? project.language)}
          </Badge>
        ) : null}

        <SaveIndicator />
      </div>

      <div className="cm-topbar__spacer" />

      <div className="cm-topbar__group">
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <IconUndo size={16} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <IconRedo size={16} />
        </IconButton>

        <button
          type="button"
          className={`cm-button cm-button--secondary cm-button--sm cm-topbar__settings-btn ${hasGroqKey === false ? 'cm-btn-pulse' : ''}`}
          onClick={() => setSettingsOpen(true)}
          title="Settings & API Keys"
        >
          <IconSettings size={14} />
          <span className="cm-hide-mobile">Settings</span>
          {hasGroqKey === false && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', marginLeft: 2 }} />
          )}
        </button>

        {onToggleRight ? (
          <button
            type="button"
            className={`cm-button cm-button--secondary cm-button--sm cm-topbar__toggle-btn ${!isRightCollapsed ? 'is-active' : ''}`}
            onClick={onToggleRight}
            title={isRightCollapsed ? 'Open Fine-Tuning Inspector' : 'Collapse Fine-Tuning Inspector'}
          >
            <IconSliders size={14} />
            <span className="cm-hide-mobile">Inspector</span>
          </button>
        ) : null}

        <Button
          variant="primary"
          size="sm"
          className="cm-topbar__export-btn"
          icon={<IconDownload size={14} />}
          onClick={onExport}
          title="Export Video (Ctrl+E)"
        >
          Export
        </Button>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          api.getSettings().then((s) => setHasGroqKey(s.hasGroqKey)).catch(() => {});
        }}
      />
    </header>
  );
};
