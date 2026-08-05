import React, { useEffect, useCallback, useRef, useState } from 'react';
import { getHeatmapData, getBIInsights } from '../services/apiService';
import { useBI } from '../context/BIContext';
import { useTTS } from '../hooks/useTTS';
import VoiceOrb from '../components/VoiceOrb';
import styles from '../styles/portal.module.scss';
import biStyles from '../styles/BI.module.scss'; // New dedicated styles for BI skeletons
import Icon from '../components/ui/Icon';

const BI: React.FC = () => {
  const { heatmapData, insights, loading, error, lastFetched, setBIState } = useBI();
  const { isPlaying, isFetching: isTtsLoading, speak, stop, error: ttsError } = useTTS();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [activeVoiceTarget, setActiveVoiceTarget] = useState<'insights' | 'global' | null>(null);

  const fetchData = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && heatmapData.length > 0 && lastFetched && (now - lastFetched < 300000)) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setBIState({ loading: true, error: null });

    try {
      const [heatmap, aiInsights] = await Promise.all([
        getHeatmapData(),
        getBIInsights()
      ]);

      setBIState({
        heatmapData: heatmap,
        insights: aiInsights,
        loading: false,
        lastFetched: Date.now()
      });
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setBIState({ 
        loading: false, 
        error: 'Não foi possível carregar os dados do BI. Verifique sua conexão.' 
      });
    }
  }, [heatmapData.length, lastFetched, setBIState]);

  useEffect(() => {
    fetchData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  const handleVocalize = (target: 'insights' | 'global' = 'insights') => {
    if (isPlaying) {
      stop();
      setActiveVoiceTarget(null);
    } else if (insights?.sumario) {
      setActiveVoiceTarget(target);
      const cleanText = insights.sumario.replace(/\*\*/g, '');
      speak(cleanText);
    }
  };

  const renderHeatmapSkeleton = () => (
    <div className={biStyles.heatmapSkeleton}>
      <div className={biStyles.skeletonHeader} />
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className={biStyles.skeletonRow} />
      ))}
    </div>
  );

  const renderInsightsSkeleton = () => (
    <div className={biStyles.insightsSkeleton}>
      <div className={biStyles.skeletonLine} style={{ width: '90%' }} />
      <div className={biStyles.skeletonLine} style={{ width: '80%' }} />
      <div className={biStyles.skeletonLine} style={{ width: '85%' }} />
      <div className={biStyles.skeletonBadges}>
        <div className={biStyles.skeletonBadge} />
        <div className={biStyles.skeletonBadge} />
        <div className={biStyles.skeletonBadge} />
      </div>
    </div>
  );

  const renderHeatmap = () => {
    if (heatmapData.length === 0) return null;

    const materias = [...new Set(heatmapData.map(d => d.materia))].sort();
    const turmas = [...new Set(heatmapData.map(d => d.turma))].sort();

    return (
      <div className={styles.biGridWrapper}>
        <div 
          className={styles.heatmapGrid} 
          style={{ gridTemplateColumns: `140px repeat(${turmas.length}, 1fr)` }}
        >
          <div className={styles.matrixLabelCorner}></div>
          {turmas.map(t => (
            <div key={t} className={styles.matrixLabelH}>{t}</div>
          ))}

          {materias.map(m => (
            <React.Fragment key={m}>
              <div className={styles.matrixLabelV}>{m}</div>
              {turmas.map(tCode => {
                const entry = heatmapData.find(d => d.materia === m && d.turma === tCode);
                const media = entry ? parseFloat(entry.media) : 0;
                
                let bgColor = 'rgba(255,255,255,0.03)';
                if (media > 0) {
                  if (media < 5.0) bgColor = 'rgba(239, 68, 68, 0.4)';
                  else if (media < 7.5) bgColor = 'rgba(245, 158, 11, 0.4)';
                  else bgColor = 'rgba(16, 185, 129, 0.4)';
                }

                return (
                  <div 
                    key={`${m}-${tCode}`} 
                    className={styles.heatmapCell}
                    style={{ backgroundColor: bgColor }}
                  >
                    {media > 0 ? media.toFixed(1) : '-'}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.biPage}>
      <header className={styles.biHeader}>
        <h1>BI Pedagógico</h1>
        <div className={styles.biHeaderActions}>
          {ttsError && <span className={styles.ttsErrorHint}>{ttsError}</span>}
          <button onClick={() => fetchData(true)} disabled={loading} className={styles.refreshBtn}>
            <Icon name="refresh" spin={loading} />
            {loading ? 'Sincronizando...' : 'Atualizar Dados'}
          </button>
        </div>
      </header>

      {error && <div className={styles.biError}>{error}</div>}

      <div className={styles.biMainContent}>
        <section className={styles.heatmapSection}>
          <h2>Mapa de Calor de Desempenho</h2>
          {loading && heatmapData.length === 0 ? renderHeatmapSkeleton() : renderHeatmap()}
        </section>

        <section className={styles.insightsSection}>
          <div className={styles.insightsCard}>
            <div className={styles.insightsCardHeader}>
              <h3>Análise da IA</h3>
              <VoiceOrb 
                size="fab" 
                isPlaying={isPlaying && activeVoiceTarget === 'insights'} 
                isFetching={isTtsLoading && activeVoiceTarget === 'insights'}
                onClick={() => handleVocalize('insights')}
                title="Ouvir análise"
              />
            </div>
            
            {loading && !insights ? renderInsightsSkeleton() : (
              <div className={styles.insightsText}>
                {insights?.sumario.split('\n').map((para, i) => (
                  <p key={i}>{para.replace(/\*\*(.*?)\*\*/g, '$1')}</p>
                ))}
              </div>
            )}

            {insights && (
              <div className={styles.insightsBadges}>
                <div className={styles.badge}>
                  <Icon name="users" /> 
                  Total de Alunos: <strong>{insights.totalAlunos}</strong>
                </div>
                <div className={styles.badge}>
                  <Icon name="chart-bar" /> 
                  Média Global: <strong>{insights.mediaEscola}</strong>
                </div>
                <div className={styles.badge}>
                  <Icon name="alert-triangle" /> 
                  Alunos em Risco: <strong>{insights.alunosRisco}</strong>
                </div>
                <div className={styles.badge}>
                  <Icon name="alert-circle" /> 
                  Crítico: <strong>{insights.materiaCritica}</strong>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Floating Action Orb for Global Voice Interaction */}
      <div className={styles.biFloatingOrb}>
        <VoiceOrb 
          size="fab" 
          isGlobal={true}
          isPlaying={isPlaying && activeVoiceTarget === 'global'}
          isFetching={isTtsLoading && activeVoiceTarget === 'global'}
          onClick={() => handleVocalize('global')}
          title="Ouvir análise completa"
        />
      </div>
    </div>
  );
};

export default BI;
