/**
 * Módulo de Banco de Dados
 * Gerencia IndexedDB e carregamento de dados JSON
 */

class DatabaseManager {
    constructor() {
        this.dbName = 'escolaDB';  // Unificado com sistema novo
        this.dbVersion = 4;  // Bump to v4
        this.db = null;
        this.config = null;
        this.turmas = null;
    }

    /**
     * Inicializa o banco de dados IndexedDB
     */
    async init() {
        try {
            await this.openDatabase();
            await this.loadInitialData();
            console.log('Banco de dados inicializado com sucesso');
            return true;
        } catch (error) {
            console.error('Erro ao inicializar banco de dados:', error);
            throw error;
        }
    }

    /**
     * Abre conexão com IndexedDB
     */
    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                reject(new Error('Erro ao abrir banco de dados'));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.currentTarget.transaction;

                // Function to ensure store and indexes exist
                const ensureStore = (name, keyPath, indexes = []) => {
                    let store;
                    if (!db.objectStoreNames.contains(name)) {
                        store = db.createObjectStore(name, { keyPath });
                    } else {
                        store = transaction.objectStore(name);
                    }

                    indexes.forEach(idx => {
                        if (!store.indexNames.contains(idx.name)) {
                            store.createIndex(idx.name, idx.field, idx.options);
                        }
                    });

                    return store;
                };

                // Collection: usuarios (users)
                ensureStore('usuarios', '_id', [
                    { name: 'email', field: 'email', options: { unique: true } },
                    { name: 'perfil', field: 'perfil', options: { unique: false } }
                ]);

                // Collection: professores (teachers)
                ensureStore('professores', '_id', [
                    { name: 'idUsuario', field: 'idUsuario', options: { unique: true } },
                    { name: 'salaPrincipal', field: 'salaPrincipal', options: { unique: false } }
                ]);

                // Collection: diretores (admins)
                ensureStore('diretores', '_id', [
                    { name: 'idUsuario', field: 'idUsuario', options: { unique: true } }
                ]);

                // Collection: controle_salas (class_control)
                ensureStore('controle_salas', '_id', [
                    { name: 'idProfessor', field: 'idProfessor', options: { unique: true } }
                ]);

                // Collection: controle_turmas (class_access)
                ensureStore('controle_turmas', '_id', [
                    { name: 'idUsuario', field: 'idUsuario', options: { unique: true } }
                ]);

                // Collection: configuracoes_escola (school_settings)
                ensureStore('configuracoes_escola', '_id', []);

                // Collection: alunos (students)
                const alunosStore = getStore(db, transaction, 'alunos', 'id', true);
                ensureIndexes(alunosStore, [
                    { name: 'turmaId', field: 'turmaId', options: { unique: false } },
                    { name: 'nome', field: 'nome', options: { unique: false } },
                    { name: 'matricula', field: 'matricula', options: { unique: false } }
                ]);

                // Collection: notas (grades)
                const notasStore = getStore(db, transaction, 'notas', 'id', true);
                ensureIndexes(notasStore, [
                    { name: 'alunoId', field: 'alunoId', options: { unique: false } },
                    { name: 'turmaId', field: 'turmaId', options: { unique: false } },
                    { name: 'materiaId', field: 'materiaId', options: { unique: false } },
                    { name: 'bimestre', field: 'bimestre', options: { unique: false } }
                ]);

                // Collection: config (settings)
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config', { keyPath: 'key' });
                }

                function getStore(db, tx, name, keyPath, autoIncrement) {
                    if (!db.objectStoreNames.contains(name)) {
                        return db.createObjectStore(name, { keyPath, autoIncrement });
                    }
                    return tx.objectStore(name);
                }

                function ensureIndexes(store, indexes) {
                    indexes.forEach(idx => {
                        if (!store.indexNames.contains(idx.name)) {
                            store.createIndex(idx.name, idx.field, idx.options);
                        }
                    });
                }
            };
        });
    }

    /**
     * Carrega dados iniciais dos arquivos JSON
     */
    async loadInitialData() {
        try {
            // Resolver caminhos baseados na localização deste arquivo (js/db.js)
            // config.json está em ../data/config.json relativo a este arquivo
            const configUrl = new URL('../data/config.json', import.meta.url).href;
            const turmasUrl = new URL('../data/turmas.json', import.meta.url).href;
            const alunosUrl = new URL('../data/alunos.json', import.meta.url).href;
            const notasUrl = new URL('../data/notas.json', import.meta.url).href;

            // Carregar configurações
            const configResponse = await fetch(configUrl);
            this.config = await configResponse.json();

            // Carregar turmas
            const turmasResponse = await fetch(turmasUrl);
            this.turmas = await turmasResponse.json();

            // Verificar se já existem dados no IndexedDB
            const alunosCount = await this.count('alunos');

            if (alunosCount === 0) {
                // Carregar alunos do JSON
                const alunosResponse = await fetch(alunosUrl);
                const alunosData = await alunosResponse.json();

                for (const aluno of alunosData.alunos) {
                    await this.add('alunos', aluno);
                }

                // Carregar notas do JSON
                const notasResponse = await fetch(notasUrl);
                const notasData = await notasResponse.json();

                for (const nota of notasData.notas) {
                    await this.add('notas', nota);
                }

                console.log('Dados iniciais carregados do JSON');
            }
        } catch (error) {
            console.error('Erro ao carregar dados iniciais:', error);
            // Non-critical error if JSONs are missing, but db should proceed
        }
    }

    /**
     * Adiciona um registro ao store
     */
    add(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Atualiza um registro no store
     */
    update(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Remove um registro do store
     */
    delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca um registro por ID
     */
    get(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca todos os registros do store
     */
    getAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca registros por índice
     */
    getByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Conta registros no store
     */
    count(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Limpa todos os dados de um store
     */
    clear(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Limpa todo o banco de dados
     */
    async clearAll() {
        await this.clear('alunos');
        await this.clear('notas');
        await this.clear('config');
        console.log('Todos os dados foram limpos');
    }

    /**
     * Retorna as configurações
     */
    getConfig() {
        return this.config;
    }

    /**
     * Retorna as turmas
     */
    getTurmas() {
        return this.turmas?.turmas || [];
    }

    /**
     * Busca turma por ID
     */
    getTurmaById(turmaId) {
        return this.getTurmas().find(t => t.id === turmaId);
    }

    /**
     * Retorna as matérias configuradas
     */
    getMaterias() {
        return this.config?.materias || [];
    }

    /**
     * Retorna os tipos de avaliação
     */
    getTiposAvaliacao() {
        return this.config?.tiposAvaliacao || [];
    }

    /**
     * Retorna os bimestres
     */
    getBimestres() {
        return this.config?.bimestres || [];
    }
}

// Exporta instância única
const db = new DatabaseManager();
window.db = db; // Expose to window for non-module scripts
export default db;
