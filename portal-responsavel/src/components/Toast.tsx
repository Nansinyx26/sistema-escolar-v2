import React, { useEffect } from 'react';
import styles from '../styles/portal.module.scss';

export interface ToastData {
  message: string;
  type: 'success' | 'error';
}

interface ToastProps {
  toast: ToastData | null;
  onClose: () => void;
  /** ms até fechar sozinho (0 = não fecha) */
  autoDismiss?: number;
}

/**
 * Toast único do portal — substitui os blocos inline duplicados que
 * referenciavam um keyframe "slideIn" inexistente (a animação nunca rodava).
 */
const Toast: React.FC<ToastProps> = ({ toast, onClose, autoDismiss = 4000 }) => {
  useEffect(() => {
    if (!toast || !autoDismiss) return;
    const t = setTimeout(onClose, autoDismiss);
    return () => clearTimeout(t);
  }, [toast, autoDismiss, onClose]);

  if (!toast) return null;

  return (
    <div
      className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}
      role="status"
      aria-live="polite"
    >
      <i className={`ti ${toast.type === 'success' ? 'ti-check' : 'ti-alert-circle'}`} aria-hidden="true" />
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso">×</button>
    </div>
  );
};

export default Toast;
