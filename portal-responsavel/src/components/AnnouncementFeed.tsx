import React, { useState, useEffect } from 'react';
import { Comunicado } from '../types';
import { getComunicados } from '../services/apiService';
import AnnouncementCard from './AnnouncementCard';
import { Megaphone, RefreshCw } from 'lucide-react';
import { socket } from '../services/socket';

const AnnouncementFeed: React.FC = () => {
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFeed();

    // Listen for new announcements in real-time
    socket.on('comunicado:new', (data: Comunicado | { comunicado: Comunicado }) => {
      const comunicado = 'comunicado' in data ? data.comunicado : data;
      if (!comunicado?._id) return;
      setComunicados(prev => {
        if (prev.some(c => c._id === comunicado._id)) return prev;
        return [comunicado, ...prev];
      });
    });

    socket.on('comunicado:remove', (data: { id: string }) => {
      setComunicados(prev => prev.filter(c => c._id !== data.id));
    });

    return () => {
      socket.off('comunicado:new');
      socket.off('comunicado:remove');
    };
  }, []);

  const loadFeed = async () => {
    try {
      setLoading(true);
      const data = await getComunicados();
      setComunicados(data);
      setError(null);
    } catch (err: any) {
      setError('Não foi possível carregar o feed de comunicados.');
    } finally {
      setLoading(false);
    }
  };

  if (loading && comunicados.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '16px' }}>
        <RefreshCw style={{ animation: 'spin 1s linear infinite', color: '#00d4ff' }} size={32} />
        <p style={{ color: '#71717a', fontSize: '0.875rem' }}>Buscando comunicados importantes...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '768px', margin: '0 auto', padding: '0 16px 80px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'rgba(0, 212, 255, 0.15)',
            border: '1px solid rgba(0, 212, 255, 0.25)',
            padding: '10px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Megaphone color="#00d4ff" size={22} />
          </div>
          <div>
            <h1 style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#f5f5f5',
              margin: 0,
              lineHeight: 1.3,
            }}>
              Comunicados Oficiais
            </h1>
            <p style={{ fontSize: '0.75rem', color: '#a0a0a0', margin: 0, marginTop: '2px' }}>
              Acompanhe as novidades e avisos da escola
            </p>
          </div>
        </div>

        <button
          onClick={loadFeed}
          style={{
            padding: '8px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#a0a0a0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s, color 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,212,255,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = '#00d4ff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = '#a0a0a0'; }}
          title="Recarregar"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {error ? (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          padding: '16px',
          borderRadius: '12px',
          color: '#ef4444',
          fontSize: '0.875rem',
          textAlign: 'center',
        }}>
          {error}
          <button onClick={loadFeed} style={{ display: 'block', margin: '8px auto 0', textDecoration: 'underline', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.875rem' }}>
            Tentar novamente
          </button>
        </div>
      ) : comunicados.length === 0 ? (
        <div style={{
          background: 'rgba(24, 24, 27, 0.5)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '16px',
          padding: '48px',
          textAlign: 'center',
        }}>
          <div style={{
            background: 'rgba(39, 39, 42, 0.8)',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Megaphone color="#52525b" size={32} />
          </div>
          <h2 style={{ color: '#f5f5f5', fontWeight: 600, marginBottom: '4px', fontSize: '1rem' }}>Nenhum comunicado</h2>
          <p style={{ color: '#71717a', fontSize: '0.875rem', margin: 0 }}>Você está em dia com todos os avisos da escola.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {comunicados.map(comunicado => (
            <AnnouncementCard key={comunicado._id} comunicado={comunicado} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AnnouncementFeed;
