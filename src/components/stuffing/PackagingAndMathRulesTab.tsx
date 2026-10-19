import React, { useState, useMemo } from 'react';
import { PACKAGING_AND_MATH_RULES } from '../../rules/registry';
import { PackagingRule, RuleCategory, RuleSeverity } from '../../rules/types';
import {
  ShieldCheck,
  Lock,
  Sliders,
  Search,
  BookOpen,
  Calculator,
  Box,
  Layers,
  Package,
  PackageCheck,
  FileText,
  Scale,
  Info,
  CheckCircle2,
} from 'lucide-react';

const CATEGORY_META: Record<RuleCategory, { label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  MATH: {
    label: 'Mathematical Laws',
    description: 'Scientific mass formulas, geometric roll diameters, and mass conservation laws',
    icon: Calculator,
  },
  CONT: {
    label: 'Container Dimensions',
    description: '40ft HC and 20ft interior dimensions, door ingress limits, and max payload caps',
    icon: Box,
  },
  PACK: {
    label: 'General Palletization',
    description: 'Pallet clearance formulas, base dimensions, and tare allowances',
    icon: Layers,
  },
  HPP: {
    label: 'Horizontal Packing (HPP)',
    description: 'Cradle ply selection, 3-line loading eligibility, and roll tipping stability limits',
    icon: Package,
  },
  VPP: {
    label: 'Vertical Packing (VPP)',
    description: 'Eye-to-sky roll grids, small roll & standard export skids, and tier stacking formulas',
    icon: PackageCheck,
  },
  FILM: {
    label: 'Film & Substrate Specs',
    description: 'Substrate specific gravities, micron thickness extraction, and core ODs',
    icon: FileText,
  },
  TOL: {
    label: 'Commercial Tolerances',
    description: 'Contractual +/-10% shipment window, drop palletization, and buffer percentages',
    icon: Scale,
  },
};

