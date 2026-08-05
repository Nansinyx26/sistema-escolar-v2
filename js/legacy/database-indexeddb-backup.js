/**
 * Database Manager - IndexedDB com estrutura MongoDB
 * Sistema de Gerenciamento Escolar
 * Compatível para migração futura para MongoDB
 */

class DatabaseManager {
    constructor() {
        this.dbName = 'escolaDB';
        this.version = 4;  // Bump to v4 to force index recreation
        this.db = null;
    }

    /**
     * Inicializa o banco de dados IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
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

                // Collection: faltas (attendance)
                const faltasStore = getStore(db, transaction, 'faltas', '_id', false); // using generated _id
                ensureIndexes(faltasStore, [
                    { name: 'turmaId', field: 'turmaId', options: { unique: false } },
                    { name: 'materia', field: 'materia', options: { unique: false } },
                    { name: 'data', field: 'data', options: { unique: false } }
                ]);

                // Collection: relatorios (daily reports)
                const relatoriosStore = getStore(db, transaction, 'relatorios', '_id', false); // using generated _id
                ensureIndexes(relatoriosStore, [
                    { name: 'turmaId', field: 'turmaId', options: { unique: false } },
                    { name: 'materia', field: 'materia', options: { unique: false } },
                    { name: 'data', field: 'data', options: { unique: false } }
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
     * Gera um ID único no formato MongoDB ObjectId
     */
    generateObjectId() {
        const timestamp = Math.floor(new Date().getTime() / 1000).toString(16);
        const randomValue = Math.random().toString(16).substr(2, 16);
        return timestamp + randomValue.substr(0, 16);
    }

    /**
     * Insere um documento em uma collection
     */
    async insert(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            // Adiciona _id se não existir
            if (!data._id) {
                data._id = this.generateObjectId();
            }

            const request = store.add(data);

            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Atualiza um documento
     */
    async update(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca um documento por ID
     */
    async findById(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca um documento por índice
     */
    async findByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.get(value);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca todos os documentos de uma collection
     */
    async findAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Remove um documento
     */
    async delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Busca com filtro customizado
     */
    async findWhere(storeName, filterFn) {
        const all = await this.findAll(storeName);
        return all.filter(filterFn);
    }

    /**
     * Limpa todos os dados de uma collection
     */
    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
}

// Instância global do banco
const db = new DatabaseManager();

// Exportar para uso em módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DatabaseManager;
}
