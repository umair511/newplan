import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Database, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  UploadCloud, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Check, 
  RotateCcw, 
  FileText, 
  AlertCircle,
  HelpCircle,
  Clipboard,
  Filter,
  ArrowUpDown,
  Info
} from 'lucide-react';
import { FilmDensityMaster } from '../../types/stuffing';
import {
  getFilmSpecsDatabase,
  addFilmSpec,
  updateFilmSpec,
  deleteFilmSpec,
  resetFilmSpecsToDefault,
  parseFilmSpecsTabular,
  parseFilmSpecsExcel,
  exportFilmSpecsToExcel,
  downloadFilmSpecsTemplate,
  FilmSpecsImportResult,
  ParsedFilmSpecRow
} from '../../services/stuffing/filmDensities';

interface FilmSpecsManagerProps {
  onSpecsChanged?: () => void;
  prefillFilmCode?: string;
  onClose?: () => void;
}

export const FilmSpecsManager: React.FC<FilmSpecsManagerProps> = ({
  onSpecsChanged,
  prefillFilmCode,
  onClose
}) => {
  // Master DB state
  const [specsList, setSpecsList] = useState<FilmDensityMaster[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<'code' | 'thickness' | 'density' | 'summary_code'>('code');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Manual Add / Edit Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [editingSpec, setEditingSpec] = useState<FilmDensityMaster | null>(null);
  const [formCode, setFormCode] = useState<string>('');
  const [formThickness, setFormThickness] = useState<string>('');
  const [formDensity, setFormDensity] = useState<string>('');
  const [formSummaryCode, setFormSummaryCode] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  // Bulk Import / Paste Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [pasteText, setPasteText] = useState<string>('');
  const [importResult, setImportResult] = useState<FilmSpecsImportResult | null>(null);
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<'paste' | 'file'>('paste');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Success banner
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Load database
  const loadDatabase = () => {
    const list = getFilmSpecsDatabase();
    setSpecsList(list);
  };

  useEffect(() => {
    loadDatabase();
  }, []);

  // Handle prefilled film code if opened from an "Unknown film code" link
  useEffect(() => {
    if (prefillFilmCode) {
      setFormCode(prefillFilmCode.toUpperCase().trim());
      setFormThickness('');
      setFormDensity('0.91');
      setFormSummaryCode(prefillFilmCode.toUpperCase().trim());
      setEditingSpec(null);
      setFormError('');
      setIsAddModalOpen(true);
    }
  }, [prefillFilmCode]);

  const notifyChange = (msg: string) => {
    loadDatabase();
    if (onSpecsChanged) {
      onSpecsChanged();
    }
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage('');
    }, 4000);
  };

  // Filtered and sorted specs
  const filteredSpecs = useMemo(() => {
    let result = [...specsList];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.code.toLowerCase().includes(q) ||
          s.summary_code.toLowerCase().includes(q) ||
          String(s.thickness).includes(q) ||
          String(s.density).includes(q)
      );
    }

    result.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [specsList, searchQuery, sortField, sortDirection]);

  const handleSort = (field: 'code' | 'thickness' | 'density' | 'summary_code') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Open Add Modal
  const openAddModal = () => {
    setEditingSpec(null);
    setFormCode('');
    setFormThickness('');
    setFormDensity('0.91');
    setFormSummaryCode('');
    setFormError('');
    setIsAddModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (spec: FilmDensityMaster) => {
    setEditingSpec(spec);
    setFormCode(spec.code);
    setFormThickness(String(spec.thickness));
    setFormDensity(String(spec.density));
    setFormSummaryCode(spec.summary_code);
    setFormError('');
    setIsAddModalOpen(true);
  };

  // Save manual Add or Edit
  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanCode = formCode.trim().toUpperCase();
    const cleanSummary = formSummaryCode.trim().toUpperCase() || cleanCode;
    const thickness = parseFloat(formThickness);
    const density = parseFloat(formDensity);

    if (!cleanCode) {
      setFormError('Film Code is required.');
      return;
    }
    if (isNaN(thickness) || thickness <= 0) {
      setFormError('Thickness must be a positive number (micron).');
      return;
    }
    if (isNaN(density) || density <= 0) {
      setFormError('Density must be a positive number (e.g. 0.91 or 1.40).');
      return;
    }

    if (editingSpec) {
      // Update
      const res = updateFilmSpec(editingSpec.code, {
        code: cleanCode,
        thickness,
        density,
        summary_code: cleanSummary,
      });
      if (!res.success) {
        setFormError(res.error || 'Failed to update film specification.');
        return;
      }
      setIsAddModalOpen(false);
      notifyChange(`Film spec "${cleanCode}" updated successfully.`);
    } else {
      // Add new
      const res = addFilmSpec({
        code: cleanCode,
        thickness,
        density,
        summary_code: cleanSummary,
      });
      if (!res.success) {
        setFormError(res.error || 'Failed to add film specification.');
        return;
      }
      setIsAddModalOpen(false);
      notifyChange(`Film spec "${cleanCode}" added successfully.`);
    }
  };

  // Delete Spec
  const handleDelete = (code: string) => {
    if (window.confirm(`Are you sure you want to delete film spec "${code}"?`)) {
      const res = deleteFilmSpec(code);
      if (res.success) {
        notifyChange(`Film spec "${code}" deleted.`);
      } else {
        alert(res.error || 'Failed to delete film spec.');
      }
    }
  };

  // Reset to default
  const handleResetToDefault = () => {
    if (
      window.confirm(
        'Are you sure you want to reset the Film Specs Master Database to factory baseline specifications? Any custom film codes will be replaced.'
      )
    ) {
      resetFilmSpecsToDefault();
      notifyChange('Film Specs Master Database reset to baseline specifications.');
    }
  };

  // Handle Tabular Paste Parsing
  const handleParsePaste = () => {
    if (!pasteText.trim()) {
      alert('Please paste tabular data before validating.');
      return;
    }
    const result = parseFilmSpecsTabular(pasteText);
    setImportResult(result);
  };

  // Handle File Upload Parsing
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    try {
      const result = await parseFilmSpecsExcel(file);
      setImportResult(result);
    } catch (err: any) {
      alert('Error reading Excel file: ' + (err.message || String(err)));
    }
  };

  // Save Bulk Import
  const handleSaveImport = () => {
    if (!importResult || importResult.rows.length === 0) return;

    const currentDb = getFilmSpecsDatabase();
    const dbMap = new Map<string, FilmDensityMaster>();
    currentDb.forEach(s => dbMap.set(s.code.toUpperCase(), s));

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    importResult.rows.forEach(row => {
      if (!row.isValid) return; // Skip invalid rows

      const codeKey = row.code.toUpperCase();
      const exists = dbMap.has(codeKey);

      if (exists) {
        if (overwriteExisting) {
          dbMap.set(codeKey, {
            code: row.code,
            thickness: row.thickness,
            density: row.density,
            summary_code: row.summary_code || row.code
          });
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        dbMap.set(codeKey, {
          code: row.code,
          thickness: row.thickness,
          density: row.density,
          summary_code: row.summary_code || row.code
        });
        addedCount++;
      }
    });

    const updatedList = Array.from(dbMap.values());
    localStorage.setItem('acsoe_film_specs_master_db_v1', JSON.stringify(updatedList));

    setIsImportModalOpen(false);
    setPasteText('');
    setImportResult(null);
    setSelectedFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';

    notifyChange(
      `Import complete: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped.`
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-blue-800 dark:text-blue-400">
              <Database className="w-6 h-6" />
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Film Specs Master Database</h2>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 font-medium mt-1 max-w-2xl">
              Central single source of truth for film thickness (&mu;m), density (g/cm&sup3;), and summary codes.
              When an order uses a film code, specs are looked up strictly from this database.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={downloadFilmSpecsTemplate}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-bold transition cursor-pointer"
              title="Download Excel Template"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>Download Template</span>
            </button>

            <button
              onClick={() => exportFilmSpecsToExcel()}
              className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded text-xs font-bold transition cursor-pointer"
              title="Export all film specs to Excel"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>

            <button
              onClick={() => {
                setPasteText('');
                setImportResult(null);
                setSelectedFileName('');
                setIsImportModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-900 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 rounded text-xs font-bold transition cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Import / Paste Bulk</span>
            </button>

            <button
              onClick={openAddModal}
              className="flex items-center space-x-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded text-xs font-bold transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Film Spec</span>
            </button>
          </div>
        </div>

        {/* Success Alert Banner */}
        {successMessage && (
          <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 rounded text-xs text-emerald-900 dark:text-emerald-200 font-semibold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage('')} className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Database View & Search */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search Film Code or Summary..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded focus:ring-1 focus:ring-blue-600 focus:border-blue-600 font-mono font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-4 text-xs text-slate-700 dark:text-slate-300">
            <span className="font-semibold font-mono">
              Total: <strong className="text-slate-950 dark:text-white">{specsList.length}</strong> specs (Showing {filteredSpecs.length})
            </span>
            <button
              onClick={handleResetToDefault}
              className="text-xs text-rose-700 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-300 font-bold flex items-center space-x-1 underline cursor-pointer"
              title="Reset all specs to baseline default"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset to Defaults</span>
            </button>
          </div>
        </div>

        {/* Master Table */}
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 uppercase font-bold sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 select-none">
              <tr>
                <th className="py-2.5 px-4 w-12 text-center text-slate-600 dark:text-slate-400">#</th>
                <th 
                  className="py-2.5 px-4 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700"
                  onClick={() => handleSort('code')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Film Code</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                  </div>
                </th>
                <th 
                  className="py-2.5 px-4 text-right cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700"
                  onClick={() => handleSort('thickness')}
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Thickness (&mu;m)</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                  </div>
                </th>
                <th 
                  className="py-2.5 px-4 text-right cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700"
                  onClick={() => handleSort('density')}
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Density (g/cm&sup3;)</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                  </div>
                </th>
                <th 
                  className="py-2.5 px-4 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700"
                  onClick={() => handleSort('summary_code')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Code for Summary</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 font-mono">
              {filteredSpecs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-600 dark:text-slate-400">
                    <p className="text-sm font-bold">No film specifications found</p>
                    {searchQuery && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Try clearing search query or click &ldquo;Add Film Spec&rdquo; to create it.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                filteredSpecs.map((spec, idx) => (
                  <tr key={spec.code} className="hover:bg-blue-50/50 dark:hover:bg-slate-800/60 transition-colors">
                    <td className="py-2 px-4 text-center text-slate-600 dark:text-slate-400 font-bold text-[11px]">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 dark:text-slate-100 text-xs">
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">
                        {spec.code}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                      {spec.thickness} &mu;m
                    </td>
                    <td className="py-2 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                      {spec.density.toFixed(2)}
                    </td>
                    <td className="py-2 px-4 text-slate-900 dark:text-slate-200 font-bold">
                      {spec.summary_code}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => openEditModal(spec)}
                          className="p-1.5 text-slate-600 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                          title="Edit spec"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(spec.code)}
                          className="p-1.5 text-slate-500 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 rounded transition cursor-pointer"
                          title="Delete spec"
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

        {/* Table Footer Specs Summary */}
        <div className="p-3 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between text-[11px] text-slate-700 dark:text-slate-300 font-medium">
          <div>
            <span>Format required: <strong className="text-slate-900 dark:text-slate-100">Film Code | Thickness | Density | Code for Summary</strong></span>
          </div>
          <div>
            <span className="font-semibold text-slate-800 dark:text-slate-200">4 Master Fields Strictly Enforced</span>
          </div>
        </div>
      </div>

      {/* Modal: Manual Add / Edit */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xl max-w-md w-full overflow-hidden transition-colors">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center space-x-2 text-slate-900 dark:text-white font-bold">
                <Database className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                <span>{editingSpec ? `Edit Film Spec: ${editingSpec.code}` : 'Add New Film Spec'}</span>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-700 rounded text-xs text-rose-900 dark:text-rose-200 font-semibold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-900 dark:text-slate-200 mb-1 uppercase tracking-wider">
                  Film Code <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={!!editingSpec}
                  placeholder="e.g. TH21-30 or PTN01-12"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded focus:ring-1 focus:ring-blue-600 focus:border-blue-600 uppercase disabled:bg-slate-100 dark:disabled:bg-slate-800/80 disabled:text-slate-700 dark:disabled:text-slate-400"
                />
                <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium mt-0.5 block">
                  Unique identifier used in orders (e.g. TH21-30, CMB21S-20).
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-slate-200 mb-1 uppercase tracking-wider">
                    Thickness (&mu;m) <span className="text-rose-600 dark:text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    required
                    placeholder="e.g. 30"
                    value={formThickness}
                    onChange={(e) => setFormThickness(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
                  />
                  <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium mt-0.5 block">
                    Film gauge in microns (e.g. 20, 30).
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-slate-200 mb-1 uppercase tracking-wider">
                    Density (g/cm&sup3;) <span className="text-rose-600 dark:text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="3.0"
                    required
                    placeholder="e.g. 0.91"
                    value={formDensity}
                    onChange={(e) => setFormDensity(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
                  />
                  <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium mt-0.5 block">
                    0.91 (BOPP), 1.40 (PET), 0.70 (Pearl).
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 dark:text-slate-200 mb-1 uppercase tracking-wider">
                  Code for Summary <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. TH30 or PTN01-12"
                  value={formSummaryCode}
                  onChange={(e) => setFormSummaryCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded focus:ring-1 focus:ring-blue-600 focus:border-blue-600 uppercase"
                />
                <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium mt-0.5 block">
                  Short grade code shown on Summary Sheet tables.
                </span>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded border border-slate-300 dark:border-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-bold rounded transition shadow-sm flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingSpec ? 'Save Changes' : 'Add Spec to Database'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Bulk Import / Paste */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden transition-colors">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center space-x-2 text-slate-900 dark:text-white font-bold">
                <UploadCloud className="w-5 h-5 text-indigo-700 dark:text-indigo-400" />
                <span>Import / Paste Film Specs Master Data</span>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Tab Selector: Paste vs File */}
              <div className="flex border-b border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setImportTab('paste')}
                  className={`py-2 px-4 text-xs font-bold border-b-2 flex items-center space-x-2 cursor-pointer ${
                    importTab === 'paste'
                      ? 'border-indigo-600 text-indigo-900 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/50'
                      : 'border-transparent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Clipboard className="w-4 h-4" />
                  <span>Paste Tabular Data</span>
                </button>
                <button
                  onClick={() => setImportTab('file')}
                  className={`py-2 px-4 text-xs font-bold border-b-2 flex items-center space-x-2 cursor-pointer ${
                    importTab === 'file'
                      ? 'border-indigo-600 text-indigo-900 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/50'
                      : 'border-transparent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Upload Excel File (.xlsx/.xls)</span>
                </button>
              </div>

              {/* Excel / Paste Format Guide */}
              <div className="p-3 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-800 rounded text-xs text-blue-950 dark:text-blue-200 flex items-start space-x-2">
                <Info className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Required 4-Column Layout (in order):</p>
                  <p className="font-mono text-[11px] text-blue-900 dark:text-blue-300 mt-0.5">
                    <strong>Film Code</strong> | <strong>Thickness (micron)</strong> | <strong>Density</strong> | <strong>Code for Summary</strong>
                  </p>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300 mt-1">
                    Example: <code className="bg-white/80 dark:bg-slate-800 px-1 py-0.5 rounded font-mono border border-blue-200 dark:border-blue-700">TH21-30	30	0.91	TH30</code> (Tab or Comma separated, headers optional).
                  </p>
                </div>
              </div>

              {/* Paste Mode */}
              {importTab === 'paste' && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                    Paste Tabular Data from Excel / Spreadsheet:
                  </label>
                  <textarea
                    rows={6}
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      setImportResult(null);
                    }}
                    placeholder={`Film Code\tThickness\tDensity\tCode for Summary\nTH21-30\t30\t0.91\tTH30\nCMB21S-20\t20\t0.91\tCMB21S-20\nPTN01-12\t12\t1.40\tPTN01-12`}
                    className="w-full p-3 font-mono text-xs border border-slate-300 dark:border-slate-600 rounded focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleParsePaste}
                      disabled={!pasteText.trim()}
                      className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded transition flex items-center space-x-1.5 cursor-pointer shadow-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Validate & Preview Pasted Data</span>
                    </button>
                  </div>
                </div>
              )}

              {/* File Upload Mode */}
              {importTab === 'file' && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                    Select Excel File (.xlsx, .xls):
                  </label>
                  <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 rounded-lg p-6 text-center cursor-pointer bg-slate-50 dark:bg-slate-850 transition"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileSpreadsheet className="w-8 h-8 text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {selectedFileName ? selectedFileName : 'Click to select or drag & drop Excel file'}
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium mt-1">
                      Supports .xlsx and .xls files with 4 columns: Film Code, Thickness, Density, Code for Summary.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>
              )}

              {/* Validation & Preview Section */}
              {importResult && (
                <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800 animate-fadeIn">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-center">
                      <span className="text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 block">Total Rows</span>
                      <strong className="text-base text-slate-900 dark:text-slate-100 font-mono">{importResult.summary.total}</strong>
                    </div>
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 rounded text-center">
                      <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-400 block">Valid New</span>
                      <strong className="text-base text-emerald-900 dark:text-emerald-200 font-mono">{importResult.summary.validNew}</strong>
                    </div>
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded text-center">
                      <span className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-400 block">Already in DB</span>
                      <strong className="text-base text-amber-900 dark:text-amber-200 font-mono">{importResult.summary.existingDuplicates}</strong>
                    </div>
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded text-center">
                      <span className="text-[10px] uppercase font-bold text-rose-800 dark:text-rose-400 block">Errors / Invalid</span>
                      <strong className="text-base text-rose-900 dark:text-rose-200 font-mono">{importResult.summary.invalid}</strong>
                    </div>
                  </div>

                  {/* Overwrite or Skip Policy */}
                  {importResult.summary.existingDuplicates > 0 && (
                    <div className="p-3 bg-amber-50/90 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 rounded text-xs text-amber-950 dark:text-amber-200 space-y-2">
                      <div className="flex items-center space-x-2 font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>Duplicate Conflict Resolution Policy:</span>
                      </div>
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pl-6 text-xs">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="duplicatePolicy"
                            checked={!overwriteExisting}
                            onChange={() => setOverwriteExisting(false)}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="font-bold text-slate-900 dark:text-slate-100">Skip existing records (Keep current database values)</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="duplicatePolicy"
                            checked={overwriteExisting}
                            onChange={() => setOverwriteExisting(true)}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="font-bold text-indigo-950 dark:text-indigo-300">Update / Overwrite existing records</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Preview Table */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded overflow-hidden">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                      <span>Parsed Data Validation Preview:</span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                        Rows with red errors will be skipped automatically upon saving.
                      </span>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-50 dark:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold sticky top-0 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-2 px-3 w-10 text-center">Row</th>
                            <th className="py-2 px-3">Film Code</th>
                            <th className="py-2 px-3 text-right">Thickness (&mu;m)</th>
                            <th className="py-2 px-3 text-right">Density</th>
                            <th className="py-2 px-3">Summary Code</th>
                            <th className="py-2 px-3">Status / Errors</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {importResult.rows.map((row) => {
                            let statusBadge = null;
                            if (!row.isValid) {
                              statusBadge = (
                                <span className="inline-flex items-center text-[10px] text-rose-800 dark:text-rose-300 font-bold bg-rose-50 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 px-1.5 py-0.5 rounded">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  {row.errors.join(', ')}
                                </span>
                              );
                            } else if (row.isExistingInDb) {
                              statusBadge = (
                                <span className="inline-flex items-center text-[10px] text-amber-800 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 px-1.5 py-0.5 rounded">
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  {overwriteExisting ? 'Will Update Existing' : 'Already in DB (Will Skip)'}
                                </span>
                              );
                            } else if (row.isDuplicateInBatch) {
                              statusBadge = (
                                <span className="inline-flex items-center text-[10px] text-amber-800 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 px-1.5 py-0.5 rounded">
                                  Duplicate in Batch
                                </span>
                              );
                            } else {
                              statusBadge = (
                                <span className="inline-flex items-center text-[10px] text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                                  <Check className="w-3 h-3 mr-1" /> Valid New Spec
                                </span>
                              );
                            }

                            return (
                              <tr
                                key={row.rowNumber}
                                className={!row.isValid ? 'bg-rose-50/40 dark:bg-rose-950/30' : row.isExistingInDb ? 'bg-amber-50/30 dark:bg-amber-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}
                              >
                                <td className="py-1.5 px-3 text-center text-slate-500 dark:text-slate-400 font-bold text-[11px]">{row.rowNumber}</td>
                                <td className="py-1.5 px-3 font-bold text-slate-900 dark:text-slate-100">{row.code || '<Empty>'}</td>
                                <td className="py-1.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">{row.thickness > 0 ? row.thickness : '-'}</td>
                                <td className="py-1.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">{row.density > 0 ? row.density.toFixed(2) : '-'}</td>
                                <td className="py-1.5 px-3 font-semibold text-slate-900 dark:text-slate-200">{row.summary_code || '-'}</td>
                                <td className="py-1.5 px-3">{statusBadge}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded border border-slate-300 dark:border-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveImport}
                disabled={!importResult || (importResult.summary.validNew === 0 && (!overwriteExisting || importResult.summary.existingDuplicates === 0))}
                className="px-5 py-2 bg-indigo-700 hover:bg-indigo-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded transition shadow-sm flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Save to Master Database</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
