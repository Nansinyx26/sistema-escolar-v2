/**
 * Database Migrations — P2 Implementation
 * 
 * Sistema de migrações versionadas para MongoDB
 * Controla versão de schema, dados e índices
 * 
 * @module DatabaseMigrations
 * @version 1.0
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;

/**
 * Schema para rastrear migrações aplicadas
 */
const migrationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now },
  version: String,
  checksum: String, // Para detectar se foi alterada
}, { collection: '__migrations__' });

const Migration = mongoose.model('Migration', migrationSchema);

/**
 * Database Migrations Service
 */
class DatabaseMigrations {
  constructor(migrationsPath = path.join(__dirname, '../../migrations')) {
    this.migrationsPath = migrationsPath;
  }

  /**
   * Obter todas as migrações do diretório
   */
  async getAvailableMigrations() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      return files
        .filter(f => f.endsWith('.js'))
        .map(f => ({
          name: f,
          path: path.join(this.migrationsPath, f),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`⚠️ Migrations path not found: ${this.migrationsPath}`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Obter migrações já aplicadas
   */
  async getAppliedMigrations() {
    return await Migration.find().sort({ appliedAt: 1 });
  }

  /**
   * Verificar quais migrações faltam ser aplicadas
   */
  async getPendingMigrations() {
    const available = await this.getAvailableMigrations();
    const applied = await this.getAppliedMigrations();
    const appliedNames = new Set(applied.map(m => m.name));

    return available.filter(m => !appliedNames.has(m.name));
  }

  /**
   * Aplicar uma migração
   */
  async runMigration(migrationFile) {
    try {
      const migration = require(migrationFile.path);
      
      if (!migration.up) {
        throw new Error(`Migration ${migrationFile.name} missing 'up' function`);
      }

      console.log(`⏳ Applying migration: ${migrationFile.name}`);
      
      // Executar up
      const result = await migration.up();
      
      // Registrar como aplicada
      await Migration.create({
        name: migrationFile.name,
        version: migration.version || '1.0',
      });

      console.log(`✅ Migration applied: ${migrationFile.name}`);
      return { success: true, migration: migrationFile.name, result };
    } catch (error) {
      console.error(`❌ Migration failed: ${migrationFile.name}`, error);
      return { success: false, migration: migrationFile.name, error: error.message };
    }
  }

  /**
   * Reverter uma migração
   */
  async revertMigration(migrationName) {
    try {
      const available = await this.getAvailableMigrations();
      const migrationFile = available.find(m => m.name === migrationName);

      if (!migrationFile) {
        throw new Error(`Migration not found: ${migrationName}`);
      }

      const migration = require(migrationFile.path);
      
      if (!migration.down) {
        throw new Error(`Migration ${migrationName} missing 'down' function`);
      }

      console.log(`⏳ Reverting migration: ${migrationName}`);
      
      // Executar down
      const result = await migration.down();
      
      // Remover registro
      await Migration.deleteOne({ name: migrationName });

      console.log(`✅ Migration reverted: ${migrationName}`);
      return { success: true, migration: migrationName, result };
    } catch (error) {
      console.error(`❌ Revert failed: ${migrationName}`, error);
      return { success: false, migration: migrationName, error: error.message };
    }
  }

  /**
   * Aplicar todas as migrações pendentes
   */
  async runPending() {
    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      console.log('✅ Database is up to date');
      return { applied: [], skipped: 0 };
    }

    console.log(`\n📦 Applying ${pending.length} pending migrations...\n`);

    const results = [];
    for (const migration of pending) {
      const result = await this.runMigration(migration);
      results.push(result);
      
      if (!result.success) {
        console.log(`\n⚠️ Stopping due to migration failure`);
        break;
      }
    }

    return {
      applied: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  /**
   * Status das migrações
   */
  async status() {
    const available = await this.getAvailableMigrations();
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations();

    return {
      available: available.length,
      applied: applied.length,
      pending: pending.length,
      appliedMigrations: applied.map(m => ({ name: m.name, at: m.appliedAt })),
      pendingMigrations: pending.map(m => m.name),
    };
  }

  /**
   * Criar uma nova migração (scaffolding)
   */
  async createMigration(name) {
    const timestamp = Date.now();
    const filename = `${timestamp}-${name}.js`;
    const filepath = path.join(this.migrationsPath, filename);

    const template = `/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 */

module.exports = {
  version: '1.0',
  
  // Up migration
  async up() {
    const db = require('mongoose').connection;
    
    // TODO: Implementar up
    console.log('Applying migration: ${name}');
    
    return { message: 'Migration ${name} applied' };
  },
  
  // Down migration (rollback)
  async down() {
    const db = require('mongoose').connection;
    
    // TODO: Implementar down (reverso do up)
    console.log('Reverting migration: ${name}');
    
    return { message: 'Migration ${name} reverted' };
  }
};
`;

    try {
      // Criar diretório se não existir
      await fs.mkdir(this.migrationsPath, { recursive: true });
      
      // Escrever arquivo
      await fs.writeFile(filepath, template);
      console.log(`✅ Migration created: ${filepath}`);
      return { success: true, file: filename, path: filepath };
    } catch (error) {
      console.error('❌ Failed to create migration:', error);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Export padrão com método factory
 */
const migrations = new DatabaseMigrations();

module.exports = {
  DatabaseMigrations,
  migrations,
  
  /**
   * Factory para instância customizada
   */
  create: (path) => new DatabaseMigrations(path),
};

/**
 * CLI Commands (se rodado como script)
 */
if (require.main === module) {
  const command = process.argv[2];
  const arg = process.argv[3];

  (async () => {
    try {
      const db = require('./db');
      await db.connectDB();

      switch (command) {
        case 'status':
          const status = await migrations.status();
          console.log('\n📊 Migration Status:');
          console.log(`  Available: ${status.available}`);
          console.log(`  Applied:   ${status.applied}`);
          console.log(`  Pending:   ${status.pending}`);
          console.log('\nApplied migrations:');
          status.appliedMigrations.forEach(m => {
            console.log(`  ✅ ${m.name} (${new Date(m.at).toISOString()})`);
          });
          if (status.pending > 0) {
            console.log('\nPending migrations:');
            status.pendingMigrations.forEach(m => {
              console.log(`  ⏳ ${m}`);
            });
          }
          break;

        case 'up':
        case 'run':
          const result = await migrations.runPending();
          console.log(`\n✅ Applied ${result.applied} migrations`);
          if (result.failed > 0) {
            console.log(`❌ ${result.failed} failed`);
            process.exit(1);
          }
          break;

        case 'down':
        case 'revert':
          if (!arg) {
            console.error('Usage: npm run migrate down <migration-name>');
            process.exit(1);
          }
          const revertResult = await migrations.revertMigration(arg);
          if (!revertResult.success) process.exit(1);
          break;

        case 'create':
          if (!arg) {
            console.error('Usage: npm run migrate create <migration-name>');
            process.exit(1);
          }
          await migrations.createMigration(arg);
          break;

        default:
          console.log('Usage:');
          console.log('  npm run migrate status              - Ver status');
          console.log('  npm run migrate up                  - Aplicar pendentes');
          console.log('  npm run migrate down <name>         - Reverter');
          console.log('  npm run migrate create <name>       - Criar nova');
      }

      process.exit(0);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}
