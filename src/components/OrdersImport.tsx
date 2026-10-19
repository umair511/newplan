import React, { useState, useRef } from 'react';
import { VA05Order, ImportBatch, UserProfile } from '../types';
import { parseVA05File } from '../services/va05Parser';
import { 
  logAuditEvent, 
  saveStoredOrders, 
  saveStoredBatches,
  deleteSingleOrder,
  deleteBulkOrders,
  deleteAllOrders,
  deleteOrdersByFilm,
  deleteImportBatch,
  resetDatabaseToSeed 
} from '../services/storage';
import { VA05SampleFormModal } from './VA05SampleFormModal';
import { OrderEditModal } from './OrderEditModal';
import { 
  UploadCloud, 
  Search, 
  Filter, 
  Star, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileSpreadsheet, 
  RotateCcw,
  Sparkles,
  Layers,
  PlusCircle,
  FileText,
  Edit,
  Trash2,
  AlertTriangle,
  CheckSquare,
  Square,
  FolderArchive,
  RefreshCw,
  X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { isPS01Order } from '../services/optimizer/deckleOptimizer';

interface OrdersImportProps {
  orders: VA05Order[];
  batches: ImportBatch[];
  currentUser: UserProfile;
  onOrdersUpdated: (newOrders: VA05Order[]) => void;
  onBatchesUpdated: (newBatches: ImportBatch[]) => void;
  onTogglePriority: (orderId: string) => void;
  onPlanFilm: (film: string) => void;
}

export const OrdersImport: React.FC<OrdersImportProps> = ({
  orders,
  batches,
  currentUser,
  onOrdersUpdated,
  onBatchesUpdated,
  onTogglePriority,
  onPlanFilm,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilm, setSelectedFilm] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ batch?: ImportBatch; errors?: string[]; warnings?: string[] } | null>(null);
  
  // Modals & Drawers state
  const [isSampleFormOpen, setIsSampleFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<VA05Order | null>(null);
  const [singleDeleteOrder, setSingleDeleteOrder] = useState<VA05Order | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showBatchesDrawer, setShowBatchesDrawer] = useState(false);

  // Selection for bulk actions
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  // PS module: never display slit widths below 355 mm (those belong to SS)
  const psVisibleOrders = orders.filter(isPS01Order);
  const distinctFilms = Array.from(new Set(psVisibleOrders.map(o => o.film))).sort();

  // Filtered orders
  const filteredOrders = psVisibleOrders.filter(order => {
    if (selectedFilm !== 'ALL' && order.film !== selectedFilm) return false;
    if (selectedStatus !== 'ALL' && order.status !== selectedStatus) return false;
    if (priorityOnly && !order.priority) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSO = order.sales_order.toLowerCase().includes(q);
      const matchCust = order.customer.toLowerCase().includes(q);
      const matchMat = order.material.toLowerCase().includes(q);
      const matchPO = (order.customer_reference || '').toLowerCase().includes(q);
      const matchCity = (order.ship_to_city || '').toLowerCase().includes(q);
      return matchSO || matchCust || matchMat || matchPO || matchCity;
    }
    return true;
  });

  const allFilteredSelected = filteredOrders.length > 0 && filteredOrders.every(o => selectedOrderIds.has(o.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedOrderIds);
      filteredOrders.forEach(o => next.delete(o.id));
      setSelectedOrderIds(next);
    } else {
      const next = new Set(selectedOrderIds);
      filteredOrders.forEach(o => next.add(o.id));
      setSelectedOrderIds(next);
    }
  };

  const handleToggleSelectRow = (orderId: string) => {
    const next = new Set(selectedOrderIds);
    if (next.has(orderId)) {
      next.delete(orderId);
    } else {
      next.add(orderId);
    }
    setSelectedOrderIds(next);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setIsUploading(true);
    setUploadFeedback(null);

    try {
      const result = await parseVA05File(file, currentUser.name);

      if (result.orders.length > 0) {
        // Merge with existing orders
        const existingMap = new Map<string, VA05Order>();
        orders.forEach(o => existingMap.set(`${o.sales_order}-${o.item_number}-${o.width_mm}-${o.length_m}`, o));
        
        result.orders.forEach(newOrder => {
          const key = `${newOrder.sales_order}-${newOrder.item_number}-${newOrder.width_mm}-${newOrder.length_m}`;
          if (existingMap.has(key)) {
            // Update balance
            const existing = existingMap.get(key)!;
            existing.balance_qty = newOrder.balance_qty;
            existing.remaining_qty = newOrder.remaining_qty;
            existing.updated_at = new Date().toISOString();
          } else {
            existingMap.set(key, newOrder);
          }
        });

        const mergedOrders = Array.from(existingMap.values());
        const updatedBatches = [result.batch, ...batches];

        saveStoredOrders(mergedOrders);
        saveStoredBatches(updatedBatches);
        onOrdersUpdated(mergedOrders);
        onBatchesUpdated(updatedBatches);

        logAuditEvent(
          currentUser,
          'IMPORT',
          'IMPORT_BATCH',
          result.batch.id,
          `Imported Planning Sheet [${file.name}] with ${result.orders.length} valid orders (${result.batch.films_detected.length} films)`
        );

        setUploadFeedback({
          batch: result.batch,
          errors: result.errors,
          warnings: result.warnings,
        });
      } else {
        setUploadFeedback({
          errors: result.errors.length > 0 ? result.errors : ['No valid order rows found in the uploaded file.'],
        });
      }
    } catch (err: any) {
      setUploadFeedback({
        errors: [`Failed to parse file: ${err.message || 'Unknown error'}`],
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportOrdersToExcel = () => {
    // Factory Planning Sheet headers — planning-required columns only
    const exportRows = filteredOrders.map(o => ({
      'Sales Order #': o.sales_order,
      'Item #': o.item_number,
      'Customer': o.customer,
      'Film Code': o.film,
      'Width (mm)': o.width_mm,
      'Length (m)': o.length_m,
      'Core ID': o.core,
      'TS / MTS': o.treatment_side,
      'Order Qty': o.ordered_qty,
      'Bal QtY': o.balance_qty,
      'Delivery Date': o.delivery_date || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planning Sheet');
    XLSX.writeFile(wb, `Planning_Sheet_Orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // --- CRUD Handlers ---

  const handleSaveEditedOrder = (updatedOrder: VA05Order) => {
    const updatedList = orders.map(o => o.id === updatedOrder.id ? updatedOrder : o);
    saveStoredOrders(updatedList);
    onOrdersUpdated(updatedList);

    logAuditEvent(
      currentUser,
      'UPDATE',
      'VA05_ORDER',
      updatedOrder.sales_order,
      `Edited order line SO# ${updatedOrder.sales_order} Item #${updatedOrder.item_number} (${updatedOrder.customer}) · ${updatedOrder.film} ${updatedOrder.width_mm}mm × ${updatedOrder.length_m}m (${updatedOrder.remaining_qty} kg)`
    );
  };

  const handleDeleteSingleOrder = (orderId: string) => {
    const remaining = deleteSingleOrder(currentUser, orderId);
    onOrdersUpdated(remaining);
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      next.delete(orderId);
      return next;
    });
    setSingleDeleteOrder(null);
  };

  const handleDeleteBulkSelected = () => {
    const idsToDelete: string[] = Array.from(selectedOrderIds);
    if (idsToDelete.length === 0) return;

    if (window.confirm(`Are you sure you want to delete ${idsToDelete.length} selected orders from the planning database?`)) {
      const remaining = deleteBulkOrders(currentUser, idsToDelete);
      onOrdersUpdated(remaining);
      setSelectedOrderIds(new Set());
    }
  };

  const handleDeleteAllOrders = () => {
    const remaining = deleteAllOrders(currentUser);
    onOrdersUpdated(remaining);
    setSelectedOrderIds(new Set());
    setShowDeleteAllModal(false);
  };

  const handleResetToSeed = () => {
    resetDatabaseToSeed();
    const stored = orders; // trigger reload via App
    window.location.reload();
  };

  const handleDeleteFilmOrders = (film: string) => {
    const count = orders.filter(o => o.film === film).length;
    if (window.confirm(`Are you sure you want to delete all ${count} orders for film grade [${film}]?`)) {
      const remaining = deleteOrdersByFilm(currentUser, film);
      onOrdersUpdated(remaining);
      setSelectedOrderIds(new Set());
      setSelectedFilm('ALL');
    }
  };

  const handleDeleteBatch = (batchId: string) => {
    const targetBatch = batches.find(b => b.id === batchId);
    if (!targetBatch) return;

    if (window.confirm(`Are you sure you want to delete Import Batch [${targetBatch.batch_number}] (${targetBatch.filename}) and remove all its orders?`)) {
      const { remainingOrders, remainingBatches } = deleteImportBatch(currentUser, batchId);
      onOrdersUpdated(remainingOrders);
      onBatchesUpdated(remainingBatches);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone (SRS Section 11 & 67) */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Master Orders & Planning Sheet Import
              </h2>
              <span className="text-[10px] px-2 py-0.5 font-mono font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                All Modules (SS / MSL / PS)
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Central customer order backlog and factory Planning Sheet importer for Secondary Slitter, Metallizer, and Primary Slitter.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.xlsm,.csv"
              className="hidden"
            />
            
            <button
              onClick={() => setIsSampleFormOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
              title="Open interactive Planning Sheet order entry form with presets and downloadable template"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
              <span>Sample Form</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || currentUser.role === 'VIEWER'}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>{isUploading ? 'Validating...' : 'Upload Planning Sheet'}</span>
            </button>

            <button
              onClick={() => setShowBatchesDrawer(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
              title="View & manage uploaded batches"
            >
              <FolderArchive className="w-3.5 h-3.5 text-slate-400" />
              <span>Batches ({batches.length})</span>
            </button>

            <button
              onClick={handleExportOrdersToExcel}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
              title="Export filtered orders list to Excel"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden md:inline">Export</span>
            </button>

            {/* Danger: Delete All Orders Trigger */}
            <button
              onClick={() => setShowDeleteAllModal(true)}
              disabled={orders.length === 0 || currentUser.role === 'VIEWER'}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-50/70 hover:bg-rose-100 text-rose-700 text-xs font-medium rounded-lg border border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
              title="Delete all orders or reset database"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>Delete All</span>
            </button>
          </div>
        </div>

        {/* Upload Feedback Box */}
        {uploadFeedback && (
          <div className="mt-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
            {uploadFeedback.batch && (
              <div className="space-y-1">
                <div className="flex items-center space-x-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Import Batch [{uploadFeedback.batch.batch_number}] Processed Successfully</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-slate-600 font-mono">
                  <div>Rows: <strong className="text-slate-900">{uploadFeedback.batch.total_rows}</strong></div>
                  <div>Valid: <strong className="text-emerald-700">{uploadFeedback.batch.valid_rows}</strong></div>
                  <div>Films: <strong className="text-slate-900">{uploadFeedback.batch.films_detected.join(', ')}</strong></div>
                  <div>Demand: <strong className="text-slate-900">{uploadFeedback.batch.total_remaining_kg.toLocaleString()} kg</strong></div>
                </div>
              </div>
            )}

            {uploadFeedback.errors && uploadFeedback.errors.length > 0 && (
              <div className="mt-2 text-rose-700">
                <p className="font-semibold flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Validation Errors ({uploadFeedback.errors.length}):</span>
                </p>
                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[11px]">
                  {uploadFeedback.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Orders Filter & Table */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by SO#, Customer, Material, PO# or City..."
              className="w-full pl-8 pr-4 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 bg-slate-50/70 focus:bg-white placeholder:text-slate-400 transition-all"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Film Selector */}
            <div className="flex items-center space-x-1.5 bg-slate-50/70 px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="text-slate-400 font-medium">Film:</span>
              <select
                value={selectedFilm}
                onChange={(e) => setSelectedFilm(e.target.value)}
                className="bg-transparent font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Films ({distinctFilms.length})</option>
                {distinctFilms.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            {/* If a specific film is selected, offer Delete All for this Film button */}
            {selectedFilm !== 'ALL' && (
              <button
                onClick={() => handleDeleteFilmOrders(selectedFilm)}
                className="flex items-center space-x-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition-colors cursor-pointer"
                title={`Delete all orders for ${selectedFilm}`}
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                <span>Delete {selectedFilm} ({filteredOrders.length})</span>
              </button>
            )}

            {/* Status Filter */}
            <div className="flex items-center space-x-1.5 bg-slate-50/70 px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="text-slate-400 font-medium">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending Only</option>
                <option value="PARTIALLY_FULFILLED">Partially Fulfilled</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>

            {/* Priority Toggle */}
            <button
              onClick={() => setPriorityOnly(!priorityOnly)}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                priorityOnly
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${priorityOnly ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
              <span>Priority Only</span>
            </button>
          </div>
        </div>

        {/* Bulk Action Bar (when rows are selected) */}
        {selectedOrderIds.size > 0 && (
          <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-950">
            <div className="flex items-center space-x-2">
              <CheckSquare className="w-4 h-4 text-emerald-700" />
              <span>
                <strong>{selectedOrderIds.size}</strong> orders selected out of {filteredOrders.length}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setSelectedOrderIds(new Set())}
                className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-md border border-slate-300 transition-colors font-medium cursor-pointer"
              >
                Deselect All
              </button>
              <button
                onClick={handleDeleteBulkSelected}
                className="flex items-center space-x-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-bold shadow-xs transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected ({selectedOrderIds.size})</span>
              </button>
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div className="overflow-x-auto border border-slate-200/80 rounded-lg">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/90 text-slate-600 font-semibold text-[11px] border-b border-slate-200/80 select-none">
              <tr>
                <th className="py-2.5 px-3 w-8 text-center">
                  <button
                    onClick={handleToggleSelectAll}
                    className="p-0.5 hover:bg-slate-200/60 rounded text-slate-600 cursor-pointer"
                    title={allFilteredSelected ? 'Deselect All' : 'Select All Filtered'}
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-slate-900" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-2 w-8 text-center text-slate-400">⭐</th>
                <th className="py-2.5 px-3">SO# / Item</th>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3">Film / Mat</th>
                <th className="py-2.5 px-3 text-right">Width</th>
                <th className="py-2.5 px-3 text-right">Length</th>
                <th className="py-2.5 px-3 text-center">Core</th>
                <th className="py-2.5 px-3 text-right">Remaining (kg)</th>
                <th className="py-2.5 px-3 text-right">Balance (kg)</th>
                <th className="py-2.5 px-3">City / Rep</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-slate-400 font-sans">
                    No orders match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const isSelected = selectedOrderIds.has(order.id);
                  return (
                    <tr 
                      key={order.id} 
                      className={`transition-colors font-sans ${isSelected ? 'bg-slate-50/90' : 'hover:bg-slate-50/70'}`}
                    >
                      {/* Select Checkbox */}
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => handleToggleSelectRow(order.id)}
                          className="p-0.5 hover:bg-slate-200/60 rounded text-slate-600 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-slate-900" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-300" />
                          )}
                        </button>
                      </td>

                      {/* Priority Star Toggle */}
                      <td className="py-2 px-2 text-center">
                        <button
                          onClick={() => onTogglePriority(order.id)}
                          className="p-1 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                          title="Toggle Planner Priority"
                        >
                          <Star className={`w-3.5 h-3.5 ${order.priority ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-amber-400'}`} />
                        </button>
                      </td>

                      <td className="py-2 px-3">
                        <div className="font-mono font-medium text-slate-900">{order.sales_order}</div>
                        <div className="text-[10px] font-mono text-slate-400">#{order.item_number}</div>
                      </td>

                      <td className="py-2 px-3 font-medium text-slate-800 max-w-[180px] truncate" title={order.customer}>
                        <div>{order.customer}</div>
                        {order.customer_reference && (
                          <div className="text-[10px] text-slate-400 truncate">Ref: {order.customer_reference}</div>
                        )}
                      </td>

                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {order.film}
                        </span>
                      </td>

                      <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                        {order.width_mm} mm
                      </td>

                      <td className="py-2 px-3 text-right font-mono text-slate-600">
                        {(order.length_m ?? 0).toLocaleString()} m
                      </td>

                      <td className="py-2 px-3 text-center font-mono text-slate-600 text-[11px]">
                        {order.core}" {order.treatment_side}
                      </td>

                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {(order.remaining_qty ?? 0).toLocaleString()}
                      </td>

                      <td className="py-2 px-3 text-right font-mono text-slate-500">
                        {(order.balance_qty ?? 0).toLocaleString()}
                      </td>

                      <td className="py-2 px-3 text-slate-600 text-xs">
                        <div>{order.ship_to_city || '-'}</div>
                        <div className="text-[10px] text-slate-400">{order.sales_person || ''}</div>
                      </td>

                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          order.status === 'COMPLETED' ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                          order.status === 'PARTIALLY_FULFILLED' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {order.status === 'PARTIALLY_FULFILLED' ? 'Partial' : order.status}
                        </span>
                      </td>

                      {/* Row Action Controls: Plan, Edit, Delete */}
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => onPlanFilm(order.film)}
                            className="px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs rounded transition-colors cursor-pointer"
                            title="Generate cutting schedule for this film"
                          >
                            Plan
                          </button>

                          <button
                            onClick={() => setEditingOrder(order)}
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="Edit this order"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => setSingleDeleteOrder(order)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Delete this order"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-500 pt-2 border-t border-slate-100">
          <span>Showing <strong>{filteredOrders.length}</strong> of <strong>{psVisibleOrders.length}</strong> PS01 sales order lines (width ≥ 355 mm)</span>
          <span>Filtered Remaining Demand: <strong>{(filteredOrders.reduce((sum, o) => sum + (o.remaining_qty ?? 0), 0) ?? 0).toLocaleString()} kg</strong></span>
        </div>
      </div>

      {/* --- MODAL 1: Edit Order Modal --- */}
      <OrderEditModal
        isOpen={Boolean(editingOrder)}
        order={editingOrder}
        currentUser={currentUser}
        onClose={() => setEditingOrder(null)}
        onSave={handleSaveEditedOrder}
        onDelete={handleDeleteSingleOrder}
      />

      {/* --- MODAL 2: Single Order Delete Confirmation Modal --- */}
      {singleDeleteOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Order Line?</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1 text-slate-700">
              <div><strong>SO#:</strong> {singleDeleteOrder.sales_order} / Item #{singleDeleteOrder.item_number}</div>
              <div><strong>Customer:</strong> {singleDeleteOrder.customer}</div>
              <div><strong>Film / Size:</strong> {singleDeleteOrder.film} · {singleDeleteOrder.width_mm}mm × {(singleDeleteOrder.length_m ?? 0).toLocaleString()}m</div>
              <div><strong>Remaining Demand:</strong> {(singleDeleteOrder.remaining_qty ?? 0).toLocaleString()} kg</div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setSingleDeleteOrder(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteSingleOrder(singleDeleteOrder.id)}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors cursor-pointer flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Order</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 3: Delete All Orders & Database Reset Modal --- */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-3 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete All Orders</h3>
                <p className="text-xs text-slate-500">Choose how you want to clear or reset the orders database.</p>
              </div>
            </div>

            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
              <p className="font-semibold flex items-center space-x-1 mb-1">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Warning: High impact action!</span>
              </p>
              <p className="text-rose-700">
                You currently have <strong>{orders.length} orders</strong> across {distinctFilms.length} films ({(orders.reduce((s, o) => s + (o.remaining_qty ?? 0), 0) ?? 0).toLocaleString()} kg total demand).
              </p>
            </div>

            <div className="space-y-3">
              {/* Option 1: Clear All to 0 */}
              <button
                onClick={handleDeleteAllOrders}
                className="w-full text-left p-3.5 rounded-xl border border-rose-300 bg-white hover:bg-rose-50/50 transition-colors flex items-start space-x-3 group cursor-pointer"
              >
                <div className="p-2 bg-rose-100 text-rose-700 rounded-lg group-hover:bg-rose-200 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-xs">Clear All Orders Completely (0 Orders)</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Deletes all {orders.length} orders. Leaves the database empty for a fresh Planning Sheet upload.
                  </div>
                </div>
              </button>

              {/* Option 2: Reset to factory seed */}
              <button
                onClick={handleResetToSeed}
                className="w-full text-left p-3.5 rounded-xl border border-amber-300 bg-white hover:bg-amber-50/50 transition-colors flex items-start space-x-3 group cursor-pointer"
              >
                <div className="p-2 bg-amber-100 text-amber-800 rounded-lg group-hover:bg-amber-200 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-xs">Reset to Factory Backlog (352 Seed Orders)</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Restores the initial pending Planning Sheet order backlog.
                  </div>
                </div>
              </button>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowDeleteAllModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- DRAWER: Manage Import Batches --- */}
      {showBatchesDrawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <FolderArchive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Manage Import Batches</h3>
                  <p className="text-xs text-slate-500">View and manage uploaded Planning Sheet files and batches</p>
                </div>
              </div>
              <button
                onClick={() => setShowBatchesDrawer(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {batches.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  No import batches found.
                </div>
              ) : (
                batches.map((batch) => {
                  const batchOrdersCount = orders.filter(o => o.import_batch_id === batch.id).length;
                  return (
                    <div 
                      key={batch.id} 
                      className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900">{batch.batch_number}</span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono text-[10px]">
                            {batch.filename}
                          </span>
                        </div>
                        <div className="text-slate-600 text-[11px]">
                          Uploaded by <strong>{batch.uploaded_by}</strong> on {new Date(batch.uploaded_at).toLocaleString()}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-slate-700 text-[11px]">
                          <div>Orders in DB: <strong className="text-emerald-700">{batchOrdersCount}</strong></div>
                          <div>Films: <strong className="text-slate-900">{batch.films_detected.join(', ') || 'N/A'}</strong></div>
                          <div>Total Weight: <strong>{batch.total_remaining_kg?.toLocaleString() || 0} kg</strong></div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteBatch(batch.id)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 transition-colors font-bold text-xs cursor-pointer shrink-0"
                        title="Delete this batch and all its orders"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Batch</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowBatchesDrawer(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Planning Sheet Sample Form & Order Entry Modal */}
      <VA05SampleFormModal
        isOpen={isSampleFormOpen}
        onClose={() => setIsSampleFormOpen(false)}
        orders={orders}
        batches={batches}
        currentUser={currentUser}
        onOrdersUpdated={onOrdersUpdated}
        onBatchesUpdated={onBatchesUpdated}
        onPlanFilm={onPlanFilm}
      />
    </div>
  );
};