export const PackagingAndMathRulesTab: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<RuleCategory | 'ALL'>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<RuleSeverity | 'ALL'>('ALL');

  const totalRules = PACKAGING_AND_MATH_RULES.length;
  const hardCount = useMemo(() => PACKAGING_AND_MATH_RULES.filter(r => r.severity === 'HARD').length, []);
  const softCount = useMemo(() => PACKAGING_AND_MATH_RULES.filter(r => r.severity === 'SOFT').length, []);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: totalRules };
    for (const rule of PACKAGING_AND_MATH_RULES) {
      counts[rule.category] = (counts[rule.category] || 0) + 1;
    }
    return counts;
  }, [totalRules]);

  // Filtered rules
  const filteredRules = useMemo(() => {
    return PACKAGING_AND_MATH_RULES.filter(rule => {
      if (selectedCategory !== 'ALL' && rule.category !== selectedCategory) {
        return false;
      }
      if (selectedSeverity !== 'ALL' && rule.severity !== selectedSeverity) {
        return false;
      }
      if (searchTerm.trim() !== '') {
        const q = searchTerm.toLowerCase();
        const matchesId = rule.id.toLowerCase().includes(q);
        const matchesName = rule.name.toLowerCase().includes(q);
        const matchesDesc = rule.description.toLowerCase().includes(q);
        const matchesFormula = rule.formulaOrConstraint.toLowerCase().includes(q);
        const matchesRationale = rule.rationale.toLowerCase().includes(q);
        const matchesSource = rule.source.toLowerCase().includes(q);
        return matchesId || matchesName || matchesDesc || matchesFormula || matchesRationale || matchesSource;
      }
      return true;
    });
  }, [searchTerm, selectedCategory, selectedSeverity]);

  // Group filtered rules by category
  const groupedRules = useMemo(() => {
    const groups: { category: RuleCategory; rules: PackagingRule[] }[] = [];
    const categories: RuleCategory[] = ['MATH', 'CONT', 'PACK', 'HPP', 'VPP', 'FILM', 'TOL'];

    for (const cat of categories) {
      const catRules = filteredRules.filter(r => r.category === cat);
      if (catRules.length > 0) {
        groups.push({ category: cat, rules: catRules });
      }
    }
    return groups;
  }, [filteredRules]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Authoritative Single Source of Truth Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-xl p-5 text-white shadow-xs border border-blue-900/60 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <h2 className="text-base font-bold tracking-wide text-white">
                Packaging &amp; Math Rules — Master Registry
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-400/20 text-emerald-300 border border-emerald-400/30">
                Single Source of Truth
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
              Authoritative, machine-validated registry of all mathematical formulas, container structural boundaries,
              palletization laws, substrate specifications, and commercial tolerance rules extracted directly from the production engine.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-700/50 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Read-Only
            </span>
          </div>
        </div>

        {/* Rule Metrics Summary Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800 text-xs">
          <div className="bg-slate-800/60 p-2.5 rounded-lg border border-slate-700/50">
            <div className="text-[11px] text-slate-400">Total Master Rules</div>
            <div className="text-lg font-bold text-white font-mono mt-0.5">{totalRules}</div>
          </div>
          <div className="bg-rose-950/40 p-2.5 rounded-lg border border-rose-800/40">
            <div className="text-[11px] text-rose-300 flex items-center gap-1">
              <Lock className="w-3 h-3 text-rose-400" />
              HARD (Immutable)
            </div>
            <div className="text-lg font-bold text-rose-200 font-mono mt-0.5">{hardCount}</div>
          </div>
          <div className="bg-blue-950/40 p-2.5 rounded-lg border border-blue-800/40">
            <div className="text-[11px] text-blue-300 flex items-center gap-1">
              <Sliders className="w-3 h-3 text-blue-400" />
              SOFT (Configurable)
            </div>
            <div className="text-lg font-bold text-blue-200 font-mono mt-0.5">{softCount}</div>
          </div>
          <div className="bg-slate-800/60 p-2.5 rounded-lg border border-slate-700/50">
            <div className="text-[11px] text-slate-400">Registry Source</div>
            <div className="text-xs font-semibold text-slate-200 font-mono mt-1.5 truncate">
              src/rules/registry.ts
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by rule ID (e.g. MATH-001, HPP-004), keyword, formula, or constraint..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Severity selector */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 mr-1">Severity:</span>
            {(['ALL', 'HARD', 'SOFT'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSelectedSeverity(sev)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                  selectedSeverity === sev
                    ? sev === 'HARD'
                      ? 'bg-rose-600 text-white border-rose-500'
                      : sev === 'SOFT'
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750'
                }`}
              >
                {sev === 'ALL' ? 'All' : sev}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400 mr-1">Category:</span>
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedCategory === 'ALL'
                ? 'bg-blue-900 dark:bg-blue-600 text-white border-blue-900 dark:border-blue-600'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750'
            }`}
          >
            <span>All Categories</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-black/20 dark:bg-white/20">
              {totalRules}
            </span>
          </button>

          {(['MATH', 'CONT', 'PACK', 'HPP', 'VPP', 'FILM', 'TOL'] as RuleCategory[]).map((cat) => {
            const Icon = CATEGORY_META[cat].icon;
            const count = categoryCounts[cat] || 0;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                  selectedCategory === cat
                    ? 'bg-blue-900 dark:bg-blue-600 text-white border-blue-900 dark:border-blue-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-black/20 dark:bg-white/20">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Showing rules count & results */}
      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 px-1">
        <span>
          Showing <strong>{filteredRules.length}</strong> of {totalRules} rules
          {searchTerm && <span> matching &ldquo;{searchTerm}&rdquo;</span>}
        </span>
        {(searchTerm || selectedCategory !== 'ALL' || selectedSeverity !== 'ALL') && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('ALL');
              setSelectedSeverity('ALL');
            }}
            className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Rules list grouped by Category */}
      {groupedRules.length === 0 ? (
        <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
          <BookOpen className="w-8 h-8 mx-auto mb-2 text-slate-400" />
          <p className="text-sm font-semibold">No rules found matching your filters.</p>
          <p className="text-xs mt-1">Try broadening your search term or category selection.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedRules.map(({ category, rules }) => {
            const meta = CATEGORY_META[category];
            const CategoryIcon = meta.icon;

            return (
              <div
                key={category}
                className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200/80 dark:border-slate-800 p-5 space-y-4"
              >
                {/* Category Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-800 dark:text-blue-300">
                      <CategoryIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>{category} &mdash; {meta.label}</span>
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-mono">
                          ({rules.length} {rules.length === 1 ? 'rule' : 'rules'})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {meta.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Category Rule Cards */}
                <div className="grid grid-cols-1 gap-4">
                  {rules.map((rule) => {
                    const isHard = rule.severity === 'HARD';

                    return (
                      <div
                        key={rule.id}
                        className={`rounded-xl border p-4 space-y-3 transition-colors ${
                          isHard
                            ? 'bg-slate-50/70 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            : 'bg-slate-50/40 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        {/* Rule Top Row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Rule ID Badge */}
                            <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
                              {rule.id}
                            </span>

                            {/* Severity Badge */}
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 border ${
                                isHard
                                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                  : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                              }`}
                            >
                              {isHard ? (
                                <>
                                  <Lock className="w-3 h-3" />
                                  <span>HARD (Immutable)</span>
                                </>
                              ) : (
                                <>
                                  <Sliders className="w-3 h-3" />
                                  <span>SOFT (Configurable)</span>
                                </>
                              )}
                            </span>

                            {/* Rule Name */}
                            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {rule.name}
                            </h4>
                          </div>

                          {/* Source Tag */}
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-950 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 truncate max-w-xs self-start sm:self-auto">
                            {rule.source}
                          </div>
                        </div>

                        {/* Description */}
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          {rule.description}
                        </p>

                        {/* Formula or Constraint Box */}
                        <div className="bg-slate-100 dark:bg-slate-950/90 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-800/80 space-y-1">
                          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Formula / Physical Constraint
                          </div>
                          <code className="block text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 break-words whitespace-pre-wrap">
                            {rule.formulaOrConstraint}
                          </code>
                        </div>

                        {/* Rationale */}
                        <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          <strong className="text-slate-700 dark:text-slate-300">Rationale: </strong>
                          {rule.rationale}
                        </div>

                        {/* Ambiguities / Notes (if present) */}
                        {rule.ambiguitiesOrNotes && (
                          <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2">
                            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <span className="font-bold">Engineering Note: </span>
                              <span>{rule.ambiguitiesOrNotes}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
