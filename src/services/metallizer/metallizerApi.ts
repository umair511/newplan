import { VA05Order, SlitterPlan } from '../../types';
import { 
  JumboRequirement, 
  MetallizerMachineSettings, 
  JumboRoll, 
  MetallizerPlan 
} from '../../types/metallizer';

/**
 * Client-Side API caller for Server-Side Metallizer Optimizer Services.
 * Runs heavy combinatorial optimization asynchronously on the server to prevent main-thread UI freezing.
 * Uses HTTP polling with progress tracking and job recovery on refresh.
 */

export interface JobProgressUpdate {
  percent: number;
  stage: string;
}

// In-flight request deduplication maps
const inFlightSynthesis = new Map<string, Promise<JumboRequirement[]>>();
const inFlightPlans = new Map<string, Promise<{ plans: MetallizerPlan[]; remainingOrders: VA05Order[]; updatedRolls: JumboRoll[] }>>();
const inFlightPS01 = new Map<string, Promise<{ plans: SlitterPlan[]; logs: any[] }>>();

const ACTIVE_JOB_KEY = 'msl_active_synthesis_job';

export function getStoredActiveJob(): { jobId: string; film: string; timestamp: number } | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp < 10 * 60 * 1000) {
      return parsed;
    }
    sessionStorage.removeItem(ACTIVE_JOB_KEY);
    return null;
  } catch {
    return null;
  }
}

export function clearStoredActiveJob() {
  try {
    sessionStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {}
}

async function pollJobUntilDone<T>(
  jobId: string,
  onProgress?: (update: JobProgressUpdate) => void,
  maxWaitMs: number = 180000
): Promise<T> {
  const startTime = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await fetch(`/api/metallizer/jobs/${jobId}`);
      if (res.ok) {
        consecutiveErrors = 0;
        const data = await res.json();
        if (data.success && data.job) {
          const { status, progress, currentStage, result, error } = data.job;

          if (onProgress && typeof progress === 'number') {
            onProgress({ percent: progress, stage: currentStage || 'Processing...' });
          }

          if (status === 'COMPLETED') {
            return result as T;
          }

          if (status === 'FAILED') {
            throw new Error(error || 'Server optimization job failed');
          }
        }
      } else if (res.status === 404) {
        throw new Error('Job was not found or expired on server');
      } else {
        consecutiveErrors++;
      }
    } catch (err: any) {
      if (err.message && (err.message.includes('Server optimization job failed') || err.message.includes('Job was not found'))) {
        throw err;
      }
      consecutiveErrors++;
      if (consecutiveErrors > 12) {
        throw new Error(`Lost connection to server job after repeated retries: ${err?.message || err}`);
      }
    }

    // Wait 250ms before next poll for fast responsive UI feedback
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error('Server optimization job exceeded maximum polling timeout (30s)');
}

export async function fetchJumboRequirementsAsync(
  orders: VA05Order[],
  settings: MetallizerMachineSettings,
  film?: string,
  onProgress?: (update: JobProgressUpdate) => void
): Promise<JumboRequirement[]> {
  const reqKey = `${film || 'ALL'}:${orders.length}:${orders.reduce((sum, o) => sum + (o.remaining_qty || 0), 0)}`;
  const existing = inFlightSynthesis.get(reqKey);
  if (existing) return existing;

  const promise = (async () => {
    onProgress?.({ percent: 5, stage: 'Connecting to server optimizer...' });

    // Step 1: Initialize or fetch active job from backend
    const res = await fetch('/api/metallizer/synthesize-requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, settings, film }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.message || `Server responded with HTTP ${res.status}`);
    }

    const initData = await res.json();
    if (!initData.success) {
      throw new Error(initData.error || 'Failed to start synthesis job');
    }

    // If completed immediately from cache
    if (initData.status === 'COMPLETED' && Array.isArray(initData.requirements)) {
      onProgress?.({ percent: 100, stage: 'Loaded cached synthesis result' });
      clearStoredActiveJob();
      return initData.requirements;
    }

    const jobId = initData.jobId;
    if (!jobId) {
      throw new Error('Server did not return a valid synthesis job identifier');
    }

    // Store in sessionStorage for page refresh resilience
    try {
      sessionStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({
        jobId,
        film: film || 'ALL',
        timestamp: Date.now(),
      }));
    } catch {}

    // Step 2: Poll job progress until completion
    const jobResult = await pollJobUntilDone<{ requirements: JumboRequirement[]; count: number }>(
      jobId,
      onProgress
    );

    clearStoredActiveJob();
    if (!jobResult || !Array.isArray(jobResult.requirements)) {
      throw new Error('Server job completed without returning valid requirements array');
    }

    return jobResult.requirements;
  })().finally(() => {
    inFlightSynthesis.delete(reqKey);
  });

  inFlightSynthesis.set(reqKey, promise);
  return promise;
}

