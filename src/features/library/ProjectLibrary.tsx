import React, { useCallback, useEffect, useState } from 'react';
import { api, type ProjectSummary } from '../../app/api';
import { useEditor } from '../../app/store';
import { Button, IconButton } from '../../components/controls';
import { EmptyState, ErrorState, Spinner } from '../../components/feedback';
import { IconTrash } from '../../components/icons';

const when = (iso: string): string => {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Every project on this machine, so switching between them never needs a menu. */
export const ProjectLibrary: React.FC = () => {
  const current = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(refresh, [refresh]);

  const open = useCallback(
    async (id: string) => {
      if (id === current?.id) return;
      setBusy(true);
      try {
        setProject(await api.loadProject(id));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [current?.id, setProject],
  );

  const create = useCallback(async () => {
    setBusy(true);
    try {
      setProject(await api.createProject('Untitled project'));
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [setProject, refresh]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await api.deleteProject(id);
        // opening a fresh project beats leaving the editor pointed at nothing
        if (id === current?.id) {
          const rest = (await api.listProjects()).filter((p) => p.id !== id);
          setProject(
            rest.length > 0
              ? await api.loadProject(rest[0].id)
              : await api.createProject('Untitled project'),
          );
        }
        refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setConfirming(null);
      }
    },
    [current?.id, setProject, refresh],
  );

  if (error) {
    return (
      <ErrorState
        title="Could not read your projects"
        message={error}
        onRetry={() => {
          setError(null);
          refresh();
        }}
      />
    );
  }

  if (!projects) return <Spinner size={14} label="Loading projects" />;

  return (
    <div className="cm-library">
      <Button block variant="secondary" size="sm" loading={busy} onClick={() => void create()}>
        New project
      </Button>

      {projects.length === 0 ? (
        <EmptyState compact title="No projects yet" description="Add media to start one." />
      ) : (
        <div className="cm-library__list">
          {projects.map((project) => (
            <div
              key={project.id}
              className={`cm-library__item ${project.id === current?.id ? 'is-current' : ''}`}
            >
              <button
                type="button"
                className="cm-library__open"
                onClick={() => void open(project.id)}
              >
                <span className="cm-library__name truncate">{project.name}</span>
                <span className="cm-library__meta">
                  {project.captionCount} captions · {when(project.updatedAt)}
                </span>
                {project.mediaFileName ? (
                  <span className="cm-library__media truncate">{project.mediaFileName}</span>
                ) : (
                  <span className="cm-library__media">No media yet</span>
                )}
              </button>

              {confirming === project.id ? (
                <div className="cm-library__confirm">
                  <Button size="sm" variant="danger" onClick={() => void remove(project.id)}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <IconButton
                  label={`Delete ${project.name}`}
                  onClick={() => setConfirming(project.id)}
                >
                  <IconTrash size={14} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
