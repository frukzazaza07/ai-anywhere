import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type HostPowerAction = 'shutdown' | 'cancel';
export type HostPowerCommand = (executable: string, args: string[]) => Promise<number | null>;

// shutdown.exe exit code when /a finds no pending shutdown.
const noShutdownPending = 1116;

function runCommand(executable: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', resolve);
  });
}

/** Schedule or abort a Windows host shutdown without a shell; the delay leaves time to cancel from Discord. */
export async function hostPower(action: HostPowerAction, delayMinutes = 1,
  run: HostPowerCommand = runCommand, platform: NodeJS.Platform = process.platform): Promise<string> {
  if (platform !== 'win32') throw new Error('AI_HOST_POWER_UNSUPPORTED');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'shutdown.exe');
  if (action === 'cancel') {
    const code = await run(executable, ['/a']).catch(() => null);
    if (code === noShutdownPending) return 'No host shutdown is scheduled.';
    if (code !== 0) throw new Error('AI_HOST_POWER_FAILED');
    return 'Host shutdown cancelled.';
  }
  if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 60) throw new Error('AI_HOST_POWER_DELAY');
  const code = await run(executable, ['/s', '/t', String(delayMinutes * 60),
    '/c', 'Shutdown requested by an ai-anywhere admin from Discord.']).catch(() => null);
  if (code !== 0) throw new Error('AI_HOST_POWER_FAILED');
  return 'Host shutdown scheduled in ' + delayMinutes + ' minute' + (delayMinutes === 1 ? '' : 's')
    + '. The bot goes offline with the computer; jobs started before then are interrupted.'
    + ' Use /ai-admin shutdown-cancel to abort.';
}
