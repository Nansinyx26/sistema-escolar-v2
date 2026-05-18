/**
 * Utility Functions
 * Funções auxiliares reutilizáveis
 */

// === TOAST NOTIFICATIONS ===
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-x-circle-fill',
        warning: 'bi-exclamation-triangle-fill',
        info: 'bi-info-circle-fill'
    };

    toast.innerHTML = `
        <i class="toast-icon bi ${icons[type]}"></i>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="bi bi-x"></i>
        </button>
    `;

    container.appendChild(toast);

    // Auto remove após duration
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// === CENTRAL MODAL ALERT (Pleasant & Non-Aggressive) ===
function showModalAlert(title, message, type = 'info') {
    // Remove if already exists
    const existing = document.getElementById('customModalAlert');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'customModalAlert';
    backdrop.className = 'backdrop';
    backdrop.style.display = 'flex';
    backdrop.style.alignItems = 'center';
    backdrop.style.justifyContent = 'center';
    backdrop.style.zIndex = '9999';

    const icons = {
        success: { icon: 'bi-check-circle', color: 'var(--success)' },
        error: { icon: 'bi-exclamation-circle', color: 'var(--error)' },
        warning: { icon: 'bi-exclamation-triangle', color: 'var(--warning)' },
        info: { icon: 'bi-info-circle', color: 'var(--info)' }
    };

    const config = icons[type] || icons.info;

    backdrop.innerHTML = `
        <div class="glass-strong" style="max-width: 400px; width: 90%; padding: 2rem; border-radius: 24px; text-align: center; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 50px rgba(0,0,0,0.5); animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
            <div style="width: 70px; height: 70px; background: ${config.color}22; color: ${config.color}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 2.2rem; box-shadow: 0 0 20px ${config.color}33;">
                <i class="bi ${config.icon}"></i>
            </div>
            <h2 style="margin-bottom: 0.8rem; color: var(--text-primary); font-size: 1.5rem;">${title}</h2>
            <p style="margin-bottom: 2rem; color: var(--text-secondary); line-height: 1.5; font-size: 1rem;">${message}</p>
            <button class="btn btn-primary" style="width: 100%; padding: 1rem; border-radius: 14px; font-weight: 600; font-size: 1rem; box-shadow: var(--shadow-md);" onclick="document.getElementById('customModalAlert').remove()">
                Entendi, vou fazer
            </button>
        </div>
    `;

    document.body.appendChild(backdrop);
}

// === LOADING SPINNER ===
function showLoading(element) {
    if (!element) return;
    element.classList.add('loading');
    element.disabled = true;
}

function hideLoading(element) {
    if (!element) return;
    element.classList.remove('loading');
    element.disabled = false;
}

// === VALIDAÇÍO DE EMAIL ===
function isValidEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// === VALIDAÇÍO DE SENHA ===
function isValidPassword(password) {
    return password && password.length >= 6;
}

// === ALTERNAR VISIBILIDADE DE SENHA (OLHINHO) ===
function togglePass(inputId, btnElement) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const icon = btnElement.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.classList.replace('bi-eye', 'bi-eye-slash');
    } else {
        input.type = 'password';
        if (icon) icon.classList.replace('bi-eye-slash', 'bi-eye');
    }
}

// === ALTERNAR VISIBILIDADE DE TEXTO SECRETO (EX: CÓDIGO DO DIA) ===
function toggleSecretVisibility(elementId, btnElement) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const realCode = el.getAttribute('data-code') || '------';
    const icon = btnElement.querySelector('i');

    if (el.innerText === '••••••') {
        el.innerText = realCode;
        if (icon) icon.classList.replace('bi-eye', 'bi-eye-slash');
    } else {
        el.innerText = '••••••';
        if (icon) icon.classList.replace('bi-eye-slash', 'bi-eye');
    }
}

// === FORMAT DATE ===
function formatDate(date) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };

    return date.toLocaleDateString('pt-BR', options);
}

