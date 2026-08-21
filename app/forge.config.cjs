const fs = require('node:fs');
const path = require('node:path');

const parserRuntimePackages = [
  'madden-franchise',
  'bit-buffer',
  'fast-xml-parser',
  'node-xml-stream-parser',
  'strnum'
];

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'CoachingCarouselRebuilt',
    executableName: 'Coaching Carousel Rebuilt',
    extraResource: [path.resolve(__dirname, '../assets/experiments/capacity-policy/CFB27_833_0.gz')]
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      for (const packageName of parserRuntimePackages) {
        fs.cpSync(
          path.resolve(__dirname, 'node_modules', packageName),
          path.join(buildPath, 'node_modules', packageName),
          { recursive: true }
        );
      }
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32']
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'src/main.ts', config: 'vite.main.config.mjs' },
          { entry: 'src/preload.ts', config: 'vite.preload.config.mjs' }
        ],
        renderer: [
          { name: 'main_window', config: 'vite.renderer.config.mjs' }
        ]
      }
    }
  ]
};
