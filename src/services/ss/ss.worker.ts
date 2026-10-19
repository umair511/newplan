/**
 * SS background worker — mirrors PS optimizer.worker pattern.
 * Optimizer logic is imported as-is; this file only offloads CPU work off the UI thread.
 */
import { generateSSJumboRollRequirements, generateSSPlans } from './ssOptimizer';
import { generateSsJumboRequirementsViaPsEngine } from './ssPsEngineAdapter';
import { hydrateFilmSpecsCache } from '../stuffing/filmDensities';
/**
 * Dedicated workers cannot access localStorage. Main thread reads Film Specs Master DB
 * from localStorage (getFilmSpecsDatabase) and sends `filmSpecs` on every message.
 * hydrateFilmSpecsCache installs that exact snapshot — all density lookups use Master DB only.
 */

export type SSWorkerRequest =
  | {
      type: 'RUN_SYNTHESIS';
      orders: any[];
      settings: any;
      film?: string;
      executionId?: string;
    
      filmSpecs?: any[];
    }
  | {
      type: 'RUN_PS_ENGINE';
      orders: any[];
      settings: any;
      film: string;
      trimMode?: 'GREEN' | 'YELLOW' | 'CUSTOM';
      customMinTrimMm?: number;
      customMaxTrimMm?: number;
      createdBy?: string;
      executionId?: string;
    
      filmSpecs?: any[];
    }
  | {
      type: 'RUN_PLANS';
      orders: any[];
      jumboRolls: any[];
      settings: any;
      film?: string;
      requirements?: any[];
      executionId?: string;
    
      filmSpecs?: any[];
    };

export type SSWorkerResponse =
  | {
      type: 'SYNTHESIS_SUCCESS';
      requirements: any[];
      /** Present when RUN_PS_ENGINE — authentic PS SlitterPlans for PlanDetailViewer */
      plans?: any[];
      durationMs?: number;
      executionId?: string;
    }
  | {
      type: 'PLANS_SUCCESS';
      result: any;
      durationMs?: number;
      executionId?: string;
    }
  | {
      type: 'SS_ERROR';
      error: string;
      executionId?: string;
    };

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (event: MessageEvent<SSWorkerRequest>) => {
    const data = event.data;
    const executionId = data.executionId || 'SS-' + Math.floor(100000 + Math.random() * 900000);
    const tStart = performance.now();

    try {
      // Main thread sends latest Film Specs Master (worker has no localStorage)
      hydrateFilmSpecsCache((data as any).filmSpecs);

      if (data.type === 'RUN_SYNTHESIS') {
        const requirements = generateSSJumboRollRequirements(
          data.orders,
          data.settings,
          data.film
        );
        const durationMs = Math.round((performance.now() - tStart) * 100) / 100;
        const response: SSWorkerResponse = {
          type: 'SYNTHESIS_SUCCESS',
          requirements,
          durationMs,
          executionId,
        };
        self.postMessage(response);
        return;
      }

      if (data.type === 'RUN_PS_ENGINE') {
        const result = generateSsJumboRequirementsViaPsEngine({
          film: data.film,
          orders: data.orders,
          settings: data.settings,
          trimMode: data.trimMode || 'GREEN',
          customMinTrimMm: data.customMinTrimMm,
          customMaxTrimMm: data.customMaxTrimMm,
          createdBy: data.createdBy,
        });
        const durationMs = Math.round((performance.now() - tStart) * 100) / 100;
        if (!result.requirements.length) {
          const response: SSWorkerResponse = {
            type: 'SS_ERROR',
            error:
              result.stop_reason ||
              `PS Engine found no feasible plan for ${data.film}. Try YELLOW trim (36–45) or check open demand.`,
            executionId,
          };
          self.postMessage(response);
          return;
        }
        const response: SSWorkerResponse = {
          type: 'SYNTHESIS_SUCCESS',
          requirements: result.requirements,
          plans: result.plans,
          durationMs,
          executionId,
        };
        self.postMessage(response);
        return;
      }

      if (data.type === 'RUN_PLANS') {
        const result = generateSSPlans(
          data.orders,
          data.jumboRolls,
          data.settings,
          data.film,
          undefined,
          data.requirements
        );
        const durationMs = Math.round((performance.now() - tStart) * 100) / 100;
        const response: SSWorkerResponse = {
          type: 'PLANS_SUCCESS',
          result,
          durationMs,
          executionId,
        };
        self.postMessage(response);
        return;
      }
    } catch (err: any) {
      const response: SSWorkerResponse = {
        type: 'SS_ERROR',
        error: err?.message || 'SS worker error',
        executionId,
      };
      self.postMessage(response);
    }
  };
}
