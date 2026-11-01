const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const builder = createRequire(require.resolve('electron-builder/package.json'));
const builderLib = createRequire(builder.resolve('app-builder-lib/package.json'));
const asar = builderLib('@electron/asar');
const archive = path.join(root, 'release/build/win-unpacked/resources/app.asar');
const packedFile = file => asar.extractFile(archive, path.normalize(file));
const output = path.join(root, 'release', `v${manifest.version}`);
const sha256 = async file => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
(async () => {
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/'));
  assert.ok(entries.length > 20);
  for (const entry of entries) {
    assert.match(entry, /^\/(?:(?:main|dist|assets)(?:\/|$)|package\.json$)/);
    assert.ok(!/(?:^|\/)(?:\.env(?:\.[^/]*)?|node_modules|session\.json|smoke\.cjs|test|prisma)(?:\/|$)/i.test(entry), `Unexpected packaged file: ${entry}`);
  }
  const packaged = JSON.parse(packedFile('package.json').toString());
  assert.equal(packaged.version, manifest.version);
  assert.equal(packaged.apiServer, manifest.apiServer);
  assert.equal(packaged.apiServer, require('../main/security.cjs').DESKTOP_API_SERVER);
  const staged = JSON.parse(fs.readFileSync(path.join(root, 'build-app/package.json'), 'utf8'));
  assert.equal(packaged.apiServer, staged.apiServer);
  for (const file of ['main/index.cjs', 'main/security.cjs', 'main/preload.cjs', 'main/session.cjs', 'main/http.cjs', 'main/generation.cjs', 'dist/styles.css', 'dist/app.css', 'dist/index.html']) {
    assert.equal(createHash('sha256').update(packedFile(file)).digest('hex'),
      await sha256(path.join(root, 'build-app', file)), `Stale packaged file: ${file}`);
  }
  const security = packedFile('main/security.cjs').toString();
  assert.ok(security.includes(manifest.apiServer));
  assert.ok(security.includes('draft-preview|edits') && security.includes('document-display'));
  const renderer = entries.filter(entry => entry.startsWith('/dist/') && entry.endsWith('.js'))
    .map(entry => packedFile(entry.slice(1)).toString()).join('\n');
  for (const feature of ['Preview and edit documents', 'Save and rebuild', 'This application will be saved without a job link.', 'Remote Software Jobs', 'Filter by country', 'United Kingdom', 'Ireland', 'total source target', 'country source target', 'sources with eligible jobs', 'Filter by site', 'Filter by source posting time', 'Job company:', 'Checking job description', 'Close application form', 'New = latest import additions', 'Job status colors', 'Status colors appear on badges only.', 'Applied with profile', 'Display time zone', 'Application creation date range', 'Exclude companies applied with profiles', 'Cancel generation']) {
    assert.ok(renderer.includes(feature), `Current web workflow missing from package: ${feature}`);
  }
  const portable = JSON.parse(fs.readFileSync(path.join(root, 'release/build/portable-build.json'), 'utf8'));
  assert.equal(portable.Version, manifest.version);
  assert.equal(portable.AppHash, await sha256(archive));
  assert.equal(portable.ExecutableHash, await sha256(path.join(root, 'release/build/win-unpacked/AnchorProposal.exe')));
  assert.equal(portable.BuildHash, await sha256(path.join(root, 'release/build/portable-payload.zip')));
  const artifacts = [];
  for (const name of ['AnchorProposal-Setup.exe', 'AnchorProposal.exe']) {
    const file = path.join(output, name);
    const header = Buffer.alloc(2), fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, header, 0, 2, 0); } finally { fs.closeSync(fd); }
    assert.equal(header.toString(), 'MZ');
    artifacts.push({ file, bytes: fs.statSync(file).size, sha256: await sha256(file) });
  }
  let native;
  if (process.argv[2]) {
    native = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
    assert.ok(native.passed > 0);
    assert.equal(native.providerCalls, 0);
  }
  const report = { version: manifest.version, apiServer: manifest.apiServer, packagedEntries: entries.length,
    verified: true, ...(native ? { nativeChecks: native.passed, providerCalls: native.providerCalls } : {}), artifacts };
  if (process.argv[3]) {
    const startup = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
    assert.ok(typeof startup.mainToPaintMs === 'number' && startup.mainToPaintMs > 0);
    report.portableStartupVerified = true;
    report.portableStartup = startup;
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'release/verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
