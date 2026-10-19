import { 
  generateJumboRollRequirements, 
  generateMetallizerPlans 
} from './metallizerOptimizer';
import { generatePS01ManufacturingPlansForJumbos } from './ps01FeasibilityAdapter';
import { VA05Order, MetallizerMachineSettings, JumboRoll, JumboRequirement, SlitterPlan } from '../../types';

export interface SynthesisJob {
  id: string;
  type: 'SYNTHESIS' | 'MSL_PLANS' | 'PS01_PLANS';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number; // 0 - 100
  currentStage: string;
  payloadHash: string;
  createdAt: number;
  updatedAt: number;
  result?: any;
  error?: string;
}

// In-memory job store & completed result cache
const jobs = new Map<string, SynthesisJob>();
const hashToJobId = new Map<string, string>();

const MAX_JOBS = 100;
const JOB_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      if (hashToJobId.get(job.payloadHash) === id) {
        hashToJobId.delete(job.payloadHash);
      }
    }
  }
}

export function computePayloadHash(type: string, payload: any): string {
  try {
    if (type === 'SYNTHESIS') {
      const orders = payload.orders || [];
      const orderSig = orders.map((o: any) => `${o.id || o.sales_order}:${o.remaining_qty}:${o.width_mm}`).sort().join('|');
      return `SYNTH:${payload.film || 'ALL'}:${orders.length}:${orderSig}`;
    }
    if (type === 'MSL_PLANS') {
      const orders = payload.orders || [];
      const rolls = payload.jumboRolls || [];
      const orderSig = orders.map((o: any) => `${o.id}:${o.remaining_qty}`).sort().join('|');
      const rollSig = rolls.map((r: any) => `${r.id}:${r.remaining_length_m}:${r.status}`).sort().join('|');
      return `MSL_PLANS:${payload.film || 'ALL'}:${orders.length}:${rolls.length}:${orderSig}:${rollSig}`;
    }
    if (type === 'PS01_PLANS') {
      const reqs = payload.requirements || [];
      const reqSig = reqs.map((r: any) => `${r.id}:${r.required_rolls_count}:${r.required_jumbo_width_mm}`).join('|');
      return `PS01_PLANS:${payload.film || 'ALL'}:${reqs.length}:${reqSig}`;
    }
    return `${type}:${JSON.stringify(payload)}`;
  } catch {
    return `${type}:${Date.now()}:${Math.random()}`;
  }
}

export function getJob(jobId: string): SynthesisJob | null {
  cleanupOldJobs();
  return jobs.get(jobId) || null;
}

export function findJobByHash(hash: string): SynthesisJob | null {
  cleanupOldJobs();
  const id = hashToJobId.get(hash);
  if (!id) return null;
  return jobs.get(id) || null;
}

export function startSynthesisJob(
  orders: VA05Order[],
  settings: MetallizerMachineSettings,
  film?: string
): SynthesisJob {
  cleanupOldJobs();
  const hash = computePayloadHash('SYNTHESIS', { orders, settings, film });
  const existing = findJobByHash(hash);

  if (existing) {
    if (existing.status === 'COMPLETED' || existing.status === 'RUNNING' || existing.status === 'QUEUED') {
      return existing;
    }
  }

  const jobId = `synth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: SynthesisJob = {
    id: jobId,
    type: 'SYNTHESIS',
    status: 'RUNNING',
    progress: 5,
    currentStage: 'Initializing upstream handshake engine...',
    payloadHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Limit cache size
  if (jobs.size >= MAX_JOBS) {
    const oldestId = jobs.keys().next().value;
    if (oldestId) {
      const old = jobs.get(oldestId);
      if (old) hashToJobId.delete(old.payloadHash);
      jobs.delete(oldestId);
    }
  }

  jobs.set(jobId, job);
  hashToJobId.set(hash, jobId);

  // Execute asynchronously in background tick without blocking event loop
  setImmediate(() => {
    try {
      job.progress = 15;
      job.currentStage = 'Synthesizing 1–6 UPS configurations & evaluating PS01 deckles...';
      job.updatedAt = Date.now();

      const requirements = generateJumboRollRequirements(orders, settings, film, {
        onProgress: (pct, stage) => {
          job.progress = Math.min(95, Math.max(job.progress, pct));
          job.currentStage = stage;
          job.updatedAt = Date.now();
        },
      });

      job.status = 'COMPLETED';
      job.progress = 100;
      job.currentStage = 'Synthesis & PS01 feasibility complete';
      job.result = { requirements, count: requirements.length };
      job.updatedAt = Date.now();
    } catch (err: any) {
      console.error(`Synthesis Job ${jobId} failed:`, err);
      job.status = 'FAILED';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
    }
  });

  return job;
}

export function startMslPlanJob(
  orders: VA05Order[],
  jumboRolls: JumboRoll[],
  settings: MetallizerMachineSettings,
  film?: string
): SynthesisJob {
  cleanupOldJobs();
  const hash = computePayloadHash('MSL_PLANS', { orders, jumboRolls, settings, film });
  const existing = findJobByHash(hash);

  if (existing) {
    if (existing.status === 'COMPLETED' || existing.status === 'RUNNING' || existing.status === 'QUEUED') {
      return existing;
    }
  }

  const jobId = `msl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: SynthesisJob = {
    id: jobId,
    type: 'MSL_PLANS',
    status: 'RUNNING',
    progress: 10,
    currentStage: 'Generating MSL schedules against jumbo inventory...',
    payloadHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(jobId, job);
  hashToJobId.set(hash, jobId);

  setImmediate(() => {
    try {
      const result = generateMetallizerPlans(orders, jumboRolls, settings, film, undefined, {
        enableHybridOptimization: true,
      });
      job.status = 'COMPLETED';
      job.progress = 100;
      job.currentStage = 'MSL planning complete';
      job.result = result;
      job.updatedAt = Date.now();
    } catch (err: any) {
      console.error(`MSL Plan Job ${jobId} failed:`, err);
      job.status = 'FAILED';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
    }
  });

  return job;
}

export function startPS01PlanJob(
  requirements: JumboRequirement[],
  film?: string,
  userName?: string
): SynthesisJob {
  cleanupOldJobs();
  const hash = computePayloadHash('PS01_PLANS', { requirements, film, userName });
  const existing = findJobByHash(hash);

  if (existing) {
    if (existing.status === 'COMPLETED' || existing.status === 'RUNNING' || existing.status === 'QUEUED') {
      return existing;
    }
  }

  const jobId = `ps01_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: SynthesisJob = {
    id: jobId,
    type: 'PS01_PLANS',
    status: 'RUNNING',
    progress: 10,
    currentStage: 'Generating PS01 Factory Sheet schedules...',
    payloadHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(jobId, job);
  hashToJobId.set(hash, jobId);

  setImmediate(() => {
    try {
      const result = generatePS01ManufacturingPlansForJumbos(requirements, film, userName);
      job.status = 'COMPLETED';
      job.progress = 100;
      job.currentStage = 'PS01 Manufacturing Plans complete';
      job.result = result;
      job.updatedAt = Date.now();
    } catch (err: any) {
      console.error(`PS01 Plan Job ${jobId} failed:`, err);
      job.status = 'FAILED';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
    }
  });

  return job;
}
