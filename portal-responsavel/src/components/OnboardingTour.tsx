/**
 * OnboardingTour — Tour guiado interativo para o Portal do Responsável
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { updateTutorial } from '../services/apiService';

export interface TourStep {
  target?: string;
  title: string;
  content: string;
}

interface Props {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
}

const OnboardingTour: React.FC<Props> = ({ steps, onComplete, onSkip }) => {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const updateSpotlight = useCallback(() => {
    const target = steps[step]?.target;
    if (target) {
      const el = document.querySelector(target) as HTMLElement;
      if (el) {
        // Tenta abrir sidebar se o elemento estiver dentro dela
        const sidebar = el.closest('[data-tour="sidebar"]');
        if (sidebar && sidebar.clientWidth === 0) {
           // Lógica para abrir sidebar se necessário (depende da implementação do menu)
        }

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Aguarda animação de scroll
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setRect(el.getBoundingClientRect());
          setVisible(true);
        }, 400);
        return;
      }
    }
    setRect(null);
    setVisible(true);
  }, [step, steps]);

  useEffect(() => {
    setVisible(false);
    updateSpotlight();
    window.addEventListener('resize', updateSpotlight);
    return () => {
      window.removeEventListener('resize', updateSpotlight);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [updateSpotlight]);

  const persistAndClose = async (callback: () => void, save: boolean) => {
    if (saving) return;
    if (save) {
      setSaving(true);
      try {
        await updateTutorial({ tutorialResponsavelConcluido: true });
        callback();
      } catch (e) {
        console.error('Erro ao salvar tour:', e);
        alert('Não foi possível salvar a conclusão do tour.');
      } finally {
        setSaving(false);
      }
    } else {
      callback();
    }
  };

  const finish = () => persistAndClose(onComplete, true);
  const skip = () => persistAndClose(onSkip, false);

  const current = steps[step];
  const isLast = step === steps.length - 1;

  // Calculo de posicionamento inteligente
  const getPopupStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 10002,
      background: '#18181b',
      border: '1px solid rgba(16, 185, 129, 0.3)',
      borderRadius: '16px',
      padding: '1.5rem',
      maxWidth: '360px',
      width: 'calc(100vw - 2rem)',
      boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
      fontFamily: 'Inter, sans-serif',
      transition: 'all 0.3s ease',
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateY(10px)',
    };

    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const isMobile = window.innerWidth < 768;

      if (isMobile) {
        base.left = '1rem';
        base.width = 'calc(100vw - 2rem)';
        base.top = spaceBelow > 260 ? rect.bottom + 20 : window.innerHeight - 280;
      } else {
        base.left = Math.min(Math.max(rect.left, 20), window.innerWidth - 380);
        base.top = spaceBelow > 260 ? rect.bottom + 20 : rect.top - 260;
      }
    } else {
      base.left = '50%';
      base.top = '50%';
      base.transform = `translate(-50%, -50%) ${visible ? '' : 'translateY(10px)'}`;
    }

    return base;
  };

  return (
    <>
      <div 
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, transition: 'opacity 0.3s ease' }} 
        onClick={skip} 
      />
      
      {rect && (
        <div style={{
          position: 'fixed',
          left: rect.left - 10,
          top: rect.top - 10,
          width: rect.width + 20,
          height: rect.height + 20,
          borderRadius: '12px',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.8), 0 0 20px rgba(16, 185, 129, 0.3)',
          zIndex: 10001,
          pointerEvents: 'none',
          border: '3px solid #10b981',
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      )}

      <div style={getPopupStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '99px' }}>
            Etapa {step + 1} de {steps.length}
          </div>
          <button onClick={skip} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
        </div>

        <h3 style={{ color: '#fff', marginBottom: '0.75rem', fontSize: '1.1rem', fontWeight: 700 }}>{current.title}</h3>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>{current.content}</p>
        
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={btnSecondary}>Voltar</button>
          )}
          <button onClick={skip} style={btnSecondary} disabled={saving}>Pular</button>
          {isLast ? (
            <button onClick={finish} style={btnPrimary} disabled={saving}>{saving ? 'Salvando...' : 'Finalizar'}</button>
          ) : (
            <button onClick={() => setStep(s => s + 1)} style={btnPrimary} disabled={saving}>Próximo</button>
          )}
        </div>
      </div>
    </>
  );
};

const btnPrimary: React.CSSProperties = {
  padding: '0.6rem 1.25rem', background: '#10b981', color: '#fff',
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
  boxShadow: '0 10px 20px rgba(16,185,129,0.2)',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.05)', color: '#fff',
  border: '1px solid #27272a', borderRadius: '10px', cursor: 'pointer', fontSize: '0.85rem',
};

export const RESPONSAVEL_TOUR_STEPS: TourStep[] = [
  { title: 'Boas-vindas ao Portal', content: 'Este é o portal do responsável. Aqui você acompanha notas, frequência e comunicados da escola. O tour possui 7 etapas.' },
  { target: '[data-tour="sidebar"]', title: 'Menu de Navegação', content: 'Use o menu lateral para navegar entre as seções: painel, perfil, notificações e configurações.' },
  { target: '[data-tour="summary-cards"]', title: 'Cards de Resumo', content: 'Visualize rapidamente a média geral, frequência e notificações pendentes do aluno.' },
  { target: '[data-tour="notes"]', title: 'Notas por Matéria', content: 'Acompanhe o desempenho em cada disciplina com barras de progresso visuais.' },
  { target: '[data-tour="notifications"]', title: 'Notificações', content: 'O sino indica comunicados da escola. O indicador verde mostra novidades não lidas.' },
  { target: '[data-tour="profile"]', title: 'Perfil e Dados', content: 'Atualize telefone, WhatsApp, e-mail e dados pessoais no menu de perfil.' },
  { title: 'Tutorial Concluído!', content: 'Você está pronto para usar o portal. Boas-vindas!' },
];

export default OnboardingTour;
