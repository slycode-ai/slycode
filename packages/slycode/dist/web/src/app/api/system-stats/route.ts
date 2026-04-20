import { NextResponse } from 'next/server';
import os from 'os';
import { readFile } from 'fs/promises';

// Store previous CPU times for delta calculation
let previousCpuTimes: { idle: number; total: number } | null = null;

interface SwapInfo {
  used: number;
  total: number;
}

async function getSwapInfo(): Promise<SwapInfo> {
  try {
    // Read /proc/meminfo on Linux
    const meminfo = await readFile('/proc/meminfo', 'utf-8');
    const lines = meminfo.split('\n');

    let swapTotal = 0;
    let swapFree = 0;

    for (const line of lines) {
      if (line.startsWith('SwapTotal:')) {
        // Value is in kB, convert to bytes
        swapTotal = parseInt(line.split(/\s+/)[1], 10) * 1024;
      } else if (line.startsWith('SwapFree:')) {
        swapFree = parseInt(line.split(/\s+/)[1], 10) * 1024;
      }
    }

    return {
      used: swapTotal - swapFree,
      total: swapTotal,
    };
  } catch {
    // Not Linux or /proc not available
    return { used: 0, total: 0 };
  }
}

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  const currentTimes = { idle: totalIdle, total: totalTick };

  if (previousCpuTimes === null) {
    previousCpuTimes = currentTimes;
    // Return 0 on first call (no delta available)
    return 0;
  }

  const idleDelta = currentTimes.idle - previousCpuTimes.idle;
  const totalDelta = currentTimes.total - previousCpuTimes.total;

  previousCpuTimes = currentTimes;

  if (totalDelta === 0) {
    return 0;
  }

  // CPU usage is the percentage of time NOT idle
  const cpuUsage = 100 - (idleDelta / totalDelta) * 100;
  return Math.round(cpuUsage * 10) / 10; // Round to 1 decimal place
}

export async function GET() {
  try {
    const cpu = getCpuUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const swap = await getSwapInfo();

    return NextResponse.json({
      cpu,
      memory: {
        used: usedMemory,
        total: totalMemory,
      },
      swap,
    });
  } catch (error) {
    console.error('Error getting system stats:', error);
    return NextResponse.json(
      { error: 'Failed to get system stats' },
      { status: 500 }
    );
  }
}
