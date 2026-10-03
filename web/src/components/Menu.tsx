import { isDark, updateConfig, useConfig } from '../store';
import { navigate, type Screen } from '../nav';

const ITEMS: Array<{ screen: Screen; label: string }> = [
  { screen: 'feed', label: 'Feed' },
  { screen: 'search', label: 'Search' },
  { screen: 'sources', label: 'Sources' },
  { screen: 'settings', label: 'Settings' },
];

export function Menu({ open, current, onClose }: { open: boolean; current: Screen; onClose: () => void }) {
  const { theme } = useConfig();
  const dark = isDark(theme);

  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <div className={`menu${open ? ' open' : ''}`} role="menu" aria-hidden={!open}>
        {ITEMS.map((m) => (
          <button
            key={m.screen}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            className={`menu-item${m.screen === current ? ' cur' : ''}`}
            onClick={() => {
              onClose();
              if (m.screen !== current) navigate(m.screen);
            }}
          >
            <span className="dot" />
            {m.label}
          </button>
        ))}
        <hr />
        <button
          role="menuitem"
          tabIndex={open ? 0 : -1}
          className="menu-item"
          onClick={() => {
            updateConfig({ theme: dark ? 'light' : 'dark' });
            onClose();
          }}
        >
          <span className="dot" />
          {dark ? 'Switch to light' : 'Switch to dark'}
        </button>
      </div>
    </>
  );
}

export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="circle-btn" onClick={onClick} aria-label="Menu" aria-haspopup="menu">
      ⋯
    </button>
  );
}
