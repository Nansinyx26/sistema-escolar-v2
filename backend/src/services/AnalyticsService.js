/**
 * Analytics Service — P2 Implementation
 * 
 * Separa lógica de analytics de IAController
 * Fornece insights sobre desempenho de alunos
 * 
 * @module AnalyticsService
 * @version 1.0
 */

const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Turma = require('../models/Turma');
const { CacheService } = require('./CacheService');
const logger = require('../utils/logger');

class AnalyticsService {
  /**
   * Análise de desempenho do aluno
   */
  static async analisarDesempenhoAluno(alunoId, bimestre = null) {
    try {
      const cacheKey = CacheService.keys.notaAluno(alunoId, bimestre || 'all');
      
      // Tentar cache
      let resultado = await CacheService.get(cacheKey);
      if (resultado) return resultado;

      const query = { aluno_id: alunoId };
      if (bimestre) query.bimestre = bimestre;

      const notas = await Nota.find(query);
      
      if (notas.length === 0) {
        return {
          success: true,
          aluno_id: alunoId,
          desempenho: 'sem-dados',
          mensagem: 'Nenhuma nota registrada',
        };
      }

      // Calcular médias
      const disciplinas = {};
      notas.forEach(nota => {
        if (!disciplinas[nota.disciplina]) {
          disciplinas[nota.disciplina] = {
            notas: [],
            peso: nota.peso || 1,
          };
        }
        disciplinas[nota.disciplina].notas.push(nota.valor);
      });

      // Agregações
      const resultado_calc = {
        success: true,
        aluno_id: alunoId,
        bimestre,
        disciplinas: {},
        mediaGeral: 0,
        desempenho: 'sem-avaliacao',
      };

      let somaMedias = 0;
      let totalDisciplinas = 0;

      Object.entries(disciplinas).forEach(([disc, dados]) => {
        const media = dados.notas.reduce((a, b) => a + b, 0) / dados.notas.length;
        resultado_calc.disciplinas[disc] = {
          media: parseFloat(media.toFixed(2)),
          notas: dados.notas.length,
          status: this.classificarDesempenho(media),
        };
        somaMedias += media;
        totalDisciplinas++;
      });

      resultado_calc.mediaGeral = parseFloat((somaMedias / totalDisciplinas).toFixed(2));
      resultado_calc.desempenho = this.classificarDesempenho(resultado_calc.mediaGeral);

      // Cache por 1 hora
      await CacheService.set(cacheKey, resultado_calc, 3600);

      return resultado_calc;
    } catch (error) {
      logger.error('Erro ao analisar desempenho:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Análise de frequência do aluno
   */
  static async analisarFrequenciaAluno(alunoId, mes = null) {
    try {
      const query = { aluno_id: alunoId };
      if (mes) {
        const dataInicio = new Date(new Date().getFullYear(), mes - 1, 1);
        const dataFim = new Date(new Date().getFullYear(), mes, 0);
        query.data = { $gte: dataInicio, $lte: dataFim };
      }

      const faltas = await Falta.find(query);
      const totalDias = await this.calcularDiasLetivos(alunoId, mes);

      const presencas = totalDias - faltas.length;
      const percentualPresenca = totalDias > 0 
        ? parseFloat(((presencas / totalDias) * 100).toFixed(2))
        : 0;

      return {
        success: true,
        aluno_id: alunoId,
        mes,
        totalDias,
        presencas,
        faltas: faltas.length,
        percentualPresenca,
        status: percentualPresenca >= 75 ? 'aceitavel' : 'preocupante',
        detalhesFaltas: faltas.map(f => ({
          data: f.data,
          motivo: f.motivo,
          justificada: f.justificada,
        })),
      };
    } catch (error) {
      logger.error('Erro ao analisar frequência:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Relatório de turma (agregado)
   */
  static async relatorioTurma(turmaId, bimestre) {
    try {
      const cacheKey = CacheService.keys.relatorioBimestral(turmaId, bimestre);
      
      let relatorio = await CacheService.get(cacheKey);
      if (relatorio) return relatorio;

      const turma = await Turma.findById(turmaId);
      const alunos = await Aluno.find({ turma_id: turmaId });

      const analises = await Promise.all(
        alunos.map(aluno => this.analisarDesempenhoAluno(aluno._id, bimestre))
      );

      // Agregações
      const disciplinas = {};
      const desempenhos = { excelente: 0, bom: 0, regular: 0, fraco: 0 };

      analises.forEach(analise => {
        if (analise.success) {
          // Contar desempenhos
          desempenhos[analise.desempenho] = (desempenhos[analise.desempenho] || 0) + 1;

          // Agregar disciplinas
          Object.entries(analise.disciplinas).forEach(([disc, dados]) => {
            if (!disciplinas[disc]) {
              disciplinas[disc] = {
                medias: [],
                total: 0,
              };
            }
            disciplinas[disc].medias.push(dados.media);
            disciplinas[disc].total++;
          });
        }
      });

      // Calcular médias de disciplinas
      Object.entries(disciplinas).forEach(([disc, dados]) => {
        const media = dados.medias.reduce((a, b) => a + b, 0) / dados.medias.length;
        disciplinas[disc].media = parseFloat(media.toFixed(2));
        delete disciplinas[disc].medias;
      });

      relatorio = {
        success: true,
        turma_id: turmaId,
        turma: turma?.nome,
        bimestre,
        totalAlunos: alunos.length,
        desempenhos,
        disciplinas,
        mediaGeral: Object.values(disciplinas).length > 0
          ? parseFloat((Object.values(disciplinas).reduce((a, b) => a + (b.media || 0), 0) / Object.values(disciplinas).length).toFixed(2))
          : 0,
        dataGeracao: new Date(),
      };

      // Cache por 6 horas
      await CacheService.set(cacheKey, relatorio, 21600);

      return relatorio;
    } catch (error) {
      logger.error('Erro ao gerar relatório de turma:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Dashboard do aluno
   */
  static async dashboardAluno(alunoId) {
    try {
      const cacheKey = CacheService.keys.dashboard(alunoId);
      let dashboard = await CacheService.get(cacheKey);
      if (dashboard) return dashboard;

      const [desempenho, frequencia] = await Promise.all([
        this.analisarDesempenhoAluno(alunoId),
        this.analisarFrequenciaAluno(alunoId),
      ]);

      dashboard = {
        success: true,
        aluno_id: alunoId,
        desempenho: desempenho.success ? desempenho : null,
        frequencia: frequencia.success ? frequencia : null,
        alertas: this.gerarAlertas(desempenho, frequencia),
        dataGeracao: new Date(),
      };

      // Cache por 1 hora
      await CacheService.set(cacheKey, dashboard, 3600);

      return dashboard;
    } catch (error) {
      logger.error('Erro ao gerar dashboard:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper: classificar desempenho
   */
  static classificarDesempenho(media) {
    if (media >= 9) return 'excelente';
    if (media >= 7) return 'bom';
    if (media >= 5) return 'regular';
    return 'fraco';
  }

  /**
   * Helper: calcular dias letivos
   */
  static async calcularDiasLetivos(alunoId, mes) {
    // Simplificado: assumir 20 dias por mês
    // Em produção, buscar calendário escolar
    return 20;
  }

  /**
   * Helper: gerar alertas
   */
  static gerarAlertas(desempenho, frequencia) {
    const alertas = [];

    if (desempenho.success && desempenho.mediaGeral < 5) {
      alertas.push({
        tipo: 'notas-baixas',
        mensagem: 'Desempenho abaixo da média. Verifique as disciplinas com dificuldade.',
        severidade: 'alta',
      });
    }

    if (frequencia.success && frequencia.percentualPresenca < 75) {
      alertas.push({
        tipo: 'frequencia-baixa',
        mensagem: `Frequência em risco: ${frequencia.percentualPresenca}%`,
        severidade: 'alta',
      });
    }

    return alertas;
  }

  /**
   * Health check
   */
  static async health() {
    try {
      const count = await Nota.countDocuments();
      return { ok: true, notas: count };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = AnalyticsService;
