/**
 * Script de Exportação Completa do Banco de Dados (IndexedDB) para JSON
 * Usado para migração para MongoDB Atlas
 */

const ExportDB = {
    dbName: 'escolaDB',
    version: 5, // Tenta abrir na versão mais alta encontrada normalmente, mas 5 é o schema atual

    async getAllData() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName);

            request.onerror = (event) => {
                console.error("Erro ao abrir banco de dados", event);
                reject("Erro ao abrir banco de dados");
            };

            request.onsuccess = async (event) => {
                const db = event.target.result;
                const objectStoreNames = Array.from(db.objectStoreNames);
                const exportData = {};

                try {
                    const transaction = db.transaction(objectStoreNames, 'readonly');

                    for (const storeName of objectStoreNames) {
                        const store = transaction.objectStore(storeName);
                        const data = await this.getAllFromStore(store);
                        exportData[storeName] = data;
                    }

                    resolve(exportData);
                } catch (error) {
                    reject(error);
                }
            };
        });
    },

    getAllFromStore(store) {
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    downloadJSON(data, filename = 'escola_database.json') {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async exportar() {
        try {
            if (confirm('Deseja exportar o banco de dados completo para migração? Isso pode levar alguns segundos dependendo da quantidade de imagens.')) {
                // Feedback visual simples
                const btn = document.getElementById('btnExportarDB');
                const originalText = btn ? btn.innerText : '';
                if (btn) btn.innerText = 'Exportando...';

                const data = await this.getAllData();
                this.downloadJSON(data);
                
                alert('Exportação concluída! O arquivo escola_database.json foi baixado.');
                
                if (btn) btn.innerText = originalText;
            }
        } catch (error) {
            console.error(error);
            alert('Erro ao exportar dados: ' + error);
        }
    }
};

// Tornar global para acesso via botão
window.ExportDB = ExportDB;
