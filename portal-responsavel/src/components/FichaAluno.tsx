/**
 * FichaAluno — Autorizações, responsáveis e upload de documento assinado
 */
import React, { useState } from 'react';
import {
  updateAlunoDados,
  uploadDocumentos,
  registrarDocumentos,
} from '../services/apiService';
import type { Student, AutorizacoesEscolares, PessoaAutorizada } from '../types';

interface Props {
  student: Student;
  onUpdate: (updated: Partial<Student>) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pendente: 'Documento Pendente',
  enviado: 'Enviado',
  conferido: 'Conferido',
};

const STATUS_COLORS: Record<string, string> = {
  pendente: '#f59e0b',
  enviado: '#3b82f6',
  conferido: '#10b981',
};

function SimNaoSelect({ value, onChange, label, description }: {
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
  label: string;
  description?: string;
}) {
  const val = value === true ? 'sim' : value === false ? 'nao' : '';
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <label style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)' }}>{label}</label>
        {description && (
          <button
            type="button"
            onClick={() => setShowInfo(v => !v)}
            aria-expanded={showInfo}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: '#10b981', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
          >
            <i className={`bi ${showInfo ? 'bi-chevron-up' : 'bi-info-circle'}`} />
            {showInfo ? 'Ocultar' : 'Exibir detalhes'}
          </button>
        )}
      </div>
      {description && showInfo && (
        <p style={{ margin: '0 0 0.5rem', padding: '0.6rem 0.75rem', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', fontSize: '0.78rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.75)' }}>
          {description}
        </p>
      )}
      <select
        value={val}
        onChange={e => onChange(e.target.value === 'sim' ? true : e.target.value === 'nao' ? false : null)}
        style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }}
      >
        <option value="">— Selecione —</option>
        <option value="sim">SIM</option>
        <option value="nao">NÃO</option>
      </select>
    </div>
  );
}

// Explicações em linguagem simples — ajudam o responsável a entender o que
// está autorizando (ou não) em cada item da ficha escolar.
const AUTORIZACAO_INFO: Record<string, string> = {
  tratamentoOdontologico: 'Autoriza a escola a encaminhar seu filho(a) ao atendimento odontológico (dentista) oferecido ou conveniado pela escola, incluindo avaliações e ações preventivas como aplicação de flúor. Marque NÃO se prefere cuidar do dentista por conta própria.',
  tratamentoMedicoEmergencial: 'Em caso de acidente ou mal súbito, autoriza a escola a buscar atendimento médico de urgência (levar ao posto/hospital ou acionar o SAMU) mesmo antes de conseguir falar com você. É uma autorização de segurança para agir rápido quando cada minuto conta — a escola tentará avisá-lo(a) o quanto antes.',
  testagemAcuidade: 'Autoriza exames simples e não invasivos de visão e audição feitos na própria escola, para identificar cedo se a criança precisa de óculos ou de acompanhamento. Os resultados são informados a você.',
  atividadesFisicas: 'Autoriza a participação nas aulas de educação física, jogos e esportes da escola. Marque NÃO apenas se houver recomendação médica de restrição — nesse caso, envie o atestado.',
  atividadesExtraclasse: 'Autoriza a participação em passeios, visitas e excursões fora da escola organizados pela instituição, com transporte e acompanhamento dos professores. Cada passeio específico ainda poderá ter um aviso próprio com data e local.',
  conducaoEscolar: 'Indica que o transporte do aluno é feito por van ou ônibus escolar contratado por você (particular). Ao marcar SIM, informe o nome e o telefone do motorista responsável, para que a escola saiba quem está autorizado a levar/buscar a criança.',
  antitermico: 'Autoriza a escola a administrar medicamento para febre (antitérmico) caso a criança apresente febre, seguindo exatamente o medicamento e a dose que você informar. Marque NÃO se prefere ser sempre avisado(a) antes de qualquer medicação.',
};