export async function resumeActiveSynthesisJob(
  jobId: string,
  onProgress?: (update: JobProgressUpdate) => void
): Promise<JumboRequirement[]> {
  try {
    const jobResult = await pollJobUntilDone<{ requirements: JumboRequirement[]; count: number }>(
      jobId,
      onProgress
    );
    clearStoredActiveJob();
    if (jobResult && Array.isArray(jobResult.requirements)) {
      return jobResult.requirements;
    }
    throw new Error('Invalid resumed job payload');
  } catch (err) {
    clearStoredActiveJob();
    throw err;
  }
}

export async function fetchMetallizerPlansAsync(
  orders: VA05Order[],
  jumboRolls: JumboRoll[],
  settings: MetallizerMachineSettings,
  film?: string,
  onProgress?: (update: JobProgressUpdate) => void
): Promise<{
  plans: MetallizerPlan[];
  remainingOrders: VA05Order[];
  updatedRolls: JumboRoll[];
}> {
  const reqKey = `${film || 'ALL'}:${orders.length}:${jumboRolls.length}:${orders.reduce((sum, o) => sum + (o.remaining_qty || 0), 0)}`;
  const existing = inFlightPlans.get(reqKey);
  if (existing) return existing;

  const promise = (async () => {
    onProgress?.({ percent: 10, stage: 'Initializing MSL plan optimizer on server...' });

    const res = await fetch('/api/metallizer/generate-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, jumboRolls, settings, film }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.message || `Server responded with HTTP ${res.status}`);
    }

    const initData = await res.json();
    if (initData.status === 'COMPLETED' && Array.isArray(initData.plans)) {
      return {
        plans: initData.plans,
        remainingOrders: initData.remainingOrders || [],
        updatedRolls: initData.updatedRolls || [],
      };
    }

    const jobId = initData.jobId;
    if (!jobId) {
      throw new Error('Server did not return a valid MSL job identifier');
    }

    return await pollJobUntilDone<{
      plans: MetallizerPlan[];
      remainingOrders: VA05Order[];
      updatedRolls: JumboRoll[];
    }>(jobId, onProgress);
  })().finally(() => {
    inFlightPlans.delete(reqKey);
  });

  inFlightPlans.set(reqKey, promise);
  return promise;
}

export async function fetchPS01PlansAsync(
  requirements: JumboRequirement[],
  film: string,
  userName?: string,
  onProgress?: (update: JobProgressUpdate) => void
): Promise<{
  plans: SlitterPlan[];
  logs: any[];
}> {
  const reqKey = `${film}:${requirements.map(r => `${r.id}_${r.required_rolls_count}`).join(',')}`;
  const existing = inFlightPS01.get(reqKey);
  if (existing) return existing;

  const promise = (async () => {
    onProgress?.({ percent: 10, stage: 'Generating PS01 manufacturing factory sheets on server...' });

    const res = await fetch('/api/metallizer/generate-ps01-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirements, film, userName }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.message || `Server responded with HTTP ${res.status}`);
    }

    const initData = await res.json();
    if (initData.status === 'COMPLETED' && Array.isArray(initData.plans)) {
      return {
        plans: initData.plans,
        logs: initData.logs || [],
      };
    }

    const jobId = initData.jobId;
    if (!jobId) {
      throw new Error('Server did not return a valid PS01 job identifier');
    }

    return await pollJobUntilDone<{
      plans: SlitterPlan[];
      logs: any[];
    }>(jobId, onProgress);
  })().finally(() => {
    inFlightPS01.delete(reqKey);
  });

  inFlightPS01.set(reqKey, promise);
  return promise;
}

