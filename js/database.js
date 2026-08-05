/**
 * Database Manager - Versão API Backend Unificada
 * Gerencia todas as chamadas ao MongoDB via backend
 */

class DatabaseManager {
    constructor() {
        this.baseUrl = window.API_BASE_URL || 'http://localhost:3001/api';
        this.config = null;
        this.turmas = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return true;
        console.log('🔌 Conectando ao Backend:', this.baseUrl);
        try {
            await this.loadInitialData();
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('❌ Erro na inicialização:', error);
            return false;
        }
    }

    getEndpoint(storeName) {
        const map = {
            'usuarios': '/usuarios',
            'professores': '/professores',
            'diretores': '/diretores',
            'turmas': '/turmas',
            'alunos': '/alunos',
            'notas': '/notas',
            'faltas': '/faltas',
            'relatorios': '/relatorios',
            'especiais': '/especiais',
            'config': '/config'
        };
        return map[storeName] || `/${storeName}`;
    }

    async loadInitialData() {
        console.time('⏱️ Carga Inicial');
        try {
            // Executa buscas em paralelo para ganhar tempo
            const fetchOpts = { credentials: 'include' };
            const [configRes, turmasRes] = await Promise.allSettled([
                fetch(`${this.baseUrl}/config`, fetchOpts).then(res => res.json()),
                fetch(`${this.baseUrl}/turmas`, fetchOpts).then(res => res.json())
            ]);

            if (configRes.status === 'fulfilled' && configRes.value.success) {
                this.config = configRes.value.data;
                console.log('✅ Configurações carregadas em paralelo');
            }

            if (turmasRes.status === 'fulfilled' && turmasRes.value.success) {
                this.turmas = { turmas: turmasRes.value.data };
                console.log('✅ Turmas carregadas em paralelo');
            }

        } catch (e) {
            console.error('Erro crítico no carregamento inicial:', e);
        } finally {
            console.timeEnd('⏱️ Carga Inicial');
        }
    }

    normalizeItem(item) {
        if (item && typeof item === 'object') {
            if (item._id && !item.id) item.id = item._id;
        }
        return item;
    }

    normalizeData(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data.map(i => this.normalizeItem(i));
        return [this.normalizeItem(data)];
    }

    async getAll(storeName) {
        const endpoint = this.getEndpoint(storeName);
        try {
            const res = await fetch(`${this.baseUrl}${endpoint}`, { credentials: 'include' });
            const json = await res.json();
            return this.normalizeData(json.data);
        } catch (e) {
            console.error(`Erro buscando ${storeName}:`, e);
            return [];
        }
    }

    async getByIndex(storeName, indexName, value) {
        const endpoint = this.getEndpoint(storeName);
        let param = indexName;
        if (storeName === 'alunos' && indexName === 'turmaId') param = 'turma';

        try {
            const res = await fetch(`${this.baseUrl}${endpoint}?${param}=${encodeURIComponent(value)}`, { credentials: 'include' });
            const json = await res.json();
            return this.normalizeData(json.data);
        } catch (e) { return []; }
    }

    async get(storeName, id) {
        const endpoint = this.getEndpoint(storeName);
        try {
            const res = await fetch(`${this.baseUrl}${endpoint}/${id}`, { credentials: 'include' });
            const json = await res.json();
            return json.success ? this.normalizeItem(json.data) : null;
        } catch (e) { return null; }
    }

    async add(storeName, data) {
        const endpoint = this.getEndpoint(storeName);
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        return json.success ? this.normalizeItem(json.data) : null;
    }

    async update(storeName, data) {
        const id = data.id || data._id;
        const endpoint = this.getEndpoint(storeName);
        const res = await fetch(`${this.baseUrl}${endpoint}/${id}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        return json.success ? this.normalizeItem(json.data) : null;
    }

    async delete(storeName, id) {
        const endpoint = this.getEndpoint(storeName);
        const res = await fetch(`${this.baseUrl}${endpoint}/${id}`, { method: 'DELETE', credentials: 'include' });
        const json = await res.json();
        return json.success;
    }

    // Getters
    getConfig() { return this.config; }
    getTurmas() {
        if (!this.turmas) return [];
        return Array.isArray(this.turmas) ? this.turmas : (this.turmas.turmas || []);
    }
    getTurmaById(id) { return this.getTurmas().find(t => t.id === id || t._id === id); }

    getMaterias() {
        return this.config?.materias || [];
    }

    // Aliases para compatibilidade legada
    async findByIndex(store, idx, val) {
        const res = await this.getByIndex(store, idx, val);
        if (Array.isArray(res)) {
            if (res.length === 0) return null;
            const match = res.find(item => 
                String(item[idx]) === String(val) || 
                String(item.idUsuario) === String(val) || 
                String(item.email) === String(val) || 
                String(item._id || item.id) === String(val)
            );
            return match || null;
        }
        return res;
    }
    async findById(store, id) { return this.get(store, id); }
    async getById(store, id) { return this.get(store, id); }
    async insert(store, data) { return this.add(store, data); }
    async findAll(store) { return this.getAll(store); }

    getTiposAvaliacao() {
        return this.config?.tiposAvaliacao || [];
    }

    getBimestres() {
        return this.config?.bimestres || [];
    }
}

window.db = new DatabaseManager();
