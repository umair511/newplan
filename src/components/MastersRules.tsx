import React, { useState, useEffect } from 'react';
import { PlanningRules, UserProfile } from '../types';
import { DEFAULT_PLANNING_RULES } from '../services/masterData';
import { saveStoredRules, logAuditEvent } from '../services/storage';
import { Settings, ShieldCheck, Save, RotateCcw, CheckCircle2 } from 'lucide-react';

interface MastersRulesProps {
  rules: PlanningRules;
  currentUser: UserProfile;
  onRulesUpdated: (newRules: PlanningRules) => void;
}

export const MastersRules: React.FC<MastersRulesProps> = ({
  rules,
  currentUser,
  onRulesUpdated,
}) => {
  const normalizeRules = (r: PlanningRules): PlanningRules => {
    const deckle = Number(r.deckle_width_mm ?? r.deckle_mm) || 10400;
    return {
      ...r,
      deckle_width_mm: deckle,
      deckle_mm: deckle,
    };
  };

  const [formRules, setFormRules] = useState<PlanningRules>(() => normalizeRules({ ...rules }));
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setFormRules(normalizeRules({ ...rules }));
  }, [rules]);

  const handleSave = () => {
    const toSave = normalizeRules({
      ...formRules,
      version: formRules.version || '1.2',
      updated_at: new Date().toISOString(),
    });
    saveStoredRules(toSave);
    onRulesUpdated(toSave);
    setFormRules(toSave);
    logAuditEvent(
      currentUser,
      'UPDATE',
      'PLANNING_RULES',
      toSave.version,
      `Updated machine rules: Deckle=${toSave.deckle_width_mm}mm, Trim=${toSave.min_trim_mm}-${toSave.max_trim_mm}mm, UPS=${toSave.min_ups}-${toSave.max_ups}`
    );
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleReset = () => {
    setFormRules({ ...DEFAULT_PLANNING_RULES });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            <span>Primary Slitter Parameters</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure PS machine limits: deckle, trim window, UPS, and slit constraints.
          </p>
        </div>

        {currentUser.role !== 'VIEWER' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleReset}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors flex items-center space-x-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Factory Defaults</span>
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Rules</span>
            </button>
          </div>
        )}
      </div>

      {savedSuccess && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Machine parameters successfully updated and active for next optimization runs.</span>
        </div>
      )}

      {/* Grid: Machine Constraints & Film Masters */}
      <div className="max-w-2xl">
        {/* Machine Configuration */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">Primary Slitter Parameters</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Total Deckle Width (mm):</label>
              <input
                type="number"
                min={1000}
                max={20000}
                step={1}
                value={formRules.deckle_width_mm ?? formRules.deckle_mm ?? 10400}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 10400;
                  setFormRules({ ...formRules, deckle_width_mm: v, deckle_mm: v });
                }}
                disabled={currentUser.role === 'VIEWER'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400"
              />
              <span className="text-[10px] text-slate-400">Editable mill-roll / mother deckle width (mm). PS engine uses this value.</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 font-semibold block mb-1">Min Trim (mm):</label>
                <input
                  type="number"
                  value={formRules.min_trim_mm}
                  onChange={(e) => setFormRules({ ...formRules, min_trim_mm: parseFloat(e.target.value) || 150 })}
                  disabled={currentUser.role === 'VIEWER'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
                />
              </div>
              <div>
                <label className="text-slate-600 font-semibold block mb-1">Max Trim (mm):</label>
                <input
                  type="number"
                  value={formRules.max_trim_mm}
                  onChange={(e) => setFormRules({ ...formRules, max_trim_mm: parseFloat(e.target.value) || 280 })}
                  disabled={currentUser.role === 'VIEWER'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 font-semibold block mb-1">Min Arms / UPS:</label>
                <input
                  type="number"
                  value={formRules.min_ups}
                  onChange={(e) => setFormRules({ ...formRules, min_ups: parseInt(e.target.value) || 3 })}
                  disabled={currentUser.role === 'VIEWER'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
                />
              </div>
              <div>
                <label className="text-slate-600 font-semibold block mb-1">Max Arms / UPS:</label>
                <input
                  type="number"
                  value={formRules.max_ups}
                  onChange={(e) => setFormRules({ ...formRules, max_ups: parseInt(e.target.value) || 16 })}
                  disabled={currentUser.role === 'VIEWER'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 font-semibold block mb-1">Full Repetition (m):</label>
                <input
                  type="number"
                  value={formRules.full_repetition_length_m}
                  onChange={(e) => setFormRules({ ...formRules, full_repetition_length_m: parseFloat(e.target.value) || 19500 })}
                  disabled={currentUser.role === 'VIEWER'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
                />
              </div>
              <div>
                <label className="text-slate-600 font-semibold block mb-1">Half Repetition (m):</label>
                <input
                  type="number"
                  value={formRules.half_repetition_length_m}
                  onChange={(e) => setFormRules({ ...formRules, half_repetition_length_m: parseFloat(e.target.value) || 9750 })}
                  disabled={currentUser.role === 'VIEWER'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-600 font-semibold block mb-1">Min Slit Width (mm):</label>
              <input
                type="number"
                value={formRules.min_slit_width_mm || 355}
                onChange={(e) => setFormRules({ ...formRules, min_slit_width_mm: parseFloat(e.target.value) || 355 })}
                disabled={currentUser.role === 'VIEWER'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-400 disabled:bg-slate-50 disabled:opacity-70"
              />
              <span className="text-[10px] text-slate-400">PS hard physical limit: minimum allowable slit width (355 mm)</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900 text-slate-200 rounded-lg text-xs space-y-1.5 font-mono">
            <div className="text-emerald-400 font-bold font-sans">Primary Slitter Hard Constraints:</div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Total Deckle:</span>
              <span className="text-white font-bold">{formRules.deckle_width_mm ?? formRules.deckle_mm} mm</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Valid Trim Window:</span>
              <span className="text-emerald-300 font-bold">{formRules.min_trim_mm} – {formRules.max_trim_mm} mm</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Valid Slit Window:</span>
              <span className="text-white font-bold">{(formRules.deckle_width_mm ?? formRules.deckle_mm) - formRules.max_trim_mm} – {(formRules.deckle_width_mm ?? formRules.deckle_mm) - formRules.min_trim_mm} mm</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Active Arms / UPS:</span>
              <span className="text-white font-bold">{formRules.min_ups} to {formRules.max_ups} Arms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Min Slit Width:</span>
              <span className="text-amber-300 font-bold">{formRules.min_slit_width_mm || 355} mm</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
