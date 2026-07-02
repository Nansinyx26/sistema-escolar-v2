/**
 * js/diagnostico-audio.js
 * Diagnóstico para Google Gemini TTS + ElevenLabs
 */

document.addEventListener('DOMContentLoaded', () => {
    initDiagnostics();
});

function initDiagnostics() {
    const logs      = document.getElementById('diagnostico-logs');
    const refreshBtn = document.getElementById('btn-refresh-status');
    const testBtn   = document.getElementById('btn-test-speak');
    const clearBtn  = document.getElementById('btn-clear-logs');

    // ── Logger ──────────────────────────────────────────────────────────────
    const addLog = (msg, type = 'info') => {
        const div = document.createElement('div');
        const now = new Date().toLocaleTimeString('pt-BR');
        div.textContent = `[${now}] [${type.toUpperCase()}] ${msg}`;
        const colors = { error: '#f87171', success: '#4ade80', warn: '#fbbf24', info: '#38bdf8' };
        div.style.color = colors[type] || '#38bdf8';
        logs.appendChild(div);
        logs.scrollTop = logs.scrollHeight;
    };

    // ── Helper: atualiza um bloco de status (gemini ou elevenlabs) ──────────
    const applyProviderStatus = (prefix, provStatus) => {
        const configEl = document.getElementById(`${prefix}-configured`);
        const connEl   = document.getElementById(`${prefix}-connection`);
        const errBox   = document.getElementById(`${prefix}-error-box`);

        const okDot   = '<span class="status-dot status-ok"></span>';
        const errDot  = '<span class="status-dot status-error"></span>';

        if (provStatus.configured) {
            configEl.innerHTML = `${okDot} Configurado <small style="color:#64748b">(${provStatus.apiKeyPrefix || ''})</small>`;
        } else {
            configEl.innerHTML = `${errDot} Não configurado`;
        }

        if (provStatus.connectionOk) {
            connEl.innerHTML = `${okDot} Online <small style="color:#64748b">(HTTP ${provStatus.httpStatus})</small>`;
        } else {
            connEl.innerHTML = `${errDot} ${provStatus.configured ? `Offline (HTTP ${provStatus.httpStatus || 'N/A'})` : 'Sem chave'}`;
        }

        if (provStatus.lastError) {
            errBox.style.display = 'block';
            errBox.textContent   = provStatus.lastError;
        } else {
            errBox.style.display = 'none';
        }
    };

    // ── Atualizar status dos dois provedores ────────────────────────────────
    const updateStatus = async () => {
        addLog('Verificando status dos provedores de voz...', 'info');

        try {
            const baseUrl = window.API_BASE_URL || '/api';
            const res = await fetch(`${baseUrl}/tts/status`, { credentials: 'include' });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status} — verifique se o backend está rodando na porta 3001`);
            }

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Resposta inesperada do servidor');

            const { google, eleven } = data.providers;

            // Google Cloud
            const googleStatus = { configured: google, connectionOk: google, httpStatus: google ? 200 : 'N/A' };
            applyProviderStatus('google', googleStatus);
            if (googleStatus.connectionOk) {
                addLog('✅ Google Cloud (Neural2): online e funcionando!', 'success');
            } else {
                addLog('❌ Google Cloud: GOOGLE_TTS_API_KEY não encontrada no backend/.env', google ? 'warn' : 'error');
            }

            // ElevenLabs
            const elevenStatus = { configured: eleven, connectionOk: eleven, httpStatus: eleven ? 200 : 'N/A' };
            applyProviderStatus('eleven', elevenStatus);
            if (elevenStatus.connectionOk) {
                addLog('✅ ElevenLabs: online e autenticado!', 'success');
            } else {
                addLog('ℹ️ ElevenLabs: ELEVENLABS_API_KEY não configurada (opcional)', 'info');
            }

            // Resumo final
            if (google || eleven) {
                addLog('✅ Sistema de voz operacional. Ao menos um provedor está ativo.', 'success');
            } else {
                addLog('❌ Nenhum provedor de voz disponível. Configure as chaves no backend/.env', 'error');
            }

        } catch (err) {
            addLog(`❌ Falha na verificação: ${err.message}`, 'error');
            // Mostra erro nos dois painéis
            ['google', 'eleven'].forEach(prefix => {
                const el = document.getElementById(`${prefix}-configured`);
                if (el) el.innerHTML = '<span class="status-dot status-error"></span> Erro de comunicação';
                const errBox = document.getElementById(`${prefix}-error-box`);
                if (errBox) { errBox.style.display = 'block'; errBox.textContent = err.message; }
            });
        }
    };

    // ── Teste de fala ───────────────────────────────────────────────────────
    const testSpeak = async () => {
        const text     = document.getElementById('test-text')?.value?.trim() || '';
        const gender   = 'male'; // Forçado como masculino conforme padrão do sistema
        const provider = document.getElementById('test-provider')?.value || 'auto';
        const speed    = parseFloat(document.getElementById('test-speed')?.value || '1.0');
        const resultEl = document.getElementById('test-result');

        if (text.length < 10) {
            addLog('⚠️ Digite pelo menos 10 caracteres para testar.', 'warn');
            return;
        }

        addLog(`▶️ Testando síntese — provider: ${provider}, gênero: ${gender}, speed: ${speed}x`, 'info');
        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="bi bi-hourglass-split mr-2"></i> PROCESSANDO...';
        if (resultEl) resultEl.style.display = 'none';

        try {
            const startTime = Date.now();
            const baseUrl   = window.API_BASE_URL || '/api';

            const res = await fetch(`${baseUrl}/tts`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ text, gender, provider })
            });

            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try { const j = await res.json(); errMsg = j.error || errMsg; } catch (_) {}
                throw new Error(errMsg);
            }

            const blob        = await res.blob();
            const usedProvider = res.headers.get('X-Provider') || provider;
            const duration    = Date.now() - startTime;

            if (!blob || blob.size === 0) throw new Error('Blob de áudio vazio');

            addLog(`✅ Áudio recebido via ${usedProvider} em ${duration}ms (${blob.size} bytes). Reproduzindo...`, 'success');

            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.innerHTML = `<span style="color:#4ade80">✅ ${usedProvider} · ${blob.size} bytes · ${duration}ms</span>`;
            }

            const url   = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.playbackRate = speed;
            audio.onended = () => {
                URL.revokeObjectURL(url);
                addLog('🔇 Reprodução finalizada.', 'info');
            };
            audio.onerror = () => {
                URL.revokeObjectURL(url);
                addLog('❌ Erro ao reproduzir o áudio no navegador.', 'error');
            };
            await audio.play();

        } catch (err) {
            addLog(`❌ Erro no teste: ${err.message}`, 'error');
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.innerHTML = `<span style="color:#f87171">❌ ${err.message}</span>`;
            }
        } finally {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="bi bi-play-fill mr-2"></i> REPRODUZIR ÁUDIO';
        }
    };

    // ── Eventos ─────────────────────────────────────────────────────────────
    refreshBtn?.addEventListener('click', updateStatus);
    testBtn?.addEventListener('click', testSpeak);
    clearBtn?.addEventListener('click', () => {
        logs.innerHTML = '';
        addLog('Logs limpos.', 'info');
    });

    // Dispara verificação ao carregar
    setTimeout(updateStatus, 600);
}
