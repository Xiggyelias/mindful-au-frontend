import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Radio,
  Search,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Shield,
  Clock,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface AssignedStudentItem {
  session_id: number;
  student_id: number;
  student_name: string;
  is_anonymous: boolean;
  status: string;
  spatial_lounge_active: boolean;
  requested_at?: string | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
}

interface PeerStudentLinkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignedStudents: AssignedStudentItem[];
  currentSessionId: string | null;
  isLoading: boolean;
  onSelectStudent: (student: AssignedStudentItem) => void;
  onRefresh: () => void;
}

export const PeerStudentLinkerModal: React.FC<PeerStudentLinkerModalProps> = ({
  isOpen,
  onClose,
  assignedStudents,
  currentSessionId,
  isLoading,
  onSelectStudent,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = assignedStudents.filter((s) =>
    s.student_name.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[540px] bg-slate-950 border border-emerald-500/30 text-white shadow-2xl">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-emerald-400">
              <Users className="w-5 h-5 text-emerald-400" />
              Link Assigned Student to Meadow
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh assigned students list"
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-900"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-emerald-400" : ""}`} />
            </Button>
          </div>
          <DialogDescription className="text-xs text-slate-400">
            Choose which assigned student you want to talk with in the private 1-on-1 Spatial Audio Meadow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Search bar */}
          {assignedStudents.length > 3 && (
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <Input
                placeholder="Search assigned students..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 bg-slate-900 border-slate-800 text-white text-xs placeholder:text-slate-500 rounded-xl"
              />
            </div>
          )}

          {/* Student List */}
          <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
            {isLoading && assignedStudents.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
                <p className="text-xs text-slate-400">Fetching your assigned students...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 space-y-2">
                <Users className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-300">
                  {assignedStudents.length === 0 ? "No Active Assignments Found" : "No Matching Students"}
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {assignedStudents.length === 0
                    ? "Once a student is assigned to you in Peer Support, they will appear here so you can invite them into the Heart-to-Heart Meadow."
                    : "Try a different search query to find your student."}
                </p>
              </div>
            ) : (
              filtered.map((student) => {
                const isSelected = String(student.session_id) === String(currentSessionId);

                return (
                  <div
                    key={student.session_id}
                    className={`rounded-xl border p-3 transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? "bg-emerald-950/40 border-emerald-500/50 shadow-md shadow-emerald-950/20"
                        : "bg-slate-900/60 border-slate-800 hover:bg-slate-900 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 border ${
                          isSelected
                            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                            : "bg-slate-800 border-slate-700 text-slate-300"
                        }`}
                      >
                        {student.student_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-white truncate">
                            {student.student_name}
                          </p>
                          {student.is_anonymous && (
                            <span className="text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                              <Shield className="w-2.5 h-2.5" /> Anon
                            </span>
                          )}
                          {student.spatial_lounge_active && (
                            <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded-full flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Meadow Open
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                          <span className="capitalize">{student.status}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {student.updated_at
                              ? formatDistanceToNow(new Date(student.updated_at), { addSuffix: true })
                              : "Recently"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {isSelected ? (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Linked</span>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            onSelectStudent(student);
                            onClose();
                          }}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8 px-3 rounded-xl gap-1 shadow-sm font-semibold"
                        >
                          <span>Connect</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1 text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>1-on-1 Proximity Audio Lounge</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
