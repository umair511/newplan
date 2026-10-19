import React, { useState, useEffect } from 'react';
import { 
  Sliders, 
  RotateCcw, 
  CheckCircle2, 
  ShieldAlert, 
  Disc, 
  Info,
  Save
} from 'lucide-react';
import { MetallizerMachineSettings } from '../../types/metallizer';
import { DEFAULT_METALLIZER_SETTINGS } from '../../services/metallizer/metallizerMasterData';
import { saveStoredMetallizerSettings } from '../../services/metallizer/metallizerStorage';

interface MetallizerSettingsViewProps {
  settings: MetallizerMachineSettings;
  onSettingsSaved: (settings: MetallizerMachineSettings) => void;
}

export const MetallizerSettingsView: React.FC<MetallizerSettingsViewProps> = ({
  settings,
  onSettingsSaved,
}) => {
  const [formData, setFormData] = useState<MetallizerMachineSettings>({ ...settings });
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setFormData({ ...settings });
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const toSave: MetallizerMachineSettings = {
      ...formData,
      updated_at: new Date().toISOString(),
    };
    saveStoredMetallizerSettings(toSave);
    onSettingsSaved(toSave);
    setFormData(toSave);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleResetDefaults = () => {
    if (window.confirm('Reset Metallizer Slitter settings to factory default specifications?')) {
      setFormData(DEFAULT_METALLIZER_SETTINGS);
      saveStoredMetallizerSettings(DEFAULT_METALLIZER_SETTINGS);
      onSettingsSaved(DEFAULT_METALLIZER_SETTINGS);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    }
  };

  return (
    <div className="space-y-6" id="msl-settings-view">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              MACHINE SPECIFICATIONS
            </span>
            <span className="text-xs text-slate-500 font-mono">Section 9 Configuration</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Metallizer Slitter Parameters</h1>
          <p className="text-xs text-slate-500">
            Configure machine limits, trim targets, diameter constant, and slitting policy
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 flex items-center space-x-2 animate-in fade-in duration-150">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Metallizer Slitter configuration successfully saved and updated!</span>
        </div>
      )}

      {/* Settings Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Machine Identification & Limits */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
            1. Core Machine Identification & Envelope Limits
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Machine Name / ID</label>
              <input
                type="text"
                disabled
                value={formData.machine_name}
                className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-mono text-slate-600 font-bold"
              />
              <span className="text-[10px] text-slate-400">Fixed industrial asset code</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Max Jumbo Width (mm)</label>
              <input
                type="number"
                value={formData.max_jumbo_width_mm}
                onChange={(e) => setFormData({ ...formData, max_jumbo_width_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Default: 3650 mm (Section 9.2)</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Max Jumbo Diameter (mm)</label>
              <input
                type="number"
                value={formData.max_jumbo_diameter_mm}
                onChange={(e) => setFormData({ ...formData, max_jumbo_diameter_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-purple-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Hard limit: 1250 mm (Section 9.7)</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Core Specification</label>
              <input
                type="text"
                disabled
                value={formData.core}
                className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-slate-600"
              />
              <span className="text-[10px] text-slate-400">Fixed 10-inch steel core</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Density (g/cm³)</label>
              <input
                type="text"
                disabled
                value="Film Specs Master DB"
                className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-slate-600"
              />
              <span className="text-[10px] text-slate-400">Not manual — density is loaded from Film Specs Master DB per film at plan time</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Diameter Constant (k)</label>
              <input
                type="number"
                step="0.01"
                value={formData.diameter_constant}
                onChange={(e) => setFormData({ ...formData, diameter_constant: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Formula: D = k × √(T × L)</span>
            </div>
          </div>
        </div>

        {/* Slitting Knives & Trim Optimization Policy */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
            2. Slitting Knives & Trim Policy
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">PS01 Mother Deckle (mm)</label>
              <input
                type="number"
                min={1000}
                max={20000}
                step={1}
                value={formData.ps01_deckle_width_mm ?? 10400}
                onChange={(e) => setFormData({ ...formData, ps01_deckle_width_mm: Number(e.target.value) || 10400 })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 mb-3 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400 block mb-3">Custom deckle (mm). Engine uses this saved value.</span>
              <label className="block font-semibold text-slate-700 mb-1">Preferred UPS</label>
              <input
                type="number"
                min={1}
                max={4}
                value={formData.preferred_ups}
                onChange={(e) => setFormData({ ...formData, preferred_ups: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Primary target: 3 UPS</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Allow 4 UPS</label>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, allow_4_ups: !formData.allow_4_ups })}
                className={`w-full px-3 py-1.5 rounded-lg font-bold text-xs border transition-colors ${
                  formData.allow_4_ups
                    ? 'bg-amber-50 border-amber-400 text-amber-800'
                    : 'bg-slate-50 border-slate-300 text-slate-600'
                }`}
              >
                {formData.allow_4_ups ? 'ON — 4-UPS fallback enabled' : 'OFF — 3-UPS only (default)'}
              </button>
              <span className="text-[10px] text-slate-400">Default off: all MSL demand on 3-UPS mothers</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Max Planning UPS</label>
              <input
                type="number"
                min={1}
                max={6}
                value={formData.max_planning_ups}
                onChange={(e) => setFormData({ ...formData, max_planning_ups: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Total 6 UPS (Arms 1-3 Side A, Arms 4-6 Side B)</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Min Target Trim (mm)</label>
              <input
                type="number"
                value={formData.min_trim_mm}
                onChange={(e) => setFormData({ ...formData, min_trim_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">SRS target min: 20 mm</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Max Target Trim (mm)</label>
              <input
                type="number"
                value={formData.max_trim_mm}
                onChange={(e) => setFormData({ ...formData, max_trim_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">SRS target max: 30 mm</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Min Slit Width (mm)</label>
              <input
                type="number"
                value={formData.min_slit_width_mm}
                onChange={(e) => setFormData({ ...formData, min_slit_width_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Default: 300 mm</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Max Slit Width (mm)</label>
              <input
                type="number"
                value={formData.max_slit_width_mm}
                onChange={(e) => setFormData({ ...formData, max_slit_width_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Default: 2000 mm</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Absolute Max Trim Limit (mm)</label>
              <input
                type="number"
                value={formData.hard_max_trim_mm}
                onChange={(e) => setFormData({ ...formData, hard_max_trim_mm: Number(e.target.value) })}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-300/50"
              />
              <span className="text-[10px] text-slate-400">Default: 50 mm</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="flex items-center space-x-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
};
