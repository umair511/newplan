/**
 * MSL background worker — mirrors PS optimizer.worker pattern.
 * Optimizer logic is imported as-is; this file only offloads CPU work off the UI thread.
 */
import { generateJumboRollRequirements, generateMetallizerPlans } from './metallizerOptimizer';
import { hydrateFilmSpecsCache } from '../stuffing/filmDensities';

export type MSLWorkerRequest =
  | {
      type: 'RUN_SYNTHESIS';
      orders: any[];
      settings: any;
      film?: string;
      executionId?: string;
      filmSpecs?: any[];
    }
  | {
      type: 'RUN_PLANS';
      orders: any[];
      jumboRolls: any[];
      settings: any;
      film?: string;
      options?: any;
      executionId?: string;
      filmSpecs?: any[];
    };

export type MSLWorkerResponse =
  | {
      type: 'SYNTHESIS_SUCCESS';
      requirements: any[];
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
      type: 'MSL_ERROR';
      error: string;
      executionId?: string;
    };

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (event: MessageEvent<MSLWorkerRequest>) => {
    const data = event.data;
    const executionId = data.executionId || 'MSL-' + Math.floor(100000 + Math.random() * 900000);
    const tStart = performance.now();

    try {
      // Permanent: density Master DB from main thread (no localStorage in workers)
      hydrateFilmSpecsCache((data as any).filmSpecs);

      if (data.type === 'RUN_SYNTHESIS') {
        const requirements = generateJumboRollRequirements(
          data.orders,
          data.settings,
          data.film
        );
        const durationMs = Math.round((performance.now() - tStart) * 100) / 100;
        const response: MSLWorkerResponse = {
          type: 'SYNTHESIS_SUCCESS',
          requirements,
          durationMs,
          executionId,
        };
        self.postMessage(response);
        return;
      }

      if (data.type === 'RUN_PLANS') {
        const result = generateMetallizerPlans(
          data.orders,
          data.jumboRolls,
          data.settings,
          data.film,
          undefined,
          data.options || { enableHybridOptimization: true }
        );
        const durationMs = Math.round((performance.now() - tStart) * 100) / 100;
        const response: MSLWorkerResponse = {
          type: 'PLANS_SUCCESS',
          result,
          durationMs,
          executionId,
        };
        self.postMessage(response);
        return;
      }
    } catch (err: any) {
      const response: MSLWorkerResponse = {
        type: 'MSL_ERROR',
        error: err?.message || 'MSL worker error',
        executionId,
      };
      self.postMessage(response);
    }
  };
}
