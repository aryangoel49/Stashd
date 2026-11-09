/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare module '*.wav' {
  const url: string;
  export default url;
}
