import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { Route } from '../shared/types';
import { Main } from './Main';
import { Panel } from './Panel';
import { Save } from './Save';
import { Naming, Overlay, Toast } from './Tidy';
import './tailwind.css';
import './styles.css';

const route = (window.location.hash.replace(/^#\/?/, '') || 'panel') as Route;
// "route-" prefix: a plain "save" or "toast" class on <body> would also pick up the box's own
// styles (padding, width) and give every window double margins.
document.body.classList.add(`route-${route}`);

const views: Partial<Record<Route, ComponentType>> = {
  panel: Panel,
  save: Save,
  main: Main,
  naming: Naming,
  overlay: Overlay,
  toast: Toast,
};
const View = views[route] ?? Panel;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
