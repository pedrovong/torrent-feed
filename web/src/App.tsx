import { useEffect } from 'react';
import { Detail } from './screens/Detail';
import { Feed } from './screens/Feed';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Sources } from './screens/Sources';
import { useRoute } from './nav';

export function App() {
  const { screen, itemId } = useRoute();

  // Lift toasts above the detail screen's pinned action bar.
  useEffect(() => {
    document.documentElement.style.setProperty('--toast-lift', itemId ? '84px' : '0px');
  }, [itemId]);

  return (
    <>
      {screen === 'feed' && <Feed />}
      {screen === 'search' && <Search />}
      {screen === 'sources' && <Sources />}
      {screen === 'settings' && <Settings />}
      {itemId !== null && <Detail key={itemId} id={itemId} screen={screen} />}
    </>
  );
}
