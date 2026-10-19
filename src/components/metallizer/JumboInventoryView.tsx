import React, { useState } from 'react';
import { 
  Disc, 
  Plus, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Search, 
  Filter, 
  Trash2, 
  Edit3,
  AlertCircle,
  Check
} from 'lucide-react';
import { JumboRoll, JumboRollStatus, MetallizerMachineSettings } from '../../types/metallizer';
import { calculateJumboDiameter, calculateJumboWeight } from '../../services/metallizer/metallizerMasterData';
import { 
  saveStoredJumboRolls, 
  updateStoredJumboRoll, 
  deleteStoredJumboRoll, 
  deleteAllStoredJumboRolls 
} from '../../services/metallizer/metallizerStorage';

interface JumboInventoryViewProps {
  jumboRolls: JumboRoll[];
  settings: MetallizerMachineSettings;
  onJumboRollsUpdated: (rolls: JumboRoll[]) => void;
}

export const JumboInventoryView: React.FC<JumboInventoryViewProps> = ({
  jumboRolls,
  settings,
  onJumboRollsUpdated,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [editingRoll, setEditingRoll] = useState<JumboRoll | null>(null);
  const [rollToDelete, setRollToDelete] = useState<JumboRoll | null>(null);
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState<boolean>(false);

  // Single Roll Form State
  const [newRollId, setNewRollId] = useState(`JR-MZ18-${Date.now().toString().slice(-4)}`);
  const [newFilm, setNewFilm] = useState('MZ18');
  const [newWidth, setNewWidth] = useState<number>(3000);
  const [newLength, setNewLength] = useState<number>(39000);
  const [newThickness, setNewThickness] = useState<number>(18);
  const [newNotes, setNewNotes] = useState('');

  // Edit Roll Form State
  const [editRollId, setEditRollId] = useState('');
  const [editFilm, setEditFilm] = useState('MZ18');
  const [editWidth, setEditWidth] = useState<number>(3000);
  const [editLength, setEditLength] = useState<number>(39000);
  const [editRemainingLength, setEditRemainingLength] = useState<number>(39000);
  const [editThickness, setEditThickness] = useState<number>(18);
  const [editDensity, setEditDensity] = useState<number>(0.91);
  const [editCore, setEditCore] = useState('10" steel core');
  const [editStatus, setEditStatus] = useState<JumboRollStatus>('AVAILABLE');
  const [editNotes, setEditNotes] = useState('');
  const [editConsumedByPlan, setEditConsumedByPlan] = useState('');

  // Bulk Import text state
  const [importText, setImportText] = useState(`MZ18\t3000\t39000\t18\t10" steel
MZ18\t2450\t58500\t18\t10" steel
MZ18\t1950\t19500\t18\t10" steel
MZ18\t3050\t39000\t18\t10" steel
MZ18\t2700\t39000\t18\t10" steel
MZ20\t3200\t30000\t20\t10" steel
MZ10MB-15\t2800\t39000\t15\t10" steel
MZ18\t3600\t60000\t18\t10" steel`);

  const [importResults, setImportResults] = useState<{ accepted: JumboRoll[]; rejected: { line: string; reason: string }[] } | null>(null);

  // Live diameter calculation for single add modal
  const liveDiameter = calculateJumboDiameter(newThickness, newLength);
  const liveWeight = calculateJumboWeight(newWidth, newThickness, settings.density, newLength);
  const isLiveValidWidth = newWidth <= settings.max_jumbo_width_mm;
  const isLiveValidDiameter = liveDiameter <= settings.max_jumbo_diameter_mm;

  // Live diameter calculation for edit modal
  const editLiveDiameter = calculateJumboDiameter(editThickness, editLength);
  const editLiveTotalWeight = calculateJumboWeight(editWidth, editThickness, editDensity, editLength);
  const editLiveRemainingWeight = calculateJumboWeight(editWidth, editThickness, editDensity, editRemainingLength);
  const isEditValidWidth = editWidth <= settings.max_jumbo_width_mm;
  const isEditValidDiameter = editLiveDiameter <= settings.max_jumbo_diameter_mm;
  const isEditValidRemaining = editRemainingLength >= 0 && editRemainingLength <= editLength;

  const handleOpenEdit = (roll: JumboRoll) => {
    setEditingRoll(roll);
    setEditRollId(roll.roll_id);
    setEditFilm(roll.film);
    setEditWidth(roll.width_mm);
    setEditLength(roll.length_m);
    setEditRemainingLength(roll.remaining_length_m);
    setEditThickness(roll.thickness_micron);
    setEditDensity(roll.density || settings.density);
    setEditCore(roll.core || settings.core);
    setEditStatus(roll.status);
    setEditNotes(roll.notes || '');
    setEditConsumedByPlan(roll.consumed_by_plan || '');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoll) return;

    if (!isEditValidWidth) {
      alert(`Jumbo width ${editWidth} mm exceeds machine maximum ${settings.max_jumbo_width_mm} mm.`);
      return;
    }
    if (!isEditValidDiameter) {
      alert(`Calculated diameter ${editLiveDiameter} mm exceeds hard physical limit ${settings.max_jumbo_diameter_mm} mm.`);
      return;
    }
    if (!isEditValidRemaining) {
      alert(`Remaining length (${editRemainingLength} m) cannot exceed total original length (${editLength} m) or be negative.`);
      return;
    }

    // Determine consistent status based on remaining length if standard
    let derivedStatus = editStatus;
    if (editRemainingLength <= 0) {
      derivedStatus = 'CONSUMED';
    } else if (editRemainingLength < editLength) {
      derivedStatus = 'PARTIALLY_CONSUMED';
    } else if (editRemainingLength === editLength && derivedStatus === 'CONSUMED') {
      derivedStatus = 'AVAILABLE';
    }

    const updatedRoll: JumboRoll = {
      ...editingRoll,
      roll_id: editRollId.trim() || editingRoll.roll_id,
      film: editFilm.trim(),
      width_mm: Number(editWidth),
      length_m: Number(editLength),
      remaining_length_m: Number(editRemainingLength),
      thickness_micron: Number(editThickness),
      diameter_mm: editLiveDiameter,
      density: Number(editDensity),
      core: editCore,
      status: derivedStatus,
      remaining_quantity_kg: editLiveRemainingWeight,
      total_weight_kg: editLiveTotalWeight,
      notes: editNotes.trim(),
      consumed_by_plan: editConsumedByPlan.trim() ? editConsumedByPlan.trim() : undefined,
      updated_at: new Date().toISOString(),
    };

    // Update state and storage
    const updatedRollList = updateStoredJumboRoll(updatedRoll);
    onJumboRollsUpdated(updatedRollList);
    setEditingRoll(null);
  };

  const handleDeleteRoll = () => {
    if (!rollToDelete) return;
    const updatedRollList = deleteStoredJumboRoll(rollToDelete.id);
    onJumboRollsUpdated(updatedRollList);
    setRollToDelete(null);
  };

  const handleDeleteAllRolls = () => {
    const updatedRollList = deleteAllStoredJumboRolls();
    onJumboRollsUpdated(updatedRollList);
    setIsDeleteAllConfirmOpen(false);
  };

  const handleAddSingleRoll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLiveValidWidth) {
      alert(`Jumbo width ${newWidth} mm exceeds machine maximum ${settings.max_jumbo_width_mm} mm.`);
      return;
    }
    if (!isLiveValidDiameter) {
      alert(`Calculated diameter ${liveDiameter} mm exceeds hard physical limit ${settings.max_jumbo_diameter_mm} mm.`);
      return;
    }

    const roll: JumboRoll = {
      id: `jr-${Date.now()}`,
      roll_id: newRollId.trim() || `JR-${Date.now()}`,
      film: newFilm.trim(),
      width_mm: Number(newWidth),
      length_m: Number(newLength),
      thickness_micron: Number(newThickness),
      diameter_mm: liveDiameter,
      core: settings.core,
      density: settings.density,
      production_date: new Date().toISOString().slice(0, 10),
      status: 'AVAILABLE',
      remaining_length_m: Number(newLength),
      remaining_quantity_kg: liveWeight,
      total_weight_kg: liveWeight,
      notes: newNotes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updated = [roll, ...jumboRolls];
    onJumboRollsUpdated(updated);
    saveStoredJumboRolls(updated);
    setIsAddModalOpen(false);
  };

  const handleProcessImport = () => {
    const lines = importText.split('\n').filter(l => l.trim().length > 0);
    const accepted: JumboRoll[] = [];
    const rejected: { line: string; reason: string }[] = [];

    lines.forEach((line, idx) => {
      const parts = line.split(/[\t,;|]+|\s{2,}/).map(p => p.trim()).filter(Boolean);
      if (parts.length < 4) {
        rejected.push({ line, reason: 'Expected format: FilmGrade | Width | Length | Thickness | Core' });
        return;
      }

      const film = parts[0];
      const width = parseFloat(parts[1]);
      const length = parseFloat(parts[2]);
      const thickness = parseFloat(parts[3]);
      const core = parts[4] || settings.core;

      if (isNaN(width) || isNaN(length) || isNaN(thickness)) {
        rejected.push({ line, reason: 'Invalid numeric values for Width, Length, or Thickness.' });
        return;
      }

      if (width > settings.max_jumbo_width_mm) {
        rejected.push({ line, reason: `Width ${width}mm exceeds max machine limit ${settings.max_jumbo_width_mm}mm.` });
        return;
      }

      const diameter = calculateJumboDiameter(thickness, length);
      if (diameter > settings.max_jumbo_diameter_mm) {
        rejected.push({ line, reason: `Calculated diameter ${diameter.toFixed(1)}mm exceeds hard limit ${settings.max_jumbo_diameter_mm}mm.` });
        return;
      }

      const weight = calculateJumboWeight(width, thickness, settings.density, length);

      const roll: JumboRoll = {
        id: `jr-imp-${Date.now()}-${idx}`,
        roll_id: `JR-${film}-${width}-${String(idx + 1).padStart(2, '0')}`,
        film,
        width_mm: width,
        length_m: length,
        thickness_micron: thickness,
        diameter_mm: diameter,
        core: core,
        density: settings.density,
        production_date: new Date().toISOString().slice(0, 10),
        status: 'AVAILABLE',
        remaining_length_m: length,
        remaining_quantity_kg: weight,
        total_weight_kg: weight,
        notes: `Imported batch on ${new Date().toLocaleDateString()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      accepted.push(roll);
    });

    setImportResults({ accepted, rejected });

    if (accepted.length > 0) {
      const updated = [...accepted, ...jumboRolls];
      onJumboRollsUpdated(updated);
      saveStoredJumboRolls(updated);
    }
  };

  const filteredRolls = jumboRolls.filter(r => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.roll_id.toLowerCase().includes(q) ||
        r.film.toLowerCase().includes(q) ||
        r.width_mm.toString().includes(q) ||
        (r.consumed_by_plan && r.consumed_by_plan.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const availableCount = jumboRolls.filter(r => r.status === 'AVAILABLE').length;
  const partialCount = jumboRolls.filter(r => r.status === 'PARTIALLY_CONSUMED').length;
  const consumedCount = jumboRolls.filter(r => r.status === 'CONSUMED').length;
  const totalStockKg = jumboRolls.reduce((sum, r) => sum + r.remaining_quantity_kg, 0);

  return (
    <div className="space-y-6" id="msl-inventory-view">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              PHYSICAL INVENTORY
            </span>
            <span className="text-xs text-slate-500 font-mono">10" Steel Core · Tracked Physical Assets</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Jumbo Roll Consumable Inventory</h1>
          <p className="text-xs text-slate-500">
            Physical mother jumbo rolls available for Metallizer Slitter planning, manual adjustments, and consumption tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {jumboRolls.length > 0 && (
            <button
              id="msl-delete-all-inventory-btn"
              onClick={() => setIsDeleteAllConfirmOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer border border-rose-200"
              title="Delete all jumbo rolls from inventory"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Delete All Rolls</span>
            </button>
          )}

          <button
            id="msl-import-rolls-btn"
            onClick={() => {
              setImportResults(null);
              setIsImportModalOpen(true);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer border border-slate-200"
          >
            <UploadCloud className="w-4 h-4 text-purple-600" />
            <span>Upload / Import Rolls</span>
          </button>

          <button
            id="msl-add-roll-btn"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Single Jumbo Roll</span>
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" id="msl-inventory-kpis">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Rolls</span>
          <div className="text-2xl font-black text-slate-900 font-mono mt-1">
            {jumboRolls.length} <span className="text-xs font-normal text-slate-500 font-sans">Units</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Available Rolls</span>
          <div className="text-2xl font-black text-emerald-700 font-mono mt-1">
            {availableCount + partialCount} <span className="text-xs font-normal text-slate-500 font-sans">Ready</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Consumed Rolls</span>
          <div className="text-2xl font-black text-slate-600 font-mono mt-1">
            {consumedCount} <span className="text-xs font-normal text-slate-500 font-sans">Used</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Available Weight</span>
          <div className="text-2xl font-black text-purple-700 font-mono mt-1">
            {totalStockKg.toLocaleString()} <span className="text-xs font-normal text-slate-500 font-sans">KG</span>
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Roll ID, grade, width, plan..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto">
          <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center">
            <Filter className="w-3.5 h-3.5 mr-1" /> Status:
          </span>
          {['ALL', 'AVAILABLE', 'PARTIALLY_CONSUMED', 'CONSUMED'].map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Jumbo Rolls Inventory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3 px-3">Roll ID</th>
                <th className="py-3 px-3">Film Grade</th>
                <th className="py-3 px-3 text-right">Width (mm)</th>
                <th className="py-3 px-3 text-right">Length (m)</th>
                <th className="py-3 px-3 text-right">Thickness</th>
                <th className="py-3 px-3 text-right">Diameter</th>
                <th className="py-3 px-3">Core</th>
                <th className="py-3 px-3 text-right">Remaining Stock</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3">Consumed By Plan</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRolls.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    No jumbo rolls found in inventory.
                  </td>
                </tr>
              ) : (
                filteredRolls.map(roll => (
                  <tr key={roll.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                      {roll.roll_id}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 font-bold rounded bg-purple-50 text-purple-700 border border-purple-200">
                        {roll.film}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {roll.width_mm} mm
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {roll.remaining_length_m.toLocaleString()} / {roll.length_m.toLocaleString()} m
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {roll.thickness_micron} µm
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-700">
                      {roll.diameter_mm} mm
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">
                      {roll.core}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {roll.remaining_quantity_kg.toLocaleString()} kg
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                        roll.status === 'AVAILABLE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : roll.status === 'PARTIALLY_CONSUMED'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 text-slate-700 line-through'
                      }`}>
                        {roll.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {roll.consumed_by_plan ? (
                        <span className="text-purple-700 font-bold">{roll.consumed_by_plan}</span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => handleOpenEdit(roll)}
                          className="p-1.5 text-slate-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-purple-200"
                          title={`Edit Jumbo Roll ${roll.roll_id}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setRollToDelete(roll)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-rose-200"
                          title={`Delete Jumbo Roll ${roll.roll_id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Edit Jumbo Roll */}
      {editingRoll && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-xl animate-in fade-in zoom-in duration-150 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Edit3 className="w-5 h-5 text-purple-600" />
                <div>
                  <h3 className="font-bold text-base text-slate-900">Edit Jumbo Roll Record</h3>
                  <span className="text-xs font-mono text-slate-500">{editingRoll.roll_id}</span>
                </div>
              </div>
              <button
                onClick={() => setEditingRoll(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Roll Identifier</label>
                  <input
                    type="text"
                    required
                    value={editRollId}
                    onChange={(e) => setEditRollId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Film Grade</label>
                  <input
                    type="text"
                    required
                    value={editFilm}
                    onChange={(e) => setEditFilm(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-semibold text-purple-800 focus:ring-2 focus:ring-purple-500"
                    placeholder="e.g. MZ18, MZ20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Width (mm)</label>
                  <input
                    type="number"
                    required
                    min={500}
                    max={settings.max_jumbo_width_mm}
                    value={editWidth}
                    onChange={(e) => setEditWidth(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-[10px] text-slate-400">Max: {settings.max_jumbo_width_mm}mm</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Total Length (m)</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    step={100}
                    value={editLength}
                    onChange={(e) => {
                      const l = Number(e.target.value);
                      setEditLength(l);
                      // If remaining was equal to total, keep them in sync
                      if (editRemainingLength === editLength) {
                        setEditRemainingLength(l);
                      }
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Remaining (m)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    max={editLength}
                    step={100}
                    value={editRemainingLength}
                    onChange={(e) => setEditRemainingLength(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-purple-700 focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-[10px] text-slate-400">≤ {editLength}m</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Thickness (µm)</label>
                  <input
                    type="number"
                    required
                    min={10}
                    max={100}
                    value={editThickness}
                    onChange={(e) => setEditThickness(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono text-slate-900 focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Core Specification</label>
                  <input
                    type="text"
                    value={editCore}
                    onChange={(e) => setEditCore(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-700 focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Status Override</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800 focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="PARTIALLY_CONSUMED">PARTIALLY_CONSUMED</option>
                    <option value="CONSUMED">CONSUMED</option>
                  </select>
                </div>
              </div>

              {/* Live Physical Recalculation Card */}
              <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                isEditValidDiameter && isEditValidWidth && isEditValidRemaining
                  ? 'bg-purple-50/80 border-purple-200 text-purple-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span>Recalculated Diameter:</span>
                  <span className="font-mono text-sm">{editLiveDiameter} mm</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span>Formula: 1.14 × √({editThickness} × {editLength.toLocaleString()})</span>
                  <span>Max Limit: {settings.max_jumbo_diameter_mm} mm</span>
                </div>
                <div className="flex items-center justify-between font-bold pt-1 border-t border-purple-200/60">
                  <span>Remaining Available Weight:</span>
                  <span className="font-mono text-sm text-purple-800 font-black">{editLiveRemainingWeight.toLocaleString()} kg</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>Original Total Weight:</span>
                  <span className="font-mono">{editLiveTotalWeight.toLocaleString()} kg</span>
                </div>

                {!isEditValidDiameter && (
                  <div className="text-rose-700 font-bold flex items-center pt-1 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
                    Diameter exceeds machine limit 1250 mm!
                  </div>
                )}
                {!isEditValidRemaining && (
                  <div className="text-rose-700 font-bold flex items-center pt-1 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
                    Remaining length cannot be greater than original total length.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Consumed By Plan ID</label>
                  <input
                    type="text"
                    value={editConsumedByPlan}
                    onChange={(e) => setEditConsumedByPlan(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono text-purple-700 focus:ring-2 focus:ring-purple-500"
                    placeholder="e.g. MSL-PLAN-..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Origin</label>
                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    placeholder="e.g. Line 1 Prime roll"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingRoll(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isEditValidDiameter || !isEditValidWidth || !isEditValidRemaining}
                  className="px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg shadow-xs cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Single Roll Confirmation */}
      {rollToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center space-x-3 text-rose-600 pb-3 border-b border-slate-100">
              <div className="p-2 bg-rose-100 rounded-xl">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete Jumbo Roll?</h3>
                <p className="text-xs text-slate-500 font-mono">{rollToDelete.roll_id}</p>
              </div>
            </div>

            <div className="my-4 space-y-3 text-xs text-slate-600">
              <p>
                Are you sure you want to delete jumbo roll <strong className="text-slate-900 font-mono">{rollToDelete.roll_id}</strong> ({rollToDelete.film}, {rollToDelete.width_mm}mm, {rollToDelete.remaining_length_m.toLocaleString()}m remaining)?
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Grade & Width:</span>
                  <span className="font-bold text-slate-800">{rollToDelete.film} · {rollToDelete.width_mm} mm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Stock Weight:</span>
                  <span className="font-bold text-purple-700">{rollToDelete.remaining_quantity_kg.toLocaleString()} KG</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Status:</span>
                  <span className="font-bold text-slate-800">{rollToDelete.status}</span>
                </div>
                {rollToDelete.consumed_by_plan && (
                  <div className="flex justify-between text-amber-700">
                    <span className="font-sans">Allocated In:</span>
                    <span className="font-bold">{rollToDelete.consumed_by_plan}</span>
                  </div>
                )}
              </div>

              <p className="text-rose-600 text-[11px] font-semibold">
                This will remove the roll permanently from the inventory database and recalculate available stock.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRollToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteRoll}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-xs cursor-pointer flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Roll</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete ALL Jumbo Rolls Confirmation */}
      {isDeleteAllConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center space-x-3 text-rose-600 pb-3 border-b border-slate-100">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete Entire Inventory?</h3>
                <p className="text-xs text-rose-600 font-semibold">Dangerous Operation · Confirmation Required</p>
              </div>
            </div>

            <div className="my-4 space-y-3 text-xs text-slate-600">
              <p>
                You are about to permanently delete all <strong className="text-slate-900 font-bold">{jumboRolls.length} jumbo rolls</strong> totaling <strong className="text-purple-700 font-bold">{totalStockKg.toLocaleString()} KG</strong> from the consumable inventory database.
              </p>

              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-900 space-y-1 text-xs">
                <div className="font-bold flex items-center">
                  <AlertCircle className="w-4 h-4 mr-1.5 text-rose-600 shrink-0" />
                  Warning: Action cannot be undone
                </div>
                <p className="text-[11px] text-rose-800">
                  All mother rolls, remaining length allocations, and stock KPIs will be wiped clean. You will need to add or re-import rolls to plan slitting runs.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsDeleteAllConfirmOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAllRolls}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-xs cursor-pointer flex items-center space-x-1.5 font-bold"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Yes, Delete All {jumboRolls.length} Rolls</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Single Jumbo Roll */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Disc className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-base text-slate-900">Register New Jumbo Roll</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSingleRoll} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Roll Identifier</label>
                  <input
                    type="text"
                    required
                    value={newRollId}
                    onChange={(e) => setNewRollId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-purple-500"
                    placeholder="e.g. JR-MZ18-3000-01"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Film Grade</label>
                  <select
                    value={newFilm}
                    onChange={(e) => setNewFilm(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-semibold text-purple-800 focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="MZ18">MZ18 (Metallized 18µm)</option>
                    <option value="MZ20">MZ20 (Metallized 20µm)</option>
                    <option value="MZ10MB-15">MZ10MB-15 (Metallized 15µm)</option>
                    <option value="MZ10S-20">MZ10S-20 (Specialty Metallized 20µm)</option>
                    <option value="MZ-PRIME-12">MZ-PRIME-12 (Metallized 12µm)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Width (mm)</label>
                  <input
                    type="number"
                    required
                    min={500}
                    max={settings.max_jumbo_width_mm}
                    value={newWidth}
                    onChange={(e) => setNewWidth(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-[10px] text-slate-400">Max: {settings.max_jumbo_width_mm}mm</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Length (m)</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    step={500}
                    value={newLength}
                    onChange={(e) => setNewLength(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-[10px] text-slate-400">e.g. 19500, 39000</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Thickness (µm)</label>
                  <input
                    type="number"
                    required
                    min={10}
                    max={100}
                    value={newThickness}
                    onChange={(e) => setNewThickness(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-[10px] text-slate-400">In microns (18, 20)</span>
                </div>
              </div>

              {/* Live Physical Validation Card */}
              <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                isLiveValidDiameter && isLiveValidWidth
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span>Calculated Physical Diameter:</span>
                  <span className="font-mono text-sm">{liveDiameter} mm</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span>Formula: 1.14 × √({newThickness} × {newLength.toLocaleString()})</span>
                  <span>Max Allowable: {settings.max_jumbo_diameter_mm} mm</span>
                </div>
                <div className="flex items-center justify-between font-bold pt-1 border-t border-current/10">
                  <span>Calculated Roll Weight:</span>
                  <span className="font-mono text-sm">{liveWeight.toLocaleString()} kg</span>
                </div>

                {!isLiveValidDiameter && (
                  <div className="text-rose-700 font-bold flex items-center pt-1 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
                    Diameter exceeds hard physical limit 1250 mm! Must be rejected.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Origin</label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g. Received from Line 1 Primary Slitter"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isLiveValidDiameter || !isLiveValidWidth}
                  className="px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  Accept & Add Roll
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Upload / Import Jumbo Rolls */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 shadow-xl animate-in fade-in zoom-in duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <UploadCloud className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-base text-slate-900">Bulk Jumbo Roll Import & Validation</h3>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 my-4 overflow-y-auto pr-1 flex-1">
              <p className="text-xs text-slate-500">
                Paste tab-separated or comma-separated rows. Required columns: <b className="text-slate-800">Film Grade, Width (mm), Length (m), Thickness (µm), Core</b>.
                The system will automatically calculate diameter and reject rolls exceeding 1250 mm diameter or 3650 mm width.
              </p>

              <div>
                <textarea
                  rows={8}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  placeholder="MZ18	3000	39000	18	10"
                />
              </div>

              {importResults && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center space-x-4 text-xs font-bold">
                    <span className="text-emerald-700 flex items-center">
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Accepted: {importResults.accepted.length} rolls
                    </span>
                    <span className="text-rose-700 flex items-center">
                      <AlertTriangle className="w-4 h-4 mr-1" />
                      Rejected: {importResults.rejected.length} rolls
                    </span>
                  </div>

                  {importResults.rejected.length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs space-y-1.5">
                      <h4 className="font-bold text-rose-900">Rejected Rows Reason Breakdown:</h4>
                      <ul className="space-y-1 text-rose-800">
                        {importResults.rejected.map((r, rIdx) => (
                          <li key={rIdx} className="font-mono text-[11px]">
                            • <span className="font-semibold text-rose-950">"{r.line}"</span> → {r.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 mt-auto">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleProcessImport}
                className="px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg shadow-xs cursor-pointer flex items-center space-x-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Validate & Import Rolls</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
