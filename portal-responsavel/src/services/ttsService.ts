interface TTSState {
  isPlaying: boolean;
  isFetching: boolean;
  error: string | null;
}

class TTSService {
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private listeners: ((state: TTSState) => void)[] = [];
  private state: TTSState = { isPlaying: false, isFetching: false, error: null };

  constructor() {
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
      this.audio.onplay = () => this.updateState({ isPlaying: true });
      this.audio.onpause = () => this.updateState({ isPlaying: false });
      this.audio.onended = () => {
        this.updateState({ isPlaying: false });
        this.cleanupUrl();
      };
      this.audio.onerror = () => {
        this.updateState({ isPlaying: false, error: 'Erro ao reproduzir áudio' });
        this.cleanupUrl();
      };
    }
  }

  private cleanupUrl() {
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  private updateState(partial: Partial<TTSState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach(l => l(this.state));
  }

  subscribe(listener: (state: TTSState) => void) {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async play(text: string, _gender?: string, _provider?: string) {
    if (!this.audio) return;

    this.stop();
    this.updateState({ isFetching: true, error: null });

    // Sempre usa ElevenLabs via /api/tts/speak
    const voiceName = localStorage.getItem('user_elevenlabs_voice') || 'adam';

    try {
      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

      const response = await fetch('/api/tts/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ text, voiceId: voiceName, provider: 'elevenlabs' })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erro ${response.status}: Serviço indisponível`);
      }

      const contentType = response.headers.get('Content-Type') || 'audio/mpeg';
      const blob = await response.blob();
      const typedBlob = new Blob([blob], { type: contentType });
      
      console.log(`[TTS] Áudio recebido via ElevenLabs (voz: ${voiceName})`);
      
      this.cleanupUrl();
      this.audioUrl = URL.createObjectURL(typedBlob);
      this.audio.src = this.audioUrl;
      await this.audio.play();
      
      this.updateState({ isFetching: false });
    } catch (error: any) {
      console.error('[TTSService] Play error:', error);
      this.updateState({ 
        isFetching: false, 
        isPlaying: false, 
        error: error.message || 'Erro inesperado na síntese de voz' 
      });
    }
  }

  pause() {
    this.audio?.pause();
  }

  resume() {
    this.audio?.play();
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.cleanupUrl();
    this.updateState({ isPlaying: false, isFetching: false });
  }

  getState() {
    return this.state;
  }
}

export const ttsService = new TTSService();
