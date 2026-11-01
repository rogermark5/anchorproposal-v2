const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const { createRequire } = require('node:module');
const { createIcons } = require('./icons.cjs');
const { DESKTOP_API_SERVER } = require('../main/security.cjs');
async function build() {
  const root = path.resolve(__dirname, '..');
  const web = path.resolve(root, '../web');
  const webRequire = createRequire(path.join(web, 'package.json'));
  const manifest = require('../package.json');
  const apiServer = DESKTOP_API_SERVER;
  if (manifest.apiServer !== apiServer) throw new Error('Desktop package metadata must match the fixed AnchorProposal API server.');
  for (const generated of [path.join(root, 'dist'), path.join(root, 'build-app/dist')]) {
    if (!generated.startsWith(root + path.sep) || path.basename(generated) !== 'dist') throw new Error('Unsafe generated output path.');
    await fs.rm(generated, { recursive: true, force: true });
  }
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.copyFile(path.join(root, 'src/index.html'), path.join(root, 'dist/index.html'));
  const output = await esbuild.build({ entryPoints: [path.join(root, 'src/app.tsx')], bundle: true, splitting: true, format: 'esm', jsx: 'automatic', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, target: 'chrome140', outdir: path.join(root, 'dist'), chunkNames: 'chunks/[name]-[hash]', metafile: true,
    alias: { '@/lib/auth-context': path.join(root, 'src/auth-context.tsx'), '@': path.join(web, 'src'), 'next/link': path.join(root, 'src/navigation.tsx'), 'next/navigation': path.join(root, 'src/navigation.tsx'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(web, 'node_modules'), path.join(root, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/backend"' }, legalComments: 'none', logLevel: 'info' });
  const sourceCss = (await fs.readFile(path.join(web, 'src/app/globals.css'), 'utf8')).replace(/@import "tailwindcss\/(base|components|utilities)";/g, '@tailwind $1;');
  const tailwindConfig = { ...webRequire('./tailwind.config.js'), content: [path.join(web, 'src/**/*.{ts,tsx}').replace(/\\/g, '/'), path.join(root, 'src/**/*.{ts,tsx}').replace(/\\/g, '/')] };
  tailwindConfig.theme = { ...tailwindConfig.theme, extend: { ...tailwindConfig.theme.extend, colors: { ...tailwindConfig.theme.extend.colors, slate: { 50: '#162231', 100: '#1c2b3d', 200: '#304159', 300: '#526980', 400: '#8b9eb6', 500: '#99aec5', 600: '#adbed2', 700: '#c5d3e4', 800: '#e0eaf7', 900: '#edf5ff', 950: '#f7faff' } } } };
  const baseCss = await webRequire('postcss')([webRequire('tailwindcss')(tailwindConfig), webRequire('autoprefixer')]).process(sourceCss, { from: path.join(web, 'src/app/globals.css') });
  const cssFiles = Object.keys(output.metafile.outputs).filter(file => file.endsWith('.css') && !file.endsWith('app.css'));
  const styles = [baseCss.css, ...await Promise.all(cssFiles.map(file => fs.readFile(path.resolve(file), 'utf8'))), await fs.readFile(path.join(root, 'dist/app.css'), 'utf8')];
  await fs.writeFile(path.join(root, 'dist/styles.css'), styles.join('\n'));
  await createIcons(path.join(root, 'assets'));
  const notices = [];
  for (const name of ['react', 'react-dom', 'scheduler', 'lucide-react', 'sonner', 'recharts', 'clsx', 'tailwind-merge']) {
    let manifestPath;
    try { manifestPath = require.resolve(`${name}/package.json`, { paths: [root, web, path.dirname(require.resolve('react-dom/package.json'))] }); }
    catch { manifestPath = path.join(web, 'node_modules', name, 'package.json'); }
    const metadata = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const license = await fs.readFile(path.join(path.dirname(manifestPath), 'LICENSE'), 'utf8').catch(() => fs.readFile(path.join(path.dirname(manifestPath), 'LICENSE.md'), 'utf8'));
    notices.push(`${name} ${metadata.version}\n${'='.repeat(60)}\n${license}`);
  }
  await fs.writeFile(path.join(root, 'assets/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
  // Stage only the self-contained app: no monorepo dependencies, server code, env files, or QA helpers.
  const stage = path.join(root, 'build-app');
  await fs.mkdir(path.join(stage, 'main'), { recursive: true });
  await esbuild.build({ entryPoints: [path.resolve(root, '../../packages/shared/src/http.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(stage, 'main/http.cjs') });
  for (const name of ['index.cjs', 'preload.cjs', 'security.cjs', 'session.cjs', 'generation.cjs']) await fs.copyFile(path.join(root, 'main', name), path.join(stage, 'main', name));
  await fs.cp(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
  await fs.cp(path.join(root, 'assets'), path.join(stage, 'assets'), { recursive: true });
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author, main: manifest.main, license: 'UNLICENSED', apiServer }, null, 2));
}
build().catch(error => { console.error(error); process.exitCode = 1; });
