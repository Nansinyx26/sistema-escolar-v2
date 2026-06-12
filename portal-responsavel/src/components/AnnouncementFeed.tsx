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
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <RefreshCw className="animate-spin text-accent-primary" size={32} />
        <p className="text-zinc-500 animate-pulse">Buscando comunicados importantes...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-20">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-accent-primary/20 p-2 rounded-lg">
            <Megaphone className="text-accent-primary" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Comunicados Oficiais</h1>
            <p className="text-xs text-zinc-500">Acompanhe as novidades e avisos da escola</p>
          </div>
        </div>
        
        <button 
          onClick={loadFeed}
          className="p-2 hover:bg-white/5 rounded-full text-zinc-400 transition-colors"
          title="Recarregar"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-red-500 text-sm text-center">
          {error}
          <button onClick={loadFeed} className="block mx-auto mt-2 underline">Tentar novamente</button>
        </div>
      ) : comunicados.length === 0 ? (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-12 text-center">
          <div className="bg-zinc-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Megaphone className="text-zinc-600" size={32} />
          </div>
          <h2 className="text-white font-semibold mb-1">Nenhum comunicado</h2>
          <p className="text-zinc-500 text-sm">Você está em dia com todos os avisos da escola.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {comunicados.map(comunicado => (
            <AnnouncementCard key={comunicado._id} comunicado={comunicado} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AnnouncementFeed;
