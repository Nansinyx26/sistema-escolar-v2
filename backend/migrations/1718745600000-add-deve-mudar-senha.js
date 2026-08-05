/**
 * Example Migration: Add deveMudarSenha to Usuario
 * 
 * Esta é uma migração de exemplo para demonstrar como criar
 * mudanças de schema de forma controlada
 */

module.exports = {
  version: '1.0',
  
  async up() {
    const Usuario = require('../models/Usuario');
    
    console.log('Adicionando campo deveMudarSenha...');
    
    // Adicionar campo a todos os usuários existentes
    const result = await Usuario.updateMany(
      { deveMudarSenha: { $exists: false } },
      { $set: { deveMudarSenha: false } }
    );
    
    console.log(`✅ Atualizados ${result.modifiedCount} usuários`);
    
    return {
      message: 'Campo deveMudarSenha adicionado',
      modifiedCount: result.modifiedCount,
    };
  },
  
  async down() {
    const Usuario = require('../models/Usuario');
    
    console.log('Removendo campo deveMudarSenha...');
    
    // Remover campo (apenas rollback)
    const result = await Usuario.updateMany(
      { deveMudarSenha: { $exists: true } },
      { $unset: { deveMudarSenha: 1 } }
    );
    
    console.log(`✅ Removidos campos de ${result.modifiedCount} usuários`);
    
    return {
      message: 'Campo deveMudarSenha removido',
      modifiedCount: result.modifiedCount,
    };
  }
};
