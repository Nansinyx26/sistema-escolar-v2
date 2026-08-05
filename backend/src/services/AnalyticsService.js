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

      // Campos reais da collection `notas`: alunoId (= Aluno._id), materiaId,
      // nota. Antes usava aluno_id/disciplina/valor (inexistentes no schema
      // strict), então a query nunca casava e o endpoint sempre dizia sem-dados.
      const query = { alunoId: String(alunoId) };
      if (bimestre) query.bimestre = bimestre;

      const notas = await Nota.find(query).lean();

      if (notas.length === 0) {
        return {
          success: true,
          aluno_id: alunoId,
          desempenho: 'sem-dados',
          mensagem: 'Nenhuma nota registrada',
        };
      }

      // Calcular médias por matéria
      const disciplinas = {};
      notas.forEach(nota => {
        const disc = nota.materiaId || nota.materia || 'Geral';
        const valor = parseFloat(nota.nota);
        if (isNaN(valor)) return;
        if (!disciplinas[disc]) {
          disciplinas[disc] = { notas: [] };
        }
        disciplinas[disc].notas.push(valor);
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

      resultado_calc.mediaGeral = totalDisciplinas > 0
        ? parseFloat((somaMedias / totalDisciplinas).toFixed(2))
        : 0;
      resultado_calc.desempenho = totalDisciplinas > 0
        ? this.classificarDesempenho(resultado_calc.mediaGeral)
        : 'sem-avaliacao';

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
      // A collection `faltas` é um LOG DE PRESENÇA: campo `aluno` (não aluno_id)
      // e cada registro tem `presente` (true/false). Antes assumia que todo
      // registro era uma ausência e usava 20 dias fixos — inflando a frequência.
      const query = { aluno: String(alunoId) };
      if (mes) {
        const dataInicio = new Date(new Date().getFullYear(), mes - 1, 1);
        const dataFim = new Date(new Date().getFullYear(), mes, 0, 23, 59, 59);
        query.data = { $gte: dataInicio, $lte: dataFim };
      }

      const registros = await Falta.find(query).lean();
      const totalDias = registros.length;
      const faltas = registros.filter(r => !r.presente);
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
        // Sem registros → sem-dados (não dispara alerta de frequência baixa).
        status: totalDias === 0
          ? 'sem-dados'
          : (percentualPresenca >= 75 ? 'aceitavel' : 'preocupante'),
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
      // O :turmaId pode chegar como _id da Turma (Aluno.turmaId) ou como código
      // de turma (Aluno.turma). Antes usava `turma_id`, campo inexistente no
      // schema — nenhum aluno casava e o relatório vinha vazio.
      const alunos = await Aluno.find({
        $or: [{ turmaId: String(turmaId) }, { turma: String(turmaId) }],
      });

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

    if (frequencia.success && frequencia.totalDias > 0 && frequencia.percentualPresenca < 75) {
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
