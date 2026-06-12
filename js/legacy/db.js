// Proxy para garantir que o db nunca seja retornado como undefined
const dbProxy = new Proxy({}, {
    get: function(target, prop) {
        if (!window.db) {
            console.warn(`⚠️ Tentando acessar db.${prop} antes da inicialização!`);
            return async () => { 
                console.error('❌ Erro: Banco de dados não inicializado.');
                return null;
            };
        }
        return window.db[prop];
    }
});

export default dbProxy;