// === FORMAT RELATIVE TIME ===
function getRelativeTime(date) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'agora';
    if (minutes < 60) return `${minutes}m atrás`;
    if (hours < 24) return `${hours}h atrás`;
    if (days < 7) return `${days}d atrás`;

    return formatDate(date);
}

// === DEBOUNCE ===
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// === THROTTLE ===
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// === SANITIZE HTML ===
function sanitizeHTML(str) {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

// === TRUNCATE TEXT ===
function truncate(str, maxLength) {
    if (str.length <= maxLength) return str;
    return str.substr(0, maxLength) + '...';
}

// === GET INITIALS ===
function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(' ');
    if (parts.length === 1) {
        return parts[0].charAt(0).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// === SLUGIFY ===
function slugify(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// === COPY TO CLIPBOARD ===
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copiado para a área de transferência', 'success');
        return true;
    } catch (err) {
        console.error('Erro ao copiar:', err);
        showToast('Erro ao copiar', 'error');
        return false;
    }
}

// === DOWNLOAD FILE ===
function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// === IMAGE TO BASE64 (Redimensiona e converte para WebP) ===
function imageToBase64(file, maxWidth = 800, maxHeight = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Converte para WebP com 80% de qualidade
                const webpBase64 = canvas.toDataURL('image/webp', 0.8);
                resolve(webpBase64);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// === RESIZE IMAGE ===
function resizeImage(file, maxWidth = 800, maxHeight = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(resolve, 'image/webp', 0.8);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// === GENERATE UUID ===
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// === LOCAL STORAGE HELPERS ===
const storage = {
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.error('Erro ao salvar no localStorage:', err);
            return false;
        }
    },

    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (err) {
            console.error('Erro ao ler do localStorage:', err);
            return defaultValue;
        }
    },

    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (err) {
            console.error('Erro ao remover do localStorage:', err);
            return false;
        }
    },

    clear() {
        try {
            localStorage.clear();
            return true;
        } catch (err) {
            console.error('Erro ao limpar localStorage:', err);
            return false;
        }
    }
};

// === SESSION STORAGE HELPERS ===
const session = {
    set(key, value) {
        try {
            sessionStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.error('Erro ao salvar no sessionStorage:', err);
            return false;
        }
    },

    get(key, defaultValue = null) {
        try {
            const item = sessionStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (err) {
            console.error('Erro ao ler do sessionStorage:', err);
            return defaultValue;
        }
    },

    remove(key) {
        try {
            sessionStorage.removeItem(key);
            return true;
        } catch (err) {
            console.error('Erro ao remover do sessionStorage:', err);
            return false;
        }
    },

    clear() {
        try {
            sessionStorage.clear();
            return true;
        } catch (err) {
            console.error('Erro ao limpar sessionStorage:', err);
            return false;
        }
    }
};

// === WAIT / SLEEP ===
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// === RETRY FUNCTION ===
async function retry(fn, maxAttempts = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxAttempts) throw err;
            await sleep(delay * attempt);
        }
    }
}

// === CHECK IF ONLINE ===
function isOnline() {
    return navigator.onLine;
}

// === PREVENT DEFAULT ON FORM ===
function preventFormDefault(formId, callback) {
    const form = document.getElementById(formId);
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            callback(e);
        });
    }
}

// Exportar para uso global
window.utils = {
    showToast,
    showModalAlert,
    showLoading,
    hideLoading,
    isValidEmail,
    isValidPassword,
    formatDate,
    getRelativeTime,
    debounce,
    throttle,
    sanitizeHTML,
    truncate,
    getInitials,
    slugify,
    copyToClipboard,
    downloadFile,
    imageToBase64,
    resizeImage,
    generateUUID,
    storage,
    session,
    sleep,
    retry,
    isOnline,
    preventFormDefault,
    togglePass,
    toggleSecretVisibility
};
