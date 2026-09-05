import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, X } from 'lucide-react'

type ToastItem = { id: number; type: 'success' | 'error'; message: string }
type ToastContextValue = { success: (message: string) => void; error: (message: string) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500)
  }, [])

  const value: ToastContextValue = {
    success: (message) => push('success', message),
    error: (message) => push('error', message),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border bg-panel px-3.5 py-2.5 text-sm shadow-lg transition-opacity ${
              t.type === 'success' ? 'border-available/40' : 'border-alert/40'
            }`}
          >
            {t.type === 'success' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-available" />
            ) : (
              <XCircle size={16} className="mt-0.5 shrink-0 text-alert" />
            )}
            <span className="text-cream">{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-auto shrink-0 text-muted hover:text-cream"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast tiene que usarse adentro de <ToastProvider>')
  return ctx
}
