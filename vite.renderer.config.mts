import { defineConfig, type Plugin } from 'vite';

// The page's Content-Security-Policy allows no network at all in the built app.
// During `npm start` it also allows the local Vite dev server (for live reload).
function csp(dev: boolean): Plugin {
  return {
    name: 'stashd-csp',
    transformIndexHtml: (html) => html.replace('__CSP_CONNECT__', dev ? "'self' ws://localhost:* http://localhost:*" : "'none'"),
  };
}

// https://vitejs.dev/config
export default defineConfig(({ command }) => ({
  plugins: [csp(command === 'serve')],
  // React's JSX without the React plugin (which needs inline scripts our CSP blocks).
  oxc: { jsx: { runtime: 'automatic' } },
}));
