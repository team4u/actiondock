const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVICE_NAME = 'actiondock-server';
const SERVICE_LABEL = 'com.actiondock.server';
const SERVICE_DISPLAY_NAME = 'ActionDock Server';
const SERVICE_DESCRIPTION = 'ActionDock background service';
const SERVICE_SCRIPT = path.resolve(__dirname, 'jdeploy-bundle', 'jdeploy.js');
const SERVICE_NODE = process.execPath;
const SERVICE_WORKDIR = path.dirname(SERVICE_SCRIPT);

function handleServiceCommand(argv) {
    if (!argv.length || argv[0] !== 'service') {
        return false;
    }

    const action = argv[1];
    if (!action || action === '--help' || action === '-h') {
        printUsage();
        process.exit(action ? 0 : 1);
    }

    try {
        switch (action) {
            case 'install':
                installService();
                break;
            case 'start':
                startService();
                break;
            case 'stop':
                stopService();
                break;
            case 'status':
                printStatus();
                break;
            case 'uninstall':
                uninstallService();
                break;
            default:
                printUsage();
                process.exit(1);
        }
        return true;
    } catch (err) {
        console.error(err.message || String(err));
        process.exit(1);
    }
}

function installService() {
    switch (process.platform) {
        case 'darwin':
            installLaunchAgent();
            break;
        case 'win32':
            installWindowsService();
            break;
        default:
            installSystemdUserService();
            break;
    }
    console.log(`${SERVICE_NAME} service installed`);
}

function startService() {
    switch (process.platform) {
        case 'darwin':
            launchctl(['kickstart', '-k', `${launchdTarget()}/${SERVICE_LABEL}`]);
            break;
        case 'win32':
            sc(['start', SERVICE_NAME]);
            break;
        default:
            systemctl(['--user', 'start', `${SERVICE_NAME}.service`]);
            break;
    }
    console.log(`${SERVICE_NAME} service started`);
}

function stopService() {
    switch (process.platform) {
        case 'darwin':
            safeLaunchctl(['bootout', launchdTarget(), plistPath()]);
            break;
        case 'win32':
            safeSc(['stop', SERVICE_NAME]);
            break;
        default:
            safeSystemctl(['--user', 'stop', `${SERVICE_NAME}.service`]);
            break;
    }
    console.log(`${SERVICE_NAME} service stopped`);
}

function printStatus() {
    switch (process.platform) {
        case 'darwin':
            printLaunchdStatus();
            break;
        case 'win32':
            printWindowsStatus();
            break;
        default:
            printSystemdStatus();
            break;
    }
}

function uninstallService() {
    switch (process.platform) {
        case 'darwin':
            safeLaunchctl(['bootout', launchdTarget(), plistPath()]);
            removeFile(plistPath());
            break;
        case 'win32':
            safeSc(['stop', SERVICE_NAME]);
            safeSc(['delete', SERVICE_NAME]);
            break;
        default:
            safeSystemctl(['--user', 'disable', '--now', `${SERVICE_NAME}.service`]);
            removeFile(systemdUnitPath());
            runCommand('systemctl', ['--user', 'daemon-reload']);
            break;
    }
    console.log(`${SERVICE_NAME} service uninstalled`);
}

function installSystemdUserService() {
    const unitFile = systemdUnitPath();
    ensureDir(path.dirname(unitFile));
    fs.writeFileSync(unitFile, systemdUnitContents(), 'utf8');
    runCommand('systemctl', ['--user', 'daemon-reload']);
    runCommand('systemctl', ['--user', 'enable', '--now', `${SERVICE_NAME}.service`]);
}

function installLaunchAgent() {
    const file = plistPath();
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, launchdPlistContents(), 'utf8');
    safeLaunchctl(['bootout', launchdTarget(), file]);
    runCommand('launchctl', ['bootstrap', launchdTarget(), file]);
    runCommand('launchctl', ['enable', `${launchdTarget()}/${SERVICE_LABEL}`]);
    runCommand('launchctl', ['kickstart', '-k', `${launchdTarget()}/${SERVICE_LABEL}`]);
}

