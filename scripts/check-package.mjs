import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const compatibility = JSON.parse(read('compatibility.json'));
assert.equal(manifest.version, pkg.version, 'manifest/package version mismatch');
assert.equal(manifest.version, compatibility.integrationVersion, 'compatibility version mismatch');
for (const key of ['display_name', 'author', 'js', 'css']) assert.ok(manifest[key], `Missing ${key}`);
assert.deepEqual(manifest.dependencies, ['third-party/shujuku']);
const files = [manifest.js, manifest.css, 'core.js', 'host.js', 'actions.js', 'dock.js', 'dock.css',
    'portraits.js', 'portrait-store.js', 'portrait-panel.js', 'portrait-panel.css', 'initialization.js',
    'README.md', 'RELEASING.md', 'INSTALL-VERIFICATION.md', 'CHANGELOG.md', 'PLOTTI-RESEARCH.md'];
for (const name of ['journey', 'academy', 'starship']) {
    for (const suffix of ['.json', '.tables.json']) {
        const file = `examples/${name}${suffix}`;
        JSON.parse(read(file)); files.push(file);
    }
}
for (const name of files) assert.ok(fs.statSync(path.join(root, name)).isFile(), `Missing ${name}`);
// Check local module imports and stylesheet imports without executing browser code.
for (const name of fs.readdirSync(root).filter(name => /\.(js|css)$/.test(name))) {
    const source = read(name);
    for (const match of source.matchAll(/(?:from\s*|@import\s*)['"](\.\/[^'"]+)['"]/g)) {
        assert.ok(fs.existsSync(path.resolve(root, match[1])), `Missing import ${match[1]}`);
    }
}
for (const file of ['README.md', 'RELEASING.md', 'INSTALL-VERIFICATION.md', 'CHANGELOG.md', 'PLOTTI-RESEARCH.md']) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(https?:|#)/.test(target)) continue;
        assert.ok(fs.existsSync(path.resolve(root, target.split('#')[0])), `Broken link ${target}`);
    }
}
console.log(`Package ${manifest.version}: root manifest, assets, versions, examples and document links OK.`);
