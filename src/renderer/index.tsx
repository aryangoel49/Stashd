import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { Route } from '../shared/types';
import { MainWindow } from './MainWindow';
import { QuickSave } from './QuickSave';
import { SettingsWindow } from './SettingsWindow';
import './styles.css';

const route = (window.location.hash.replace(/^#\/?/, '') || 'main') as Route;

const views: Record<Route, ComponentType> = {
  main: MainWindow,
  quicksave: QuickSave,
  settings: SettingsWindow,
};
const View = views[route] ?? MainWindow;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
