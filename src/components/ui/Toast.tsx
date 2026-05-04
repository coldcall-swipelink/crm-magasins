'use client';
// src/components/ui/Toast.tsx
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: string; message: string; type: ToastType; }

const ToastCtx = createContext<{
  show: (message: string, type?: ToastType) => void;
}>({ show: () => {} });

export function useToast() { return useContext(ToastCtx); }

let globalShow: ((message: string, type?: ToastType) => void) | null = null;
export function toast(message: string, type: ToastType = 'success') {
  globalShow?.(message, type);
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  useEffect(() => { globalShow = show; return () => { globalShow = null; }; }, [show]);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastCtx.Provider value={{ show }}>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`toast-enter flex items-start gap-3 max-w-sm px-4 py-3 rounded-xl shadow-lg border pointer-events-auto text-sm font-medium
              ${t.type === 'success' ? 'bg-green-900 border-green-700 text-green-100' :
                t.type === 'error'   ? 'bg-red-900 border-red-700 text-red-100' :
                                       'bg-slate-800 border-slate-600 text-white'}`}
          >
            {t.type === 'success' ? <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-green-400" /> :
             t.type === 'error'   ? <AlertCircle  size={16} className="flex-shrink-0 mt-0.5 text-red-400"   /> : null}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100 flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
