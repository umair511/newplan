import { 
  generateSSJumboRollRequirements, 
  generateSSPlans 
} from './ssOptimizer';
import { generatePS01ManufacturingPlansForJumbos } from './ssPs01FeasibilityAdapter';
import { VA05Order, SlitterPlan } from '../../types';
import { SSMachineSettings, SSJumboRoll, SSJumboRequirement, SSPlan } from '../../types/ss';

export interface SSSynthesisJob {
  id: string;
  type: 'SYNTHESIS' | 'SS_PLANS' | 'PS01_PLANS';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  currentStage: string;
  payloadHash: string;
  createdAt: number;
  updatedAt: number;
  result?: any;
  error?: string;
}

export type SynthesisJob = SSSynthesisJob;

const jobs = new Map<string, SSSynthesisJob>();
const hashToJobId = new Map<string, string>();

const MAX_JOBS = 100;
const JOB_TTL_MS = 15 * 60 * 1000;

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
      return `SS_SYNTH:${payload.film || 'ALL'}:${orders.length}:${orderSig}`;
    }
    if (type === 'SS_PLANS' || type === 'MSL_PLANS') {
      const orders = payload.orders || [];
      const rolls = payload.jumboRolls || [];
      const orderSig = orders.map((o: any) => `${o.id}:${o.remaining_qty}`).sort().join('|');
      const rollSig = rolls.map((r: any) => `${r.id}:${r.remaining_length_m}:${r.status}`).sort().join('|');
      return `SS_PLANS:${payload.film || 'ALL'}:${orders.length}:${rolls.length}:${orderSig}:${rollSig}`;
    }
    if (type === 'PS01_PLANS') {
      const reqs = payload.requirements || [];
      const reqSig = reqs.map((r: any) => `${r.id}:${r.required_rolls_count}:${r.required_jumbo_width_mm}`).join('|');
      return `SS_PS01_PLANS:${payload.film || 'ALL'}:${reqs.length}:${reqSig}`;
    }
    return `SS_${type}:${JSON.stringify(payload)}`;
  } catch {
    return `SS_${type}:${Date.now()}:${Math.random()}`;
  }
}

export function getJob(jobId: string): SSSynthesisJob | null {
  cleanupOldJobs();
  return jobs.get(jobId) || null;
}

export function findJobByHash(hash: string): SSSynthesisJob | null {
  cleanupOldJobs();
  const id = hashToJobId.get(hash);
  if (!id) return null;
  return jobs.get(id) || null;
}

export function startSynthesisJob(
  orders: VA05Order[],
  settings: SSMachineSettings,
  film?: string
): SSSynthesisJob {
  cleanupOldJobs();
  const hash = computePayloadHash('SYNTHESIS', { orders, settings, film });
  const existing = findJobByHash(hash);

  if (existing) {
    const hasLegacy7Ups = existing.result?.requirements?.some((r: any) =>
      r.film === 'CG44H20' && (r.ps01_feasibility?.ps01_ups === 7 || (r.ps01_feasibility?.explanation && r.ps01_feasibility.explanation.includes('7-UPS')))
    );
    if (!hasLegacy7Ups && (existing.status === 'COMPLETED' || existing.status === 'RUNNING' || existing.status === 'QUEUED')) {
      return existing;
    }
    jobs.delete(existing.id);
    hashToJobId.delete(hash);
  }

  const jobId = `ss_synth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: SSSynthesisJob = {
    id: jobId,
    type: 'SYNTHESIS',
    status: 'RUNNING',
    progress: 5,
    currentStage: 'Initializing SS upstream handshake engine...',
    payloadHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

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

  setImmediate(() => {
    try {
      job.progress = 15;
      job.currentStage = 'Synthesizing SS 1–14 UPS configurations & evaluating PS01 deckles...';
      job.updatedAt = Date.now();

      const requirements = generateSSJumboRollRequirements(orders, settings, film, {
        onProgress: (pct, stage) => {
          job.progress = Math.min(95, Math.max(job.progress, pct));
          job.currentStage = stage;
          job.updatedAt = Date.now();
        },
      });

      job.status = 'COMPLETED';
      job.progress = 100;
      job.currentStage = 'SS Synthesis & PS01 feasibility complete';
      job.result = { requirements, count: requirements.length };
      job.updatedAt = Date.now();
    } catch (err: any) {
      console.error(`SS Synthesis Job ${jobId} failed:`, err);
      job.status = 'FAILED';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
    }
  });

  return job;
}

export function startSSPlanJob(
  orders: VA05Order[],
  jumboRolls: SSJumboRoll[],
  settings: SSMachineSettings,
  film?: string
): SSSynthesisJob {
  cleanupOldJobs();
  const hash = computePayloadHash('SS_PLANS', { orders, jumboRolls, settings, film });
  const existing = findJobByHash(hash);

  if (existing) {
    if (existing.status === 'COMPLETED' || existing.status === 'RUNNING' || existing.status === 'QUEUED') {
      return existing;
    }
  }

  const jobId = `ss_plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: SSSynthesisJob = {
    id: jobId,
    type: 'SS_PLANS',
    status: 'RUNNING',
    progress: 10,
    currentStage: 'Generating SS schedules against jumbo inventory...',
    payloadHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(jobId, job);
  hashToJobId.set(hash, jobId);

  setImmediate(() => {
    try {
      const result = generateSSPlans(orders, jumboRolls, settings, film);
      job.status = 'COMPLETED';
      job.progress = 100;
      job.currentStage = 'SS planning complete';
      job.result = result;
      job.updatedAt = Date.now();
    } catch (err: any) {
      console.error(`SS Plan Job ${jobId} failed:`, err);
      job.status = 'FAILED';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
    }
  });

  return job;
}

export const startMslPlanJob = startSSPlanJob;

export function startPS01PlanJob(
  requirements: SSJumboRequirement[],
  film?: string,
  userName?: string
): SSSynthesisJob {
  cleanupOldJobs();
  const hash = computePayloadHash('PS01_PLANS', { requirements, film, userName });
  const existing = findJobByHash(hash);

  if (existing) {
    if (existing.status === 'COMPLETED' || existing.status === 'RUNNING' || existing.status === 'QUEUED') {
      return existing;
    }
  }

  const jobId = `ss_ps01_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: SSSynthesisJob = {
    id: jobId,
    type: 'PS01_PLANS',
    status: 'RUNNING',
    progress: 10,
    currentStage: 'Generating PS01 Factory Sheet schedules for SS requirements...',
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
      console.error(`SS PS01 Plan Job ${jobId} failed:`, err);
      job.status = 'FAILED';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
    }
  });

  return job;
}
