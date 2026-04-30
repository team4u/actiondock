const fs = require('fs');
const path = require('path');

const bundleDir = path.join(__dirname, 'jdeploy-bundle');
const bundleFile = path.join(bundleDir, 'jdeploy.js');
const serviceManagerSource = path.join(__dirname, 'service-manager.js');
const serviceManagerTarget = path.join(bundleDir, 'service-manager.js');
const marker = 'const { handleServiceCommand } = require(\'../service-manager\');';
const injection = [
    marker,
    '',
    'if (handleServiceCommand(process.argv.slice(2))) {',
    '    process.exit(0);',
    '}',
    ''
].join('\n');

const source = fs.readFileSync(bundleFile, 'utf8');
let patched = source;

if (!patched.includes(marker)) {
    const anchor = 'var shell = require("shelljs/global");';
    if (!patched.includes(anchor)) {
        throw new Error('Unable to patch jdeploy bundle: missing shelljs anchor');
    }
    patched = patched.replace(anchor, `${anchor}\n${injection}`);
}

if (patched !== source) {
    fs.writeFileSync(bundleFile, patched, 'utf8');
}

fs.mkdirSync(bundleDir, { recursive: true });
fs.copyFileSync(serviceManagerSource, serviceManagerTarget);
