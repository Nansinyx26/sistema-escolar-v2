import { useState, useEffect, useCallback } from 'react';
import { ttsService } from '../services/ttsService';

export function useTTS() {
  const [state, setState] = useState(ttsService.getState());

  useEffect(() => {
    return ttsService.subscribe(newState => setState(newState));
  }, []);

  const speak = useCallback(async (text: string, gender?: string, provider?: string) => {
    try {
      console.log(`[Voice] Speaking with ${provider || 'default'} IA (${gender || 'default'}): "${text.substring(0, 50)}..."`);
      await ttsService.play(text, gender, provider);
    } catch (err) {
      console.error('[useTTS] speak error:', err);
    }
  }, []);

  const stop = useCallback(() => {
    ttsService.stop();
  }, []);

  const pause = useCallback(() => {
    ttsService.pause();
  }, []);

  const resume = useCallback(() => {
    ttsService.resume();
  }, []);

  return {
    isPlaying: state.isPlaying,
    isFetching: state.isFetching,
    error: state.error,
    speak,
    stop,
    pause,
    resume
  };
}
