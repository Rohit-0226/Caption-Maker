import React, { useCallback, useEffect, useState } from 'react';
import './theme';
import './shell.css';
import { api, ApiError } from '../api';
import { useEditor } from '../store';
import { SettingsDialog } from '../../features/settings/SettingsDialog';
const ProjectsPage: React.FC = () => <div className="sh-center">Projects</div>;
const VocabularyPage: React.FC = () => <div className="sh-center">Vocabulary</div>;
const EditorPage: React.FC<{ projectId: string }> = () => <div className="sh-center">Editor</div>;
import { IconLogo } from '../../components/icons';
import { Spinner } from '../../components/feedback';
import { Header } from './Header';
import { useRoute } from './router';
import { Toaster } from './toast';
import { readString, writeString } from './prefs';

const SETTINGS_PROMPTED_KEY = 'caption-maker:settings-prompted';

type Boot = { state: 'checking' } | { state: 'ready' } | { state: 'down'; message: string };

/**
 * The app frame: one header, then whichever page the URL names.
 *
 * Everything that used to sit permanently on screen (the rail, the second
 * toolbar, the inspector tabs) now lives on the page that needs it, so the
 * chrome above any workspace is at most two rows: this header and, in the
 * editor, its toolbar.
 */
export const Shell: React.FC = () => {
  const route = useRoute();
  const [boot, setBoot] = useState<Boot>({ state: 'checking' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);

  const checkServer = useCallback(async () => {
    setBoot({ state: 'checking' });
    try {
      await api.health();
      setBoot({ state: 'ready' });
    } catch (error) {
      setBoot({
        state: 'down',
        message:
          error instanceof ApiError && error.status === 0
            ? 'The Caption Maker server is not responding. Start it on the main PC (Start-Caption-Maker, or "npm run dev"), then try again.'
            : (error as Error).message,
      });
    }
  }, []);

  useEffect(() => {
    void checkServer();
  }, [checkServer]);

  const refreshKeyState = useCallback(() => {
    api
      .getSettings()
      .then((settings) => {
        setNeedsKey(!settings.hasGroqKey);
        // the very first visit without a key opens Settings once, as before
        if (!settings.hasGroqKey && !readString(SETTINGS_PROMPTED_KEY)) {
          writeString(SETTINGS_PROMPTED_KEY, 'true');
          setSettingsOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (boot.state === 'ready') refreshKeyState();
  }, [boot.state, refreshKeyState]);

  // any page can ask for Settings (e.g. "Open Settings" next to a missing key)
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener('cm:open-settings', open);
    return () => window.removeEventListener('cm:open-settings', open);
  }, []);

  // a last-chance save if the window closes mid-edit
  useEffect(() => {
    const onBeforeUnload = () => {
      const state = useEditor.getState();
      if (state.project && state.saveStatus === 'saving') void state.save();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // handy when debugging from the console, as the old shell allowed
  useEffect(() => {
    (window as unknown as { __STORE__?: unknown }).__STORE__ = useEditor;
  }, []);

  let page: React.ReactNode;
  if (boot.state === 'checking') {
    page = (
      <div className="sh-center">
        <Spinner size={18} label="Connecting to Caption Maker" />
      </div>
    );
  } else if (boot.state === 'down') {
    page = (
      <div className="sh-center">
        <div className="sh-down">
          <IconLogo size={32} />
          <h1>Can't reach Caption Maker</h1>
          <p>{boot.message}</p>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => void checkServer()}>
            Try again
          </button>
        </div>
      </div>
    );
  } else if (route.page === 'vocabulary') {
    page = <VocabularyPage />;
  } else if (route.page === 'editor') {
    page = <EditorPage key="editor" projectId={route.projectId} />;
  } else {
    page = <ProjectsPage />;
  }

  return (
    <div className="sh-app">
      <Header
        route={route}
        settingsNeedAttention={needsKey}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="sh-main">{page}</main>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={refreshKeyState}
      />
      <Toaster />
    </div>
  );
};
