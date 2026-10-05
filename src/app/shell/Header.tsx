import React, { useEffect, useState } from 'react';
import { useEditor } from '../store';
import { IconLogo, IconSettings } from '../../components/icons';
import { formatRoute, type Route } from './router';
import { toggleTheme, useTheme } from './theme';
import { IconMoon, IconSun } from './icons';
import { Popover } from './Popover';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/**
 * Who is editing on this computer. Each LAN user picks a name once; it stays in
 * their browser and is attached to the corrections they make.
 */
const EditorBadge: React.FC = () => {
  const name = useEditor((s) => s.editorName);
  const setName = useEditor((s) => s.setEditorName);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    if (open) setDraft(name);
  }, [open, name]);

  const save = () => {
    setName(draft);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      width={280}
      label="Your name"
      trigger={
        <button
          type="button"
          className={`sh-avatar ${name ? '' : 'is-empty'}`}
          title={name ? `Editing as ${name}. Click to change your name.` : 'Set your name so your corrections are credited to you'}
          aria-label={name ? `Editing as ${name}` : 'Set your name'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {name ? initialsOf(name) : '?'}
        </button>
      }
    >
      <form
        className="sh-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="ui-label" htmlFor="sh-editor-name">
          Your name
        </label>
        <input
          id="sh-editor-name"
          className="ui-input"
          value={draft}
          maxLength={40}
          autoFocus
          spellCheck={false}
          placeholder="e.g. Aman"
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="ui-hint">
          Kept in this browser only. Your vocabulary corrections are tagged with it, so the team
          can see who taught the app a spelling.
        </p>
        <div className="sh-name-form__actions">
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="ui-btn ui-btn--primary">
            Save
          </button>
        </div>
      </form>
    </Popover>
  );
};

export const Header: React.FC<{
  route: Route;
  settingsNeedAttention: boolean;
  onOpenSettings: () => void;
}> = ({ route, settingsNeedAttention, onOpenSettings }) => {
  const theme = useTheme();
  const onVocabulary = route.page === 'vocabulary';

  return (
    <header className="sh-header">
      <a className="sh-brand" href={formatRoute({ page: 'projects' })} title="Go to your projects">
        <IconLogo size={22} />
        <span className="sh-brand__name">Caption Maker</span>
      </a>

      <nav className="sh-nav" aria-label="Main">
        <a
          className={`sh-nav__item ${!onVocabulary ? 'is-active' : ''}`}
          href={formatRoute({ page: 'projects' })}
          aria-current={!onVocabulary ? 'page' : undefined}
        >
          Projects
        </a>
        <a
          className={`sh-nav__item ${onVocabulary ? 'is-active' : ''}`}
          href={formatRoute({ page: 'vocabulary' })}
          aria-current={onVocabulary ? 'page' : undefined}
        >
          Vocabulary
        </a>
      </nav>

      <div className="sh-header__right">
        <button
          type="button"
          className="ui-icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
        <button
          type="button"
          className="ui-icon-btn sh-settings-btn"
          onClick={onOpenSettings}
          title={
            settingsNeedAttention
              ? 'Settings: no Groq API key yet. Add one to transcribe with Groq.'
              : 'Settings and API keys'
          }
          aria-label="Settings and API keys"
        >
          <IconSettings size={17} />
          {settingsNeedAttention ? <span className="sh-settings-btn__dot" aria-hidden /> : null}
        </button>
        <EditorBadge />
      </div>
    </header>
  );
};
