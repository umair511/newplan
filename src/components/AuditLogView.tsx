import React, { useState } from 'react';
import { AuditLogEntry } from '../types';
import { History, Search, ShieldCheck, Download, Trash2, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
  onClearLogs?: () => void;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs, onClearLogs }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  const filteredLogs = logs.filter(log => {
    if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        log.details.toLowerCase().includes(q) ||
        log.user_name.toLowerCase().includes(q) ||
        log.entity_id.toLowerCase().includes(q) ||
        log.entity_type.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const exportAuditLogs = () => {
    const ws = XLSX.utils.json_to_sheet(filteredLogs.map(l => ({
      Timestamp: l.timestamp,
      User: l.user_name,
      Role: l.user_role,
      Action: l.action,
      'Entity Type': l.entity_type,
      'Entity ID': l.entity_id,
      Details: l.details,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    XLSX.writeFile(wb, `Audit_Log_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <History className="w-5 h-5 text-emerald-600" />
            <span>Traceable Audit Log History</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable tracking of import batches, planning runs, plan approvals, and status transitions (SRS Section 89).
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={exportAuditLogs}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Audit Log</span>
          </button>
        </div>
      </div>

      {/* Filter & Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit trail..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50"
            />
          </div>

          <div className="flex items-center space-x-1 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
            <span className="text-slate-500 font-medium">Action:</span>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Actions</option>
              <option value="IMPORT">Import</option>
              <option value="PLAN_GENERATED">Plan Generated</option>
              <option value="APPROVE">Approve</option>
              <option value="STATUS_CHANGE">Status Change</option>
              <option value="UPDATE">Update</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">User</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Entity Type</th>
                <th className="py-2.5 px-3">Entity ID</th>
                <th className="py-2.5 px-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center font-sans text-slate-400">
                    No audit records match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="py-2.5 px-3 font-sans font-bold text-slate-800">
                      {log.user_name} <span className="text-[10px] text-slate-400 font-normal">({log.user_role})</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{log.entity_type}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">{log.entity_id}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-700 max-w-md">{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
