/**
 * db.js — Módulo ES6 que expõe o DatabaseManager para o app.js
 * O DatabaseManager real é criado em database.js (não-módulo) e
 * registrado em window.db. Este arquivo faz a ponte para o sistema
 * de módulos ES6 do app.js.
 */

// Proxy: redireciona todas as chamadas para window.db em tempo de execução,
// garantindo que a instância já esteja disponível quando app.js rodar.
const db = new Proxy({}, {
    get(_, prop) {
        const target = window.db;
        if (!target) {
            console.error('[db.js] window.db não está disponível ainda!');
            return undefined;
        }
        const value = target[prop];
        // Garante que métodos sejam chamados no contexto correto (this = window.db)
        return typeof value === 'function' ? value.bind(target) : value;
    },
    set(_, prop, value) {
        if (window.db) window.db[prop] = value;
        return true;
    }
});

export default db;
