import { createRequire } from 'node:module';

// The optional manifest lets restricted build workers install tools in scratch space.
// A normal `npm ci && npm run build` uses this project's dependencies.
const require = createRequire(process.env.SQUEEK_DEPENDENCY_MANIFEST || import.meta.url);

export default {
  base: './',
  resolve: {
    alias: [
      { find: /^react$/, replacement: require.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
      { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
    ],
  },
  build: { target: 'es2022', sourcemap: false },
};
