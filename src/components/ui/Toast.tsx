'use client';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: string; message: string; type: ToastType; }
const ToastCtx = createContext<{ show: (message: string, type?: ToastType) => void }>({ show: () => {} });
export function useToast() { return useContext(ToastCtx); }

let globalShow: ((message: string, type?: ToastType) => void) | null = null;
export function toast(message: string, type: ToastType = 'success') { globalShow?.(message, type); }

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  useEffect(() => { globalShow = show; return () => { globalShow = null; }; }, [show]);
  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastCtx.Provider value={{ show }}>
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '11px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            maxWidth: 380, pointerEvents: 'auto',
            background: t.type === 'success' ? '#14532d' : t.type === 'error' ? '#7f1d1d' : '#1e293b',
            border: `1px solid ${t.type === 'success' ? '#16a34a' : t.type === 'error' ? '#dc2626' : '#334155'}`,
            color: t.type === 'success' ? '#86efac' : t.type === 'error' ? '#fca5a5' : '#fff',
            boxShadow: '0 4px 20px rgba(0,0,0,.3)',
          }}>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button onClick={() => dismiss(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: .7, padding: 0, fontSize: 16 }}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
