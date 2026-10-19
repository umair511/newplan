import React, { useState, useEffect } from 'react';
import { runAllAcceptanceTests, TestSuiteResult, DetailedTestResultItem } from '../services/optimizer/testSuite';
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  RefreshCw, 
  X, 
  Play, 
  FileCode, 
  SlidersHorizontal,
  Search,
  Layers,
  Scissors,
  Scale,
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface TestSuiteModalProps {
  onClose: () => void;
}

export const TestSuiteModal: React.FC<TestSuiteModalProps> = ({ onClose }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestSuiteResult | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const executeTests = () => {
    setIsRunning(true);
    setTimeout(() => {
      const results = runAllAcceptanceTests();
      setTestResult(results);
      setIsRunning(false);
    }, 200);
  };

  useEffect(() => {
    executeTests();
  }, []);

  const categories = [
    { id: 'ALL', label: 'All Tests' },
    { id: 'DYNAMIC_REPLACEMENT', label: 'Lookahead & Anti-Oscillation' },
    { id: 'PHYSICAL_CONSTRAINTS', label: 'Deckle & Trim (150-280mm)' },
    { id: 'UPS_LIMITS', label: 'Slitter Arms (3-16 UPS)' },
    { id: 'TARGET_QUANTITY_CONTROL', label: 'Target & +10% Ceiling' },
    { id: 'GOLDEN_DATASET', label: 'Golden Benchmarks' },
    { id: 'WEIGHT_FORMULA', label: 'Weight Calculations' },
    { id: 'ORDER_CLOSURE', label: 'Order Closure' },
    { id: 'TRIM_RULES', label: 'Trim Rules' },
  ];

  const filteredResults = testResult?.results.filter((item: DetailedTestResultItem) => {
    const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
    const matchesSearch = searchTerm === '' || 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  }) || [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-300">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-emerald-600/30 text-emerald-400 border border-emerald-500/40">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">SRS v1.0 Business Rule Acceptance Test Suite</h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Verified Deterministic Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Deterministic validation of dynamic lengths (15,000m, 20,000m), same-length prioritization, & mixed fallback
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={executeTests}
              disabled={isRunning}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors disabled:bg-slate-700 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>Re-run Suite</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters & Summary Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0 space-y-3">
          {/* Summary Metric Cards */}
          {testResult && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Total Validations</span>
                  <div className="text-xl font-bold font-mono text-slate-900">{testResult.total}</div>
                </div>
                <Layers className="w-5 h-5 text-slate-400" />
              </div>

              <div className="bg-white p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700">Passed Tests</span>
                  <div className="text-xl font-bold font-mono text-emerald-700">{testResult.passed}</div>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Failed Tests</span>
                  <div className={`text-xl font-bold font-mono ${testResult.failed > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                    {testResult.failed}
                  </div>
                </div>
                <XCircle className={`w-5 h-5 ${testResult.failed > 0 ? 'text-rose-500' : 'text-slate-300'}`} />
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Length Architecture</span>
                  <div className="text-xs font-bold text-emerald-700 mt-1">100% Dynamic Data</div>
                </div>
                <Sparkles className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
          )}

          {/* Search & Category Tabs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
            {/* Category Tabs */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
              {categories.map((cat) => {
                const count = cat.id === 'ALL' 
                  ? testResult?.total 
                  : (testResult?.categoryCounts[cat.id]?.total || 0);
                const isSelected = selectedCategory === cat.id;

                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span>{cat.label}</span>
                    {count !== undefined && (
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                        isSelected ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative shrink-0 sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter tests (e.g. 15000, mixed)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Results Body */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {filteredResults.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold">No tests match your filter criteria.</p>
              <button 
                onClick={() => { setSelectedCategory('ALL'); setSearchTerm(''); }}
                className="mt-2 text-xs text-emerald-600 font-semibold hover:underline"
              >
                Reset filters
              </button>
            </div>
          ) : (
            filteredResults.map((item) => {
              const isLengthTest = item.category === 'REPETITIONS';
              const isMixedTest = item.id.includes('mixed');

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-all ${
                    item.passed 
                      ? isMixedTest
                        ? 'bg-amber-50/30 border-amber-200/80 hover:border-amber-300'
                        : isLengthTest 
                          ? 'bg-emerald-50/20 border-emerald-100 hover:border-emerald-300' 
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      : 'bg-rose-50 border-rose-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start space-x-3">
                      {item.passed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {item.id}
                          </span>
                          <span className="font-bold text-sm text-slate-900">{item.name}</span>
                          {isMixedTest && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              Mixed-Length Fallback Rule
                            </span>
                          )}
                          {isLengthTest && !isMixedTest && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Dynamic Length Architecture
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">
                          {item.description}
                        </p>

                        <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                          <div className="bg-slate-50 p-2 rounded border border-slate-200">
                            <span className="text-[10px] text-slate-400 uppercase font-sans font-bold block">Expected Outcome:</span>
                            <span className="text-slate-700 break-words">{item.expected}</span>
                          </div>
                          <div className={`p-2 rounded border ${item.passed ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                            <span className="text-[10px] text-slate-400 uppercase font-sans font-bold block">Actual Optimization Output:</span>
                            <span className="font-semibold break-words">{item.actual}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0 space-y-1">
                      <span className={`px-2.5 py-1 rounded text-xs font-bold font-mono shadow-2xs ${
                        item.passed ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                      }`}>
                        {item.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {item.execution_ms} ms
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>All test cases execute deterministically in-memory against primary slitter optimization rules.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
