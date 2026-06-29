import React, { createContext, useContext, useState, useCallback } from 'react';
import { HeatmapEntry, BIInsights } from '../types';

interface BIContextData {
  heatmapData: HeatmapEntry[];
  insights: BIInsights | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  setBIState: (newState: Partial<BIContextData>) => void;
  resetBI: () => void;
}

const BIContext = createContext<BIContextData | undefined>(undefined);

export const BIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<Omit<BIContextData, 'setBIState' | 'resetBI'>>({
    heatmapData: [],
    insights: null,
    loading: false,
    error: null,
    lastFetched: null,
  });

  const setBIState = useCallback((newState: Partial<BIContextData>) => {
    setState(prev => ({ ...prev, ...newState }));
  }, []);

  const resetBI = useCallback(() => {
    setState({
      heatmapData: [],
      insights: null,
      loading: false,
      error: null,
      lastFetched: null,
    });
  }, []);

  return (
    <BIContext.Provider value={{ ...state, setBIState, resetBI }}>
      {children}
    </BIContext.Provider>
  );
};

export const useBI = () => {
  const context = useContext(BIContext);
  if (!context) {
    throw new Error('useBI must be used within a BIProvider');
  }
  return context;
};
