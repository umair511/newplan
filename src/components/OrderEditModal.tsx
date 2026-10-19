import React, { useState, useEffect } from 'react';
import { VA05Order, UserProfile } from '../types';
import { FILM_MASTERS } from '../services/masterData';
import { calculateSingleReelWeight } from '../services/weightCalculator';
import { 
  X, 
  Save, 
  Trash2, 
  AlertTriangle, 
  Calculator, 
  Layers, 
  FileText, 
  User, 
  Calendar, 
  MapPin, 
  CreditCard 
} from 'lucide-react';

interface OrderEditModalProps {
  isOpen: boolean;
  order: VA05Order | null;
  currentUser: UserProfile;
  onClose: () => void;
  onSave: (updatedOrder: VA05Order) => void;
  onDelete: (orderId: string) => void;
}

export const OrderEditModal: React.FC<OrderEditModalProps> = ({
  isOpen,
  order,
  currentUser,
  onClose,
  onSave,
  onDelete,
}) => {
  const [formData, setFormData] = useState<Partial<VA05Order>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (order) {
      setFormData({ ...order });
      setShowDeleteConfirm(false);
    }
  }, [order]);

  if (!isOpen || !order) return null;

  const filmMaster = FILM_MASTERS.find(f => f.code === formData.film) || FILM_MASTERS[0];
  const thickness = formData.thickness_micron || filmMaster.thickness_micron;
  const density = formData.density || filmMaster.density;
  const width = formData.width_mm || 0;
  const length = formData.length_m || 0;

  const singleReelKg = width > 0 && length > 0 
    ? calculateSingleReelWeight(width, thickness, density, length) 
    : 0;

  const estimatedReels = singleReelKg > 0 && formData.remaining_qty 
    ? (formData.remaining_qty / singleReelKg).toFixed(1) 
    : '0';

  const handleChange = (field: keyof VA05Order, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // Auto update film parameters if film changes
      if (field === 'film') {
        const matched = FILM_MASTERS.find(f => f.code === value);
        if (matched) {
          updated.material = value;
          updated.thickness_micron = matched.thickness_micron;
          updated.density = matched.density;
        }
      }

      // If ordered_qty changes and remaining wasn't manually touched, update remaining
      if (field === 'ordered_qty') {
        const num = parseFloat(value) || 0;
        updated.ordered_qty = num;
        if (!prev.produced_qty || prev.produced_qty === 0) {
          updated.balance_qty = num;
          updated.remaining_qty = num;
        }
      }

      return updated;
    });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sales_order || !formData.customer || !formData.film || !formData.width_mm) {
      alert('Please fill in required fields: Sales Order, Customer, Film, and Width.');
      return;
    }

    const updated: VA05Order = {
      ...order,
      sales_order: String(formData.sales_order).trim(),
      item_number: Number(formData.item_number) || 10,
      customer: String(formData.customer).trim(),
      customer_reference: formData.customer_reference || '',
      material: String(formData.material || formData.film).trim(),
      film: String(formData.film).trim(),
      material_description: formData.material_description || `${formData.film} BOPP Film ${thickness}µ`,
      width_mm: Number(formData.width_mm) || 0,
      length_m: Number(formData.length_m) || 0,
      thickness_micron: Number(thickness) || 20,
      density: Number(density) || 0.91,
      core: (Number(formData.core) === 6 ? 6 : 3) as 3 | 6,
      treatment_side: (formData.treatment_side || 'OS') as 'OS' | 'IS' | 'Both' | 'None',
      ordered_qty: Number(formData.ordered_qty) || 0,
      balance_qty: Number(formData.balance_qty !== undefined ? formData.balance_qty : formData.ordered_qty) || 0,
      remaining_qty: Number(formData.remaining_qty !== undefined ? formData.remaining_qty : formData.balance_qty) || 0,
      produced_qty: Number(formData.produced_qty) || 0,
      plant: String(formData.plant || '3100'),
      priority: Boolean(formData.priority),
      status: (formData.status || 'PENDING') as any,
      delivery_date: formData.delivery_date || '',
      ship_to_city: formData.ship_to_city || '',
      sales_person: formData.sales_person || '',
      payment_term: formData.payment_term || '',
      updated_at: new Date().toISOString(),
    };

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Edit Order Line</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  SO# {formData.sales_order} / Item {formData.item_number}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Update order quantities, roll dimensions, customer reference, and priority flags
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Delete Confirmation Alert if triggered */}
        {showDeleteConfirm && (
          <div className="p-4 bg-rose-50 border-b border-rose-200 flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-rose-900">
              <p className="font-bold">Are you sure you want to permanently delete this order line?</p>
              <p className="mt-0.5 text-rose-700">
                SO# {formData.sales_order} - Item #{formData.item_number} ({formData.customer}) · {formData.width_mm}mm × {formData.length_m}m ({formData.remaining_qty} kg) will be removed from the active planning dataset.
              </p>
              <div className="flex items-center space-x-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(order.id);
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-md shadow-xs transition-colors cursor-pointer"
                >
                  Confirm Delete Order
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="p-6 space-y-6">
          {/* Real-time calculated banner */}
          <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-950">
            <div className="flex items-center space-x-2">
              <Calculator className="w-4 h-4 text-emerald-700" />
              <span>
                Single Reel Weight: <strong className="font-mono text-emerald-900">{singleReelKg.toFixed(2)} kg</strong>
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span>
                Est. Reels Required: <strong className="font-mono text-emerald-900">{estimatedReels} reels</strong>
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <label className="flex items-center space-x-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(formData.priority)}
                  onChange={(e) => handleChange('priority', e.target.checked)}
                  className="w-4 h-4 text-amber-500 rounded border-slate-300 focus:ring-amber-400"
                />
                <span className="font-bold text-amber-900 flex items-center space-x-1">
                  <span>⭐ Priority Order Line</span>
                </span>
              </label>
            </div>
          </div>

          {/* Section 1: Sales Order & Customer Details */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span>Sales Order & Customer Info</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Sales Order # <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.sales_order || ''}
                  onChange={(e) => handleChange('sales_order', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Item # <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  value={formData.item_number || 10}
                  onChange={(e) => handleChange('item_number', parseInt(e.target.value) || 10)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Customer PO / Reference
                </label>
                <input
                  type="text"
                  value={formData.customer_reference || ''}
                  onChange={(e) => handleChange('customer_reference', e.target.value)}
                  placeholder="e.g. PO 3910 or WhatsApp"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Customer Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.customer || ''}
                  onChange={(e) => handleChange('customer', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Order Status
                </label>
                <select
                  value={formData.status || 'PENDING'}
                  onChange={(e) => handleChange('status', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white"
                >
                  <option value="PENDING">PENDING</option>
                  <option value="PARTIALLY_FULFILLED">PARTIALLY_FULFILLED</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Material & Technical Specifications */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>Material & Physical Dimensions</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Film Family <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.film || 'TNO20'}
                  onChange={(e) => handleChange('film', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-bold text-slate-900 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white"
                >
                  {FILM_MASTERS.map(f => (
                    <option key={f.code} value={f.code}>{f.code} ({f.thickness_micron}µ)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Width (mm) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="50"
                  max="3500"
                  value={formData.width_mm || ''}
                  onChange={(e) => handleChange('width_mm', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Length (m) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  step="250"
                  min="500"
                  max="50000"
                  value={formData.length_m || ''}
                  onChange={(e) => handleChange('length_m', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Core & Treatment
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={formData.core || 3}
                    onChange={(e) => handleChange('core', parseInt(e.target.value))}
                    className="w-full px-2 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white"
                  >
                    <option value={3}>3"</option>
                    <option value={6}>6"</option>
                  </select>
                  <select
                    value={formData.treatment_side || 'OS'}
                    onChange={(e) => handleChange('treatment_side', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="OS">OS</option>
                    <option value="IS">IS</option>
                    <option value="Both">Both</option>
                    <option value="None">None</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Quantities & Weight Demands */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Calculator className="w-3.5 h-3.5 text-slate-500" />
              <span>Quantities & Weights (KG)</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Ordered Qty (kg) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.ordered_qty || ''}
                  onChange={(e) => handleChange('ordered_qty', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Balance Qty (kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.balance_qty || ''}
                  onChange={(e) => handleChange('balance_qty', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Remaining Demand (kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.remaining_qty !== undefined ? formData.remaining_qty : ''}
                  onChange={(e) => handleChange('remaining_qty', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold text-emerald-800 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Produced Qty (kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.produced_qty || 0}
                  onChange={(e) => handleChange('produced_qty', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Logistics & Sales Info */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-500" />
              <span>Logistics & Commercial</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Delivery Date
                </label>
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  value={formData.delivery_date || ''}
                  onChange={(e) => handleChange('delivery_date', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Ship-to City
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lahore, Karachi"
                  value={formData.ship_to_city || ''}
                  onChange={(e) => handleChange('ship_to_city', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Sales Person
                </label>
                <input
                  type="text"
                  placeholder="Sales Representative"
                  value={formData.sales_person || ''}
                  onChange={(e) => handleChange('sales_person', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Payment Terms
                </label>
                <input
                  type="text"
                  placeholder="e.g. Net 30 Days"
                  value={formData.payment_term || ''}
                  onChange={(e) => handleChange('payment_term', e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Modal Footer Controls */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Order Line</span>
            </button>

            <div className="flex items-center space-x-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center space-x-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
