import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import type { SlyCodeConfig } from '../cli/workspace';

const SERVICES = ['web', 'bridge', 'messaging'] as const;

function taskName(service: string): string {
  return `SlyCode-${service}`;
}

function resolveEntryPoint(service: string, workspace: string): string {
  const distPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', service, 'index.js');
  if (fs.existsSync(distPath)) return distPath;
  return path.join(workspace, service, 'dist', 'index.js');
}

function generateTaskXml(
  service: string,
  workspace: string,
  config: SlyCodeConfig
): string {
  const nodePath = process.execPath;
  const entryPoint = resolveEntryPoint(service, workspace);
  const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;

  let envArgs: string;
  switch (service) {
    case 'web':
      envArgs = `PORT=${config.ports.web} BRIDGE_URL=${bridgeUrl}`;
      break;
    case 'bridge':
      envArgs = `BRIDGE_PORT=${config.ports.bridge}`;
      break;
    case 'messaging':
      envArgs = `MESSAGING_SERVICE_PORT=${config.ports.messaging} BRIDGE_URL=${bridgeUrl}`;
      break;
    default:
      envArgs = '';
  }

  // Windows Task Scheduler XML
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>SlyCode ${service} service</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions>
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c set "${envArgs}" &amp;&amp; set "NODE_ENV=production" &amp;&amp; set "SLYCODE_HOME=${workspace}" &amp;&amp; "${nodePath}" "${entryPoint}"</Arguments>
      <WorkingDirectory>${workspace}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

async function install(workspace: string, config: SlyCodeConfig): Promise<void> {
  console.log('Installing Windows Task Scheduler tasks...');

  const tempDir = os.tmpdir();

  for (const svc of SERVICES) {
    const xml = generateTaskXml(svc, workspace, config);
    const xmlPath = path.join(tempDir, `slycode-${svc}.xml`);
    fs.writeFileSync(xmlPath, xml, { encoding: 'utf16le' });

    try {
      execSync(`schtasks /Create /TN "${taskName(svc)}" /XML "${xmlPath}" /F`, {
        stdio: 'pipe',
      });
      console.log(`  \u2713 ${taskName(svc)} installed`);
    } catch (err) {
      console.error(`  \u2717 Failed to install ${taskName(svc)}: ${err}`);
    }

    // Clean up temp XML
    fs.unlinkSync(xmlPath);
  }

  // Start tasks
  for (const svc of SERVICES) {
    try {
      execSync(`schtasks /Run /TN "${taskName(svc)}"`, { stdio: 'pipe' });
      console.log(`  \u2713 ${taskName(svc)} started`);
    } catch {
      console.warn(`  ! ${taskName(svc)} could not be started`);
    }
  }

  console.log('');
  console.log('Windows tasks installed.');
}

async function remove(): Promise<void> {
  console.log('Removing Windows Task Scheduler tasks...');

  for (const svc of SERVICES) {
    try {
      execSync(`schtasks /Delete /TN "${taskName(svc)}" /F`, { stdio: 'pipe' });
      console.log(`  \u2713 ${taskName(svc)} removed`);
    } catch {
      console.log(`  ${taskName(svc)} was not installed`);
    }
  }
}

async function status(): Promise<void> {
  for (const svc of SERVICES) {
    try {
      const output = execSync(`schtasks /Query /TN "${taskName(svc)}" /FO CSV /NH`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const fields = output.trim().split(',').map(f => f.replace(/"/g, ''));
      const state = fields[2] || 'Unknown';
      console.log(`  ${taskName(svc)}: ${state}`);
    } catch {
      console.log(`  ${taskName(svc)}: not installed`);
    }
  }
}

export async function serviceWindows(
  action: 'install' | 'remove' | 'status',
  workspace: string,
  config: SlyCodeConfig
): Promise<void> {
  switch (action) {
    case 'install': return install(workspace, config);
    case 'remove': return remove();
    case 'status': return status();
  }
}
