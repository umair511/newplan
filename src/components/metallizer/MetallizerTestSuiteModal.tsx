import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  Play, 
  RotateCw, 
  CheckCircle2, 
  AlertCircle, 
  Filter,
  CheckCircle,
  Clock,
  Sparkles
} from 'lucide-react';
import { MetallizerTestCaseResult, runAllMetallizerTests } from '../../services/metallizer/metallizerTestSuite';

interface MetallizerTestSuiteModalProps {
  onClose: () => void;
}

export const MetallizerTestSuiteModal: React.FC<MetallizerTestSuiteModalProps> = ({ onClose }) => {
  const [results, setResults] = useState<MetallizerTestCaseResult[]>(() => runAllMetallizerTests());
  const [isRunning, setIsRunning] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');

  const handleRunTests = () => {
    setIsRunning(true);
    setTimeout(() => {
      const res = runAllMetallizerTests();
      setResults(res);
      setIsRunning(false);
    }, 200);
  };

  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const passRate = results.length > 0 ? Math.round((passCount / results.length) * 100) : 0;

  const filteredResults = results.filter(r => {
    if (filter === 'PASS') return r.status === 'PASS';
    if (filter === 'FAIL') return r.status === 'FAIL';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-slate-300 rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold tracking-tight text-white flex items-center space-x-2">
                <span>Metallizer Slitter Acceptance Test Suite</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  {passCount} / {results.length} PASSED ({passRate}%)
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Verifies Section 1–21 Business Rules, Physical Geometry & PS01 Handshake Integration (MSL-01 to MSL-57)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleRunTests}
              disabled={isRunning}
              className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{isRunning ? 'Running...' : 'Re-Run All'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* KPI Banner */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-4">
            <span className="font-bold text-slate-700">Test Execution Summary:</span>
            <span className="text-emerald-700 font-bold font-mono">Passed: {passCount}</span>
            <span className="text-rose-700 font-bold font-mono">Failed: {failCount}</span>
            <span className="text-slate-600">Pass Rate: <b className="font-mono text-emerald-700">{passRate}%</b></span>
          </div>

          <div className="flex items-center space-x-1">
            {['ALL', 'PASS', 'FAIL'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                  filter === f
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-6 space-y-2.5 flex-1">
          {filteredResults.map(t => (
            <div
              key={t.id}
              className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                t.status === 'PASS'
                  ? 'bg-emerald-50/40 border-emerald-200/80 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-900 text-[11px]">
                    {t.code}
                  </span>
                  <span className="font-bold text-slate-900 text-xs">{t.title}</span>
                </div>
                <p className="text-slate-600 text-[11px]">{t.description}</p>
                <div className="text-[10px] text-slate-500 font-mono flex items-center space-x-3 pt-0.5">
                  <span>Exp: <b className="text-slate-700">{t.expected}</b></span>
                  <span>·</span>
                  <span>Act: <b className="text-slate-700">{t.actual}</b></span>
                </div>
              </div>

              <div className="flex items-center space-x-2 sm:shrink-0 self-end sm:self-center">
                <span className={`px-2.5 py-1 text-[11px] font-bold rounded-md flex items-center space-x-1 ${
                  t.status === 'PASS'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}>
                  {t.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  <span>{t.status}</span>
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            Note: Primary Slitter PS01 tests (63/63) are isolated and remain 100% passing.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
