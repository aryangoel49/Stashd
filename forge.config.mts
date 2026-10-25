import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Stashd',
    executableName: 'stashd',
    appBundleId: 'com.aryangoel.stashd',
    appCategoryType: 'public.app-category.productivity',
    icon: 'assets/icon',
    asar: true,
    // The menu bar icon images live next to the app, outside the code bundle.
    extraResource: ['assets/tray', 'native/build/wwi-helper', 'embedder'],
    extendInfo: {
      NSAppleEventsUsageDescription: 'Stashd reads the titles and addresses of your open tabs and the names of your open documents, so it can save where you left off and reopen them later.',
      // Menu bar app: no Dock icon, no app menu on launch.
      LSUIElement: true,
    },
  },
  rebuildConfig: {},
  hooks: {
    // Packaging edits Info.plist after Electron was signed, which breaks the signature. macOS then
    // silently refuses Automation (talking to Chrome, Word…) without asking. Re-sign the whole app
    // ad hoc (no paid certificate needed) with our own identifier, then check it.
    postPackage: async (_config, result) => {
      if (result.platform !== 'darwin') return;
      for (const dir of result.outputPaths) {
        const appPath = path.join(dir, 'Stashd.app');
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', 'com.aryangoel.stashd', appPath], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
      }
    },
  },
  makers: [new MakerDMG({ name: 'Stashd', icon: 'assets/icon.icns', format: 'ULFO' }), new MakerZIP({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    // Turn off Electron features this app does not need, before packaging.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