const FichaAluno: React.FC<Props> = ({ student, onUpdate }) => {
  const [auth, setAuth] = useState<AutorizacoesEscolares>(student.autorizacoesEscolares || {});
  const [pessoas, setPessoas] = useState<PessoaAutorizada[]>(student.pessoasAutorizadasRetirada || []);
  const [guardaLegal, setGuardaLegal] = useState(student.guardaLegal || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const status = student.fichaDocumentoStatus || 'pendente';
  const arquivos = Array.isArray(student.documentos)
    ? student.documentos
    : student.documentos?.arquivos || [];

  const saveDados = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await updateAlunoDados(student.id, {
        autorizacoesEscolares: auth,
        pessoasAutorizadasRetirada: pessoas.filter(p => p.nome),
        guardaLegal,
      });
      onUpdate({ autorizacoesEscolares: auth, pessoasAutorizadasRetirada: pessoas, guardaLegal });
      setMsg('Dados salvos com sucesso!');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    setMsg(null);
    try {
      const uploaded = await uploadDocumentos(Array.from(files));
      await registrarDocumentos(student.id, uploaded);
      onUpdate({ fichaDocumentoStatus: 'enviado', documentos: { arquivos: [...arquivos, ...uploaded] } });
      setMsg('Documento(s) enviado(s) com sucesso!');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const apiBase = import.meta.env.DEV
    ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
    : '/api';

  return (
    <div style={{ background: '#09090b', border: '1px solid #27272a', borderRadius: '12px', padding: '1.25rem', marginTop: '1rem' }}>
      <h3 style={{ color: '#10b981', marginBottom: '1rem', fontSize: '1rem' }}>
        <i className="bi bi-clipboard-check" /> Ficha &amp; Autorizações
      </h3>

      {/* Responsáveis */}
      {(student.responsaveis?.length || student.responsavelDados) && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h4 style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>Responsáveis</h4>
          {(student.responsaveis || [student.responsavelDados]).filter(Boolean).map((r, i) => (
            <div key={i} style={{ padding: '0.5rem', background: '#18181b', borderRadius: '8px', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
              <strong>{r?.nome}</strong> — {r?.tipo || r?.parentesco}
              {r?.telefone && <span style={{ marginLeft: '0.5rem', color: 'rgba(255,255,255,0.5)' }}>📞 {r.telefone}</span>}
              {r?.whatsapp && r.whatsapp !== r.telefone && <span style={{ marginLeft: '0.5rem' }}>💬 {r.whatsapp}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Guarda legal */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>Guarda Legal</label>
        <select
          value={guardaLegal}
          onChange={e => setGuardaLegal(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff', marginTop: '0.25rem' }}
        >
          <option value="">— Selecione —</option>
          <option value="Mãe">Mãe</option>
          <option value="Pai">Pai</option>
          <option value="Responsável 1">Responsável 1</option>
          <option value="Responsável 2">Responsável 2</option>
          <option value="Ambos">Ambos</option>
        </select>
      </div>

      {/* Autorizações */}
      <h4 style={{ fontSize: '0.85rem', color: '#10b981', margin: '1rem 0 0.25rem' }}>Autorizações Escolares</h4>
      <p style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
        Toque em <strong style={{ color: '#10b981' }}>Exibir detalhes</strong> em cada item para entender exatamente o que você está autorizando antes de escolher SIM ou NÃO.
      </p>
      <SimNaoSelect label="Tratamento odontológico" description={AUTORIZACAO_INFO.tratamentoOdontologico} value={auth.tratamentoOdontologico} onChange={v => setAuth(a => ({ ...a, tratamentoOdontologico: v }))} />
      <SimNaoSelect label="Tratamento médico emergencial" description={AUTORIZACAO_INFO.tratamentoMedicoEmergencial} value={auth.tratamentoMedicoEmergencial} onChange={v => setAuth(a => ({ ...a, tratamentoMedicoEmergencial: v }))} />
      <SimNaoSelect label="Testagem acuidade visual/auditiva" description={AUTORIZACAO_INFO.testagemAcuidade} value={auth.testagemAcuidade} onChange={v => setAuth(a => ({ ...a, testagemAcuidade: v }))} />
      <SimNaoSelect label="Atividades físicas" description={AUTORIZACAO_INFO.atividadesFisicas} value={auth.atividadesFisicas} onChange={v => setAuth(a => ({ ...a, atividadesFisicas: v }))} />
      <SimNaoSelect label="Atividades extraclasse / excursões" description={AUTORIZACAO_INFO.atividadesExtraclasse} value={auth.atividadesExtraclasse} onChange={v => setAuth(a => ({ ...a, atividadesExtraclasse: v }))} />
      <SimNaoSelect label="Condução escolar contratada" description={AUTORIZACAO_INFO.conducaoEscolar} value={auth.conducaoEscolar} onChange={v => setAuth(a => ({ ...a, conducaoEscolar: v }))} />
      {auth.conducaoEscolar && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input placeholder="Nome do motorista" value={auth.motoristaNome || ''} onChange={e => setAuth(a => ({ ...a, motoristaNome: e.target.value }))}
            style={{ padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }} />
          <input placeholder="Telefone do motorista" value={auth.motoristaTelefone || ''} onChange={e => setAuth(a => ({ ...a, motoristaTelefone: e.target.value }))}
            style={{ padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }} />
        </div>
      )}
      <SimNaoSelect label="Autoriza antitérmico" description={AUTORIZACAO_INFO.antitermico} value={auth.antitermico} onChange={v => setAuth(a => ({ ...a, antitermico: v }))} />
      {auth.antitermico && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input placeholder="Nome do medicamento" value={auth.medicamentoNome || ''} onChange={e => setAuth(a => ({ ...a, medicamentoNome: e.target.value }))}
            style={{ padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }} />
          <input placeholder="Dose" value={auth.medicamentoDose || ''} onChange={e => setAuth(a => ({ ...a, medicamentoDose: e.target.value }))}
            style={{ padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }} />
        </div>
      )}

      {/* Pessoas autorizadas retirada */}
      <h4 style={{ fontSize: '0.85rem', color: '#10b981', margin: '1rem 0 0.25rem' }}>Pessoas Autorizadas a Retirar</h4>
      <p style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 0.6rem', lineHeight: 1.5 }}>
        Liste quem, além dos responsáveis, pode buscar a criança na saída (ex.: avós, tios, babá). A escola só liberará o aluno para as pessoas cadastradas aqui, mediante documento com foto.
      </p>
      {pessoas.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input placeholder="Nome" value={p.nome} onChange={e => { const n = [...pessoas]; n[i] = { ...n[i], nome: e.target.value }; setPessoas(n); }}
            style={{ padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }} />
          <input placeholder="Telefone" value={p.telefone || ''} onChange={e => { const n = [...pessoas]; n[i] = { ...n[i], telefone: e.target.value }; setPessoas(n); }}
            style={{ padding: '0.5rem', borderRadius: '8px', background: '#18181b', border: '1px solid #27272a', color: '#fff' }} />
          <button type="button" onClick={() => setPessoas(pessoas.filter((_, j) => j !== i))}
            style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '8px', cursor: 'pointer' }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setPessoas([...pessoas, { nome: '', parentesco: '', telefone: '' }])}
        style={{ background: 'transparent', border: '1px solid #27272a', color: '#10b981', borderRadius: '8px', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '1rem' }}>
        + Adicionar pessoa
      </button>

      <button onClick={saveDados} disabled={saving}
        style={{ width: '100%', padding: '0.75rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, marginBottom: '1.25rem' }}>
        {saving ? 'Salvando...' : 'Salvar Autorizações'}
      </button>

      {/* Documento assinado */}
      <h4 style={{ fontSize: '0.85rem', color: '#10b981', marginBottom: '0.5rem' }}>Ficha Digitalizada Assinada</h4>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', borderRadius: '20px', background: `${STATUS_COLORS[status]}22`, color: STATUS_COLORS[status], fontSize: '0.8rem', marginBottom: '0.75rem' }}>
        {STATUS_LABELS[status] || status}
      </div>

      {arquivos.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          {arquivos.map((a, i) => (
            <a key={i} href={`${apiBase}/upload/documento/${a.gridfsId || a.id}`} target="_blank" rel="noreferrer"
              style={{ display: 'block', padding: '0.5rem', background: '#18181b', borderRadius: '8px', color: '#10b981', textDecoration: 'none', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
              📄 {a.nome} {a.enviadoEm && <span style={{ color: 'rgba(255,255,255,0.4)' }}>({new Date(a.enviadoEm).toLocaleString('pt-BR')})</span>}
            </a>
          ))}
        </div>
      )}

      <label style={{ display: 'block', padding: '1rem', border: '2px dashed #27272a', borderRadius: '8px', textAlign: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>
        {uploading ? 'Enviando...' : '📎 Clique para enviar PDF, JPG ou PNG (múltiplos arquivos)'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden onChange={handleUpload} disabled={uploading} />
      </label>

      {msg && <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: msg.includes('sucesso') ? '#10b981' : '#ef4444' }}>{msg}</p>}
    </div>
  );
};

export default FichaAluno;