function installWindowsService() {
    const existing = runCommand('sc.exe', ['query', SERVICE_NAME], { allowFailure: true });
    if (existing.status === 0) {
        runCommand('sc.exe', [
            'config',
            SERVICE_NAME,
            'binPath=',
            windowsCommandLine([SERVICE_NODE, SERVICE_SCRIPT]),
            'start=',
            'auto'
        ]);
    } else {
        runCommand('sc.exe', [
            'create',
            SERVICE_NAME,
            'binPath=',
            windowsCommandLine([SERVICE_NODE, SERVICE_SCRIPT]),
            'DisplayName=',
            SERVICE_DISPLAY_NAME,
            'start=',
            'auto'
        ]);
    }
    runCommand('sc.exe', ['description', SERVICE_NAME, SERVICE_DESCRIPTION]);
    runCommand('sc.exe', ['start', SERVICE_NAME]);
}

function printSystemdStatus() {
    const result = runCommand('systemctl', ['--user', 'is-active', `${SERVICE_NAME}.service`], { allowFailure: true });
    if (result.status === 0) {
        console.log(`${SERVICE_NAME} service running`);
        return;
    }
    console.log(`${SERVICE_NAME} service inactive`);
}

function printLaunchdStatus() {
    const result = runCommand('launchctl', ['print', `${launchdTarget()}/${SERVICE_LABEL}`], { allowFailure: true });
    if (result.status === 0) {
        console.log(`${SERVICE_NAME} service running`);
        return;
    }
    console.log(`${SERVICE_NAME} service inactive`);
}

function printWindowsStatus() {
    const result = runCommand('sc.exe', ['query', SERVICE_NAME], { allowFailure: true });
    if (result.status !== 0) {
        console.log(`${SERVICE_NAME} service not installed`);
        return;
    }
    if (/STATE\s*:\s*\d+\s+RUNNING/i.test(result.stdout)) {
        console.log(`${SERVICE_NAME} service running`);
        return;
    }
    console.log(`${SERVICE_NAME} service stopped`);
}

function systemdUnitPath() {
    return path.join(os.homedir(), '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
}

function systemdUnitContents() {
    return [
        '[Unit]',
        `Description=${SERVICE_DESCRIPTION}`,
        'After=network.target',
        '',
        '[Service]',
        'Type=simple',
        `WorkingDirectory=${escapeSystemdValue(SERVICE_WORKDIR)}`,
        `ExecStart=${escapeSystemdValue(SERVICE_NODE)} ${escapeSystemdValue(SERVICE_SCRIPT)}`,
        'Restart=on-failure',
        'RestartSec=5',
        'Environment=ACTIONDOCK_NO_UPDATE_NOTIFIER=1',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
    ].join('\n');
}

function plistPath() {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function launchdTarget() {
    return `gui/${os.userInfo().uid}`;
}

function launchdPlistContents() {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        `  <key>Label</key><string>${xmlEscape(SERVICE_LABEL)}</string>`,
        '  <key>ProgramArguments</key>',
        '  <array>',
        `    <string>${xmlEscape(SERVICE_NODE)}</string>`,
        `    <string>${xmlEscape(SERVICE_SCRIPT)}</string>`,
        '  </array>',
        '  <key>WorkingDirectory</key><string>' + xmlEscape(SERVICE_WORKDIR) + '</string>',
        '  <key>RunAtLoad</key><true/>',
        '  <key>KeepAlive</key><true/>',
        '  <key>EnvironmentVariables</key>',
        '  <dict>',
        '    <key>ACTIONDOCK_NO_UPDATE_NOTIFIER</key><string>1</string>',
        '  </dict>',
        '</dict>',
        '</plist>',
        ''
    ].join('\n');
}

function windowsCommandLine(parts) {
    return parts.map(value => `"${String(value).replace(/"/g, '\\"')}"`).join(' ');
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function removeFile(file) {
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }
}

function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true
    });

    if (result.error) {
        throw result.error;
    }
    if (options.allowFailure) {
        return result;
    }
    if (result.status !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(output || `${command} ${args.join(' ')} failed`);
    }

    return result;
}

function safeSystemctl(args) {
    runCommand('systemctl', args, { allowFailure: true });
}

function safeLaunchctl(args) {
    runCommand('launchctl', args, { allowFailure: true });
}

function safeSc(args) {
    runCommand('sc.exe', args, { allowFailure: true });
}

function systemctl(args) {
    runCommand('systemctl', args);
}

function launchctl(args) {
    runCommand('launchctl', args);
}

function sc(args) {
    runCommand('sc.exe', args);
}

function escapeSystemdValue(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function printUsage() {
    console.log([
        'Usage:',
        '  actiondock-server service install',
        '  actiondock-server service start',
        '  actiondock-server service stop',
        '  actiondock-server service status',
        '  actiondock-server service uninstall'
    ].join('\n'));
}

module.exports = {
    handleServiceCommand
};
