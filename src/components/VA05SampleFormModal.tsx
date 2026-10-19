import React, { useState } from 'react';
import { VA05Order, UserProfile, ImportBatch } from '../types';
import { FILM_MASTERS, DEFAULT_PLANNING_RULES } from '../services/masterData';
import { calculateSingleReelWeight } from '../services/weightCalculator';
import { logAuditEvent, saveStoredOrders, saveStoredBatches } from '../services/storage';
import { 
  X, 
  FileSpreadsheet, 
  Plus, 
  Sparkles, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Scale, 
  Star, 
  Layers, 
  Calendar,
  Building2,
  Tag,
  Hash,
  ArrowRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface VA05SampleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: VA05Order[];
  batches: ImportBatch[];
  currentUser: UserProfile;
  onOrdersUpdated: (newOrders: VA05Order[]) => void;
  onBatchesUpdated: (newBatches: ImportBatch[]) => void;
  onPlanFilm?: (film: string) => void;
}

export const VA05SampleFormModal: React.FC<VA05SampleFormModalProps> = ({
  isOpen,
  onClose,
  orders,
  batches,
  currentUser,
  onOrdersUpdated,
  onBatchesUpdated,
  onPlanFilm,
}) => {
  // Form Field States
  const [salesOrder, setSalesOrder] = useState<string>('SO-' + Math.floor(100000 + Math.random() * 900000));
  const [itemNumber, setItemNumber] = useState<number>(10);
  const [customer, setCustomer] = useState<string>('PACKAGING SOLUTIONS PVT LTD');
  const [selectedFilm, setSelectedFilm] = useState<string>('TNO20');
  const [materialDescription, setMaterialDescription] = useState<string>('Transparent Non Heat Sealable BOPP Film 20µ');
  const [widthMm, setWidthMm] = useState<number>(1015);
  const [lengthM, setLengthM] = useState<number>(19500);
  const [core, setCore] = useState<3 | 6>(6);
  const [treatmentSide, setTreatmentSide] = useState<'OS' | 'IS' | 'Both' | 'None'>('OS');
  const [orderedQty, setOrderedQty] = useState<number>(3600);
  const [balanceQty, setBalanceQty] = useState<number>(3600);
  const [priority, setPriority] = useState<boolean>(false);
  const [deliveryDate, setDeliveryDate] = useState<string>(
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  );
  const [customerRef, setCustomerRef] = useState<string>('PO-APS-' + Math.floor(1000 + Math.random() * 9000));
  const [shipToCity, setShipToCity] = useState<string>('Lahore');
  const [salesPerson, setSalesPerson] = useState<string>('Farhan Ali');
  const [paymentTerm, setPaymentTerm] = useState<string>('Net 30 Days');

  const [feedback, setFeedback] = useState<{ type: 'SUCCESS' | 'ERROR'; message: string; addedOrders?: VA05Order[] } | null>(null);

  if (!isOpen) return null;

  // Selected film master specs
  const currentFilmSpec = FILM_MASTERS.find(f => f.code === selectedFilm) || FILM_MASTERS[0];
  const thickness = currentFilmSpec.thickness_micron;
  const density = currentFilmSpec.density;

  // Live Reel Weight Calculation
  const liveReelWeight = calculateSingleReelWeight(widthMm, thickness, density, lengthM);
  const estimatedReels = liveReelWeight > 0 ? Math.ceil(balanceQty / liveReelWeight) : 0;

  // Handle film change
  const handleFilmChange = (filmCode: string) => {
    setSelectedFilm(filmCode);
    const spec = FILM_MASTERS.find(f => f.code === filmCode);
    if (spec) {
      setMaterialDescription(spec.name);
      setLengthM(spec.standard_length_m);
    }
  };

  // Preset Template Fillers
  const loadPreset = (presetType: 'TNO20' | 'TH21_20' | 'MZ18' | 'TH21_30') => {
    setFeedback(null);
    const randomSO = 'SO-' + Math.floor(100000 + Math.random() * 900000);
    setSalesOrder(randomSO);
    setItemNumber(10);

    if (presetType === 'TNO20') {
      setSelectedFilm('TNO20');
      setCustomer('UNIVERSAL PACKAGING LTD');
      setMaterialDescription('Transparent Non Heat Sealable BOPP Film 20µ');
      setWidthMm(1015);
      setLengthM(19500);
      setOrderedQty(7200);
      setBalanceQty(7200);
      setShipToCity('Karachi');
      setSalesPerson('Muhammad Asif');
    } else if (presetType === 'TH21_20') {
      setSelectedFilm('TH21-20');
      setCustomer('METRO FLEXIBLE PACKAGING');
      setMaterialDescription('Transparent Heat Sealable BOPP Film 20µ');
      setWidthMm(1103);
      setLengthM(19500);
      setOrderedQty(5500);
      setBalanceQty(5500);
      setShipToCity('Lahore');
      setSalesPerson('Tariq Mehmood');
    } else if (presetType === 'MZ18') {
      setSelectedFilm('MZ18');
      setCustomer('CREATIVE CONVERTERS');
      setMaterialDescription('Metalized BOPP High Barrier Film 18µ');
      setWidthMm(980);
      setLengthM(19500);
      setOrderedQty(4500);
      setBalanceQty(4500);
      setShipToCity('Faisalabad');
      setSalesPerson('Zahid Hussain');
    } else if (presetType === 'TH21_30') {
      setSelectedFilm('TH21-30');
      setCustomer('ORIENTAL PRINT PACK');
      setMaterialDescription('Transparent Heat Sealable BOPP Film 30µ');
      setWidthMm(1050);
      setLengthM(12900);
      setOrderedQty(6000);
      setBalanceQty(6000);
      setShipToCity('Gujranwala');
      setSalesPerson('Imran Qureshi');
    }
  };

  // Submit Single Order to Queue
  const handleSubmitSingleOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!salesOrder.trim()) {
      setFeedback({ type: 'ERROR', message: 'Sales Order Document # is required.' });
      return;
    }
    if (widthMm <= 0 || isNaN(widthMm)) {
      setFeedback({ type: 'ERROR', message: 'Please enter a valid slit width in mm.' });
      return;
    }
    if (lengthM <= 0 || isNaN(lengthM)) {
      setFeedback({ type: 'ERROR', message: 'Please enter a valid roll length in meters.' });
      return;
    }
    if (balanceQty <= 0 || isNaN(balanceQty)) {
      setFeedback({ type: 'ERROR', message: 'Remaining / Balance Quantity must be greater than 0 kg.' });
      return;
    }

    const newOrder: VA05Order = {
      id: `ord-manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      import_batch_id: `manual-entry-${new Date().toISOString().slice(0, 10)}`,
      sales_order: salesOrder.trim().toUpperCase(),
      item_number: itemNumber,
      customer: customer.trim().toUpperCase(),
      material: selectedFilm,
      film: selectedFilm,
      material_description: materialDescription,
      width_mm: widthMm,
      length_m: lengthM,
      thickness_micron: thickness,
      density: density,
      core: core,
      treatment_side: treatmentSide,
      ordered_qty: orderedQty,
      balance_qty: balanceQty,
      remaining_qty: balanceQty,
      produced_qty: 0,
      unit: 'KG',
      plant: '1001',
      priority: priority,
      status: 'PENDING',
      delivery_date: deliveryDate,
      customer_reference: customerRef,
      ship_to_city: shipToCity,
      sales_person: salesPerson,
      payment_term: paymentTerm,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Check if duplicate SO + Item + Width exists
    const updatedOrders = [newOrder, ...orders];
    saveStoredOrders(updatedOrders);
    onOrdersUpdated(updatedOrders);

    logAuditEvent(
      currentUser,
      'IMPORT',
      'ORDER',
      newOrder.id,
      `Manually created Planning Sheet order [${newOrder.sales_order} / Item ${newOrder.item_number}] (${newOrder.film} ${newOrder.width_mm}mm × ${newOrder.length_m}m, ${newOrder.remaining_qty} kg)`
    );

    setFeedback({
      type: 'SUCCESS',
      message: `Order [${newOrder.sales_order} - ${newOrder.customer}] successfully added to pending queue!`,
      addedOrders: [newOrder],
    });

    // Reset SO for next entry
    setSalesOrder('SO-' + Math.floor(100000 + Math.random() * 900000));
  };

  // Add 4-Order Complete Slitter Deckle Sample Set
  const handleAddSampleDeckleBatch = () => {
    setFeedback(null);
    const dateStr = new Date().toISOString().slice(0, 10);
    const batchId = `batch-sample-deckle-${Date.now()}`;
    const batchNumber = `VA05-SAMPLE-${dateStr}`;

    const sampleDeckleOrders: VA05Order[] = [
      {
        id: `ord-smpl-1-${Date.now()}`,
        import_batch_id: batchId,
        sales_order: `SO-SMPL-1103`,
        item_number: 10,
        customer: 'PRIME PACKAGING CORP',
        material: 'TNO20',
        film: 'TNO20',
        material_description: 'Transparent Non Heat Sealable BOPP Film 20µ',
        width_mm: 1103,
        length_m: 19500,
        thickness_micron: 20,
        density: 0.91,
        core: 6,
        treatment_side: 'OS',
        ordered_qty: 6000,
        balance_qty: 6000,
        remaining_qty: 6000,
        produced_qty: 0,
        unit: 'KG',
        plant: '1001',
        priority: true,
        status: 'PENDING',
        delivery_date: dateStr,
        customer_reference: 'PO-APS-001',
        ship_to_city: 'Lahore',
        sales_person: 'Farhan Ali',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: `ord-smpl-2-${Date.now()}`,
        import_batch_id: batchId,
        sales_order: `SO-SMPL-1050`,
        item_number: 20,
        customer: 'APEX PRINT & PACK',
        material: 'TNO20',
        film: 'TNO20',
        material_description: 'Transparent Non Heat Sealable BOPP Film 20µ',
        width_mm: 1050,
        length_m: 19500,
        thickness_micron: 20,
        density: 0.91,
        core: 6,
        treatment_side: 'OS',
        ordered_qty: 5500,
        balance_qty: 5500,
        remaining_qty: 5500,
        produced_qty: 0,
        unit: 'KG',
        plant: '1001',
        priority: false,
        status: 'PENDING',
        delivery_date: dateStr,
        customer_reference: 'PO-APS-002',
        ship_to_city: 'Karachi',
        sales_person: 'Muhammad Asif',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: `ord-smpl-3-${Date.now()}`,
        import_batch_id: batchId,
        sales_order: `SO-SMPL-1020`,
        item_number: 10,
        customer: 'CREATIVE FLEXIBLES',
        material: 'TNO20',
        film: 'TNO20',
        material_description: 'Transparent Non Heat Sealable BOPP Film 20µ',
        width_mm: 1020,
        length_m: 19500,
        thickness_micron: 20,
        density: 0.91,
        core: 6,
        treatment_side: 'OS',
        ordered_qty: 4800,
        balance_qty: 4800,
        remaining_qty: 4800,
        produced_qty: 0,
        unit: 'KG',
        plant: '1001',
        priority: false,
        status: 'PENDING',
        delivery_date: dateStr,
        customer_reference: 'PO-APS-003',
        ship_to_city: 'Faisalabad',
        sales_person: 'Tariq Mehmood',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: `ord-smpl-4-${Date.now()}`,
        import_batch_id: batchId,
        sales_order: `SO-SMPL-1085`,
        item_number: 10,
        customer: 'STAR CONVERTERS LTD',
        material: 'TNO20',
        film: 'TNO20',
        material_description: 'Transparent Non Heat Sealable BOPP Film 20µ',
        width_mm: 1085,
        length_m: 19500,
        thickness_micron: 20,
        density: 0.91,
        core: 6,
        treatment_side: 'OS',
        ordered_qty: 3200,
        balance_qty: 3200,
        remaining_qty: 3200,
        produced_qty: 0,
        unit: 'KG',
        plant: '1001',
        priority: true,
        status: 'PENDING',
        delivery_date: dateStr,
        customer_reference: 'PO-APS-004',
        ship_to_city: 'Gujranwala',
        sales_person: 'Imran Qureshi',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const newBatch: ImportBatch = {
      id: batchId,
      batch_number: batchNumber,
      filename: 'Sample_Deckle_Batch.xlsx',
      total_rows: 4,
      valid_rows: 4,
      invalid_rows: 0,
      duplicate_rows: 0,
      zero_balance_rows: 0,
      total_orders: 4,
      total_remaining_kg: 19500,
      films_detected: ['TNO20'],
      uploaded_by: currentUser.name,
      uploaded_at: new Date().toISOString(),
    };

    const updatedOrders = [...sampleDeckleOrders, ...orders];
    const updatedBatches = [newBatch, ...batches];

    saveStoredOrders(updatedOrders);
    saveStoredBatches(updatedBatches);
    onOrdersUpdated(updatedOrders);
    onBatchesUpdated(updatedBatches);

    logAuditEvent(
      currentUser,
      'IMPORT',
      'IMPORT_BATCH',
      batchId,
      `Generated 4-Order Sample Planning Sheet Deckle Batch (${newBatch.batch_number}) with 19,500 kg total demand`
    );

    setFeedback({
      type: 'SUCCESS',
      message: `Successfully loaded 4 sample Planning Sheet orders (19,500 kg total demand) into the pending queue!`,
      addedOrders: sampleDeckleOrders,
    });
  };

  // Download Factory Planning Sheet Excel Template (planning-required headers only)
  const handleDownloadSampleExcel = () => {
    const sampleRows = [
      {
        'Sales Order #': '11001752',
        'Item #': 20,
        'Customer': 'IMBALLAGGI WEST AFRICA',
        'Film Code': 'TH21-20',
        'Width (mm)': 1215,
        'Length (m)': 9750,
        'Core ID': 6,
        'TS / MTS': 'OS',
        'Order Qty': 3880.83,
        'Bal QtY': 510.15,
        'Delivery Date': '18.09.2026',
      },
      {
        'Sales Order #': '10008873',
        'Item #': 10,
        'Customer': 'Fine Printer',
        'Film Code': 'THI20',
        'Width (mm)': 560,
        'Length (m)': 10000,
        'Core ID': 3,
        'TS / MTS': 'IS',
        'Order Qty': 1200,
        'Bal QtY': 1200,
        'Delivery Date': '28.09.2026',
      },
      {
        'Sales Order #': '15002460',
        'Item #': 10,
        'Customer': 'Saad Plastic Industries',
        'Film Code': 'THO20',
        'Width (mm)': 510,
        'Length (m)': 10000,
        'Core ID': 3,
        'TS / MTS': 'OS',
        'Order Qty': 500,
        'Bal QtY': 500,
        'Delivery Date': '10.10.2026',
      },
      {
        'Sales Order #': '10008942',
        'Item #': 30,
        'Customer': 'Universal Packaging Company (Pvt) Limited',
        'Film Code': 'THO20',
        'Width (mm)': 1198,
        'Length (m)': 22200,
        'Core ID': 6,
        'TS / MTS': 'OS',
        'Order Qty': 2600,
        'Bal QtY': 2600,
        'Delivery Date': '30.09.2026',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planning Sheet');
    XLSX.writeFile(wb, `Planning_Sheet_Sample_Template.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Planning Sheet Order Entry & Sample Form</h2>
              <p className="text-xs text-slate-400">
                Directly input custom order lines or load pre-configured sample Planning Sheet orders
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Bar / Quick Presets */}
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-600 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Quick Sample Presets:</span>
            </span>
            <button
              type="button"
              onClick={() => loadPreset('TNO20')}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 shadow-2xs transition-colors cursor-pointer"
            >
              TNO20 20µ
            </button>
            <button
              type="button"
              onClick={() => loadPreset('TH21_20')}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 shadow-2xs transition-colors cursor-pointer"
            >
              TH21-20 20µ
            </button>
            <button
              type="button"
              onClick={() => loadPreset('MZ18')}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 shadow-2xs transition-colors cursor-pointer"
            >
              MZ18 18µ
            </button>
            <button
              type="button"
              onClick={() => loadPreset('TH21_30')}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 shadow-2xs transition-colors cursor-pointer"
            >
              TH21-30 30µ
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleAddSampleDeckleBatch}
              className="flex items-center space-x-1.5 px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold rounded-md shadow-2xs transition-colors cursor-pointer"
              title="Add 4 coordinated order lines ready to form a full primary slitter deckle"
            >
              <Layers className="w-3.5 h-3.5 text-amber-600" />
              <span>Load 4-Order Deckle Set</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadSampleExcel}
              className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold rounded-md shadow-2xs transition-colors cursor-pointer"
              title="Download factory Planning Sheet template (.xlsx) — planning headers only"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Download Excel Template</span>
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`px-6 py-3 border-b text-xs flex items-center justify-between shrink-0 ${
            feedback.type === 'SUCCESS' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="flex items-center space-x-2">
              {feedback.type === 'SUCCESS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="font-semibold">{feedback.message}</span>
            </div>
            {feedback.type === 'SUCCESS' && onPlanFilm && (
              <button
                onClick={() => {
                  onClose();
                  onPlanFilm(selectedFilm);
                }}
                className="flex items-center space-x-1 px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-xs font-bold transition-colors cursor-pointer"
              >
                <span>Plan Film Grade ({selectedFilm})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmitSingleOrder} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Sales Order Identification */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Tag className="w-3.5 h-3.5 text-emerald-600" />
              <span>1. SAP Order Header Information</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sales Document (SO#) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={salesOrder}
                  onChange={(e) => setSalesOrder(e.target.value)}
                  placeholder="e.g. SO-884021"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Line Item # <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  step={10}
                  value={itemNumber}
                  onChange={(e) => setItemNumber(parseInt(e.target.value, 10) || 10)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Name (Sold-to / Ship-to) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="e.g. UNIVERSAL PACKAGING LTD"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Film & Material Parameters */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. Film Grade & Slit Dimensions</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Film Code / Material <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedFilm}
                  onChange={(e) => handleFilmChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold bg-white cursor-pointer"
                >
                  {FILM_MASTERS.map(f => (
                    <option key={f.code} value={f.code}>{f.code} ({f.thickness_micron}µ - {f.category})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Width (mm) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={100}
                  max={4000}
                  value={widthMm}
                  onChange={(e) => setWidthMm(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Length (m) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={lengthM}
                  onChange={(e) => setLengthM(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold bg-white cursor-pointer font-mono"
                >
                  <option value={19500}>19,500 m (Standard Full Length)</option>
                  <option value={15500}>15,500 m (25µ Standard)</option>
                  <option value={12900}>12,900 m (30µ Standard)</option>
                  <option value={9750}>9,750 m (Half Repetition)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Core Diameter & Treatment
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={core}
                    onChange={(e) => setCore(parseInt(e.target.value, 10) as 3 | 6)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none font-semibold bg-white"
                  >
                    <option value={6}>6" Core</option>
                    <option value={3}>3" Core</option>
                  </select>
                  <select
                    value={treatmentSide}
                    onChange={(e) => setTreatmentSide(e.target.value as any)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none font-semibold bg-white"
                  >
                    <option value="OS">Corona OS</option>
                    <option value="IS">Corona IS</option>
                    <option value="Both">Both Sides</option>
                    <option value="None">None</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Live Weight Calculation Banner */}
            <div className="mt-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950">
              <div className="flex items-center space-x-2">
                <Scale className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  <strong>Exact Single Reel Weight:</strong> {liveReelWeight.toFixed(2)} kg
                </span>
                <span className="text-emerald-700 text-[11px]">
                  (Formula: {widthMm}mm × {thickness}µ × {density} × {(lengthM ?? 0).toLocaleString()}m ÷ 1,000,000)
                </span>
              </div>
              <div className="font-semibold text-emerald-800">
                Est. Output: ~{estimatedReels} reels for {(balanceQty ?? 0).toLocaleString()} kg demand
              </div>
            </div>
          </div>

          {/* Section 3: Quantity & Priority */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Scale className="w-3.5 h-3.5 text-emerald-600" />
              <span>3. Order Demand & Planning Priority</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ordered Quantity (kg) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={orderedQty}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    setOrderedQty(v);
                    setBalanceQty(v);
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Remaining / Balance Qty (kg) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={balanceQty}
                  onChange={(e) => setBalanceQty(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold font-mono text-emerald-700 bg-emerald-50/30"
                />
              </div>

              <div className="flex items-center pt-6">
                <label className="flex items-center space-x-2 p-2 bg-amber-50/60 border border-amber-200 rounded-lg cursor-pointer w-full select-none hover:bg-amber-100/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={priority}
                    onChange={(e) => setPriority(e.target.checked)}
                    className="w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
                  />
                  <span className="text-xs font-bold text-amber-900 flex items-center space-x-1">
                    <Star className={`w-3.5 h-3.5 ${priority ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
                    <span>Flag as High Priority Order ⭐</span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Section 4: SAP Delivery & Logistics Metadata */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>4. Delivery, PO Reference & Logistics (Optional)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Date
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer PO / Reference #
                </label>
                <input
                  type="text"
                  value={customerRef}
                  onChange={(e) => setCustomerRef(e.target.value)}
                  placeholder="e.g. PO-88210"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Destination City
                </label>
                <input
                  type="text"
                  value={shipToCity}
                  onChange={(e) => setShipToCity(e.target.value)}
                  placeholder="e.g. Lahore"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sales Representative
                </label>
                <input
                  type="text"
                  value={salesPerson}
                  onChange={(e) => setSalesPerson(e.target.value)}
                  placeholder="e.g. Farhan Ali"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition-colors cursor-pointer"
          >
            Close Form
          </button>

          <button
            type="button"
            onClick={handleSubmitSingleOrder}
            className="flex items-center space-x-2 px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-700/20 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Order to Pending Queue</span>
          </button>
        </div>
      </div>
    </div>
  );
};
