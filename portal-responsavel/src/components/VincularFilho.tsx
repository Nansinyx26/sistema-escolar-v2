import { useState } from 'react';
import { vincularAluno } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface VincularFilhoProps {
  onSuccess: () => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

interface LinkedStudentData {
  id?: string;
  nome: string;
  matricula: string;
  turma: string;
  jaVinculado?: boolean;
}

export default function VincularFilho({ onSuccess, onCancel, canCancel = false }: VincularFilhoProps) {
  const [codigoSecreto, setCodigoSecreto] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [foundStudent, setFoundStudent] = useState<LinkedStudentData | null>(null);
  const [step, setStep] = useState<'SEARCH' | 'CONFIRM' | 'SUCCESS'>('SEARCH');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codigoSecreto.trim().length < 4) {
      setError('Por favor, insira o código secreto completo.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { buscarAlunoPorCodigoSecreto } = await import('../services/apiService');
      const res: any = await buscarAlunoPorCodigoSecreto(codigoSecreto.toUpperCase());
      
      if (res && res.data) {
        setFoundStudent({
          id: res.data.id,
          nome: res.data.nome,
          matricula: res.data.matricula || '-',
          turma: res.data.turma || '-',
          jaVinculado: res.data.jaVinculado
        });
        setStep('CONFIRM');
      }
    } catch (err: any) {
      setError(err.message || 'Estudante não encontrado. Verifique o código e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError('');

    try {
      await vincularAluno(codigoSecreto.toUpperCase());
      setStep('SUCCESS');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erro ao realizar o vínculo. Tente novamente mais tarde.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (val.length <= 10) { // allow more than 6 just in case, but usually 6
      setCodigoSecreto(val);
      setError('');
    }
  };

  if (step === 'SUCCESS' && foundStudent) {
    return (
      <div className={styles.vincularContainer} style={{ minHeight: 'auto', padding: '20px 0' }}>
        <div className={styles.vincularCard} style={{ textAlign: 'center', animation: 'scaleUp 0.3s ease-out' }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(34, 197, 94, 0.1)',
            border: '2px solid #22c55e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            color: '#22c55e',
            fontSize: '2.5rem',
            boxShadow: '0 0 20px rgba(34, 197, 94, 0.2)'
          }}>
            <Icon name="circle-check" />
          </div>
          
          <h2 style={{ color: '#22c55e', justifyContent: 'center', marginBottom: '12px' }}>
            Vínculo Realizado!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '24px' }}>
            O estudante foi vinculado com sucesso à sua conta de responsável.
          </p>

          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '28px',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #10b981, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700
              }}>
                {foundStudent.nome.charAt(0)}
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#fff' }}>{foundStudent.nome}</h4>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Estudante Cadastrado</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '24px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: '#64748b', display: 'block', marginBottom: '2px' }}>Turma</span>
                <strong style={{ color: '#fff' }}>{foundStudent.turma}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b', display: 'block', marginBottom: '2px' }}>Matrícula (RA)</span>
                <strong style={{ color: '#fff' }}>{foundStudent.matricula}</strong>
              </div>
            </div>
          </div>

          <button
            onClick={onCancel}
            className={styles.submitBtn}
            style={{
              background: 'linear-gradient(135deg, #10b981, #8b5cf6)',
              border: 'none',
              fontWeight: 700
            }}
          >
            Voltar ao Painel Geral
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.vincularContainer} style={{ minHeight: 'auto', padding: '20px 0' }}>
      <div className={styles.vincularCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          <h2>
            <Icon name={step === 'CONFIRM' ? "user-check" : "user-plus"} aria-hidden="true" />
            {step === 'CONFIRM' ? 'Confirmar Estudante' : 'Vincular meu filho'}
          </h2>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#10b981',
            padding: '6px 12px',
            borderRadius: '20px',
            fontSize: '0.75rem',
            fontWeight: 600
          }}>
            <Icon name="shield-lock" style={{ fontSize: '0.85rem' }} />
            Segurança Ativa
          </div>
        </div>

        {step === 'SEARCH' ? (
          <>
            <p>
              Insira o código secreto de 6 caracteres do seu filho fornecido pela secretaria da escola para vinculá-lo com segurança à sua conta.
            </p>

            {error && (
              <div style={{
                marginBottom: '20px',
                padding: '12px 16px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem'
              }} role="alert">
                <Icon name="alert-circle" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className={styles.formGroup} style={{ alignItems: 'center' }}>
                <label className={styles.formLabel} style={{ marginBottom: '8px', textAlign: 'center', width: '100%' }}>
                  Código Secreto do Estudante
                </label>
                
                <div style={{ position: 'relative', width: '100%', maxWidth: '240px' }}>
                  <input
                    type="text"
                    value={codigoSecreto}
                    onChange={handleInputChange}
                    placeholder="------"
                    maxLength={10}
                    style={{
                      width: '100%',
                      height: '56px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '2px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '12px',
                      color: '#fff',
                      fontSize: '1.8rem',
                      fontWeight: 700,
                      letterSpacing: '8px',
                      textAlign: 'center',
                      textTransform: 'uppercase',
                      fontFamily: 'monospace',
                      transition: 'all 0.3s ease',
                      outline: 'none',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
                    }}
                    className="code-input-focus"
                    autoFocus
                  />
                </div>
                
                <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                  O código diferencia letras maiúsculas e minúsculas.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                {canCancel && (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={onCancel}
                    style={{ flex: 1, height: '48px' }}
                  >
                    Cancelar
                  </button>
                )}
                
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={loading || codigoSecreto.length < 4}
                  style={{
                    flex: 2,
                    height: '48px',
                    margin: 0,
                    background: (loading || codigoSecreto.length < 4) ? 'rgba(255, 255, 255, 0.08)' : 'linear-gradient(135deg, #10b981, #8b5cf6)',
                    border: 'none',
                    fontWeight: 700
                  }}
                >
                  {loading ? (
                    <>
                      <span className={styles.spinnerSm} />
                      Buscando...
                    </>
                  ) : (
                    <>
                      <Icon name="search" />
                      Pesquisar Estudante
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p>
              Estudante localizado! Por favor, confirme se os dados abaixo correspondem ao seu filho(a) antes de finalizar o vínculo.
            </p>

            <div style={{
              background: 'rgba(16, 185, 129, 0.05)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '24px',
              textAlign: 'center',
              animation: 'fadeIn 0.3s ease-out'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #10b981, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                color: '#fff',
                fontSize: '1.5rem',
                fontWeight: 700,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }}>
                {foundStudent?.nome.charAt(0)}
              </div>
              
              <h3 style={{ fontSize: '1.4rem', color: '#fff', margin: '0 0 8px' }}>
                {foundStudent?.nome}
              </h3>
              
              <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', color: '#94a3b8', fontSize: '0.9rem' }}>
                <span>Turma: <strong style={{ color: '#fff' }}>{foundStudent?.turma}</strong></span>
                <span>Matrícula: <strong style={{ color: '#fff' }}>{foundStudent?.matricula}</strong></span>
              </div>

              {foundStudent?.jaVinculado && (
                <div style={{
                  marginTop: '16px',
                  padding: '8px 12px',
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  borderRadius: '8px',
                  color: '#eab308',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}>
                  <Icon name="alert-triangle" />
                  Este aluno já possui um responsável vinculado.
                </div>
              )}
            </div>

            {error && (
              <div style={{
                marginBottom: '20px',
                padding: '12px 16px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                color: '#ef4444',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Icon name="alert-circle" />
                <span>{error}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setStep('SEARCH')}
                className={styles.actionBtn}
                style={{ flex: 1, height: '48px' }}
                disabled={loading}
              >
                Voltar
              </button>
              
              <button
                onClick={handleConfirm}
                className={styles.submitBtn}
                disabled={loading}
                style={{
                  flex: 2,
                  height: '48px',
                  margin: 0,
                  background: 'linear-gradient(135deg, #22c55e, #10b981)',
                  border: 'none',
                  fontWeight: 700
                }}
              >
                {loading ? (
                  <>
                    <span className={styles.spinnerSm} />
                    Vinculando...
                  </>
                ) : (
                  <>
                    <Icon name="user-check" />
                    Confirmar Vínculo
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
