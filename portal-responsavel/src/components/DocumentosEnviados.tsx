import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchDocumentosEnviados,
  substituirDocumentoResponsavel,
  uploadDocumentoResponsavel,
} from '../services/apiService';
import type { DocumentoResponsavelItem, Student } from '../types';

interface Props {
  student: Student;
}

const TIPOS_PREDEFINIDOS = [
  'Autorização de Passeio',
  'Autorização de Imagem',
  'Eventos',
  'Uso da Sala Maker',
  'Termo de Responsabilidade',
  'Outro',
];

const STATUS_COLORS: Record<string, string> = {
  Enviado: '#3b82f6',
  'Em Análise': '#f59e0b',
  Conferido: '#10b981',
  Substituído: '#8b5cf6',
};

export const DocumentosEnviados: React.FC<Props> = ({ student }) => {
  const [documentos, setDocumentos] = useState<DocumentoResponsavelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado do formulário de novo upload
  const [showNovoForm, setShowNovoForm] = useState(false);
  const [tipoDocumento, setTipoDocumento] = useState(TIPOS_PREDEFINIDOS[0]);
  const [nomeDocumento, setNomeDocumento] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [novoArquivo, setNovoArquivo] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Estado do modal de visualização
  const [docVisualizando, setDocVisualizando] = useState<DocumentoResponsavelItem | null>(null);

  // Estado do modal de substituição
  const [docSubstituindo, setDocSubstituindo] = useState<DocumentoResponsavelItem | null>(null);
  const [arquivoSubstituto, setArquivoSubstituto] = useState<File | null>(null);
  const [substituindo, setSubstituindo] = useState(false);

  const apiBase = import.meta.env.DEV
    ? import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
    : '/api';

  const carregarDocumentos = useCallback(async () => {
    if (!student.id) return;
    setLoading(true);
    try {
      const docs = await fetchDocumentosEnviados(student.id);
      setDocumentos(docs);
    } catch (err) {
      console.error('Erro ao carregar documentos:', err);
    } finally {
      setLoading(false);
    }
  }, [student.id]);

  useEffect(() => {
    carregarDocumentos();
  }, [carregarDocumentos]);

  const handleNovoEnvio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoArquivo) {
      setErrorMsg('Por favor, selecione um arquivo (PDF, JPG, JPEG ou PNG).');
      return;
    }
    if (novoArquivo.size > 10 * 1024 * 1024) {
      setErrorMsg('O arquivo deve ter no máximo 10 MB.');
      return;
    }
    if (!nomeDocumento.trim()) {
      setErrorMsg('Informe o nome do documento.');
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('alunoId', student.id);
      formData.append('tipoDocumento', tipoDocumento);
      formData.append('nomeDocumento', nomeDocumento.trim());
      formData.append('observacoes', observacoes.trim());
      formData.append('arquivo', novoArquivo);

      await uploadDocumentoResponsavel(formData);
      setSuccessMsg('Documento assinado enviado com sucesso!');
      setNomeDocumento('');
      setObservacoes('');
      setNovoArquivo(null);
      setShowNovoForm(false);
      await carregarDocumentos();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar documento.');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmarSubstituicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docSubstituindo || !arquivoSubstituto) {
      setErrorMsg('Selecione o novo arquivo para substituição.');
      return;
    }
    if (arquivoSubstituto.size > 10 * 1024 * 1024) {
      setErrorMsg('O arquivo deve ter no máximo 10 MB.');
      return;
    }

    setSubstituindo(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('arquivo', arquivoSubstituto);

      await substituirDocumentoResponsavel(docSubstituindo._id, formData);
      setSuccessMsg('Documento substituído com sucesso!');
      setDocSubstituindo(null);
      setArquivoSubstituto(null);
      await carregarDocumentos();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao substituir documento.');
    } finally {
      setSubstituindo(false);
    }
  };

  const alunoNomeCompleto = [student.nome, student.sobrenome].filter(Boolean).join(' ');

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid #27272a', paddingTop: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h4
            style={{
              fontSize: '1rem',
              color: '#10b981',
              margin: '0 0 0.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <i className="bi bi-file-earmark-lock" /> Documentos Enviados
          </h4>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
            Documentos assinados à mão e autorizações enviados para{' '}
            <strong>{alunoNomeCompleto}</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNovoForm((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.9rem',
            background: showNovoForm ? '#3f3f46' : '#10b981',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <i className={`bi ${showNovoForm ? 'bi-x-lg' : 'bi-plus-lg'}`} />
          {showNovoForm ? 'Cancelar' : 'Enviar Novo Documento'}
        </button>
      </div>

      {successMsg && (
        <div
          style={{
            padding: '0.65rem 0.9rem',
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '8px',
            color: '#34d399',
            fontSize: '0.82rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <i className="bi bi-check-circle-fill" /> {successMsg}
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '0.65rem 0.9rem',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '8px',
            color: '#f87171',
            fontSize: '0.82rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <i className="bi bi-exclamation-triangle-fill" /> {errorMsg}
        </div>
      )}

      {/* Formulário de Envio de Novo Documento */}
      {showNovoForm && (
        <form
          onSubmit={handleNovoEnvio}
          style={{
            background: '#18181b',
            border: '1px solid #27272a',
            borderRadius: '10px',
            padding: '1.25rem',
            marginBottom: '1.5rem',
          }}
        >
          <h5
            style={{
              margin: '0 0 1rem',
              color: '#fff',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <i className="bi bi-cloud-arrow-up" style={{ color: '#10b981' }} /> Enviar Documento
            Assinado à Mão
          </h5>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '0.85rem',
              marginBottom: '0.85rem',
            }}
          >
            <div>
              <label
                htmlFor="doc-tipo"
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  color: 'rgba(255,255,255,0.7)',
                  marginBottom: '0.3rem',
                }}
              >
                Tipo de Documento *
              </label>
              <select
                id="doc-tipo"
                value={tipoDocumento}
                onChange={(e) => setTipoDocumento(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem',
                  borderRadius: '8px',
                  background: '#09090b',
                  border: '1px solid #27272a',
                  color: '#fff',
                  fontSize: '0.85rem',
                }}
                required
              >
                {TIPOS_PREDEFINIDOS.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="doc-nome"
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  color: 'rgba(255,255,255,0.7)',
                  marginBottom: '0.3rem',
                }}
              >
                Nome do Documento *
              </label>
              <input
                id="doc-nome"
                type="text"
                placeholder="Ex: Autorização Passeio Zoológico"
                value={nomeDocumento}
                onChange={(e) => setNomeDocumento(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem',
                  borderRadius: '8px',
                  background: '#09090b',
                  border: '1px solid #27272a',
                  color: '#fff',
                  fontSize: '0.85rem',
                }}
                required
              />
            </div>
          </div>

          <div style={{ marginBottom: '0.85rem' }}>
            <label
              htmlFor="doc-observacoes"
              style={{
                display: 'block',
                fontSize: '0.78rem',
                color: 'rgba(255,255,255,0.7)',
                marginBottom: '0.3rem',
              }}
            >
              Observações (Opcional)
            </label>
            <input
              id="doc-observacoes"
              type="text"
              placeholder="Alguma nota para a secretaria ou direção..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem',
                borderRadius: '8px',
                background: '#09090b',
                border: '1px solid #27272a',
                color: '#fff',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="doc-arquivo"
              style={{
                display: 'block',
                fontSize: '0.78rem',
                color: 'rgba(255,255,255,0.7)',
                marginBottom: '0.3rem',
              }}
            >
              Arquivo Digitalizado ou Foto (PDF, JPG, JPEG ou PNG — Limite 10 MB) *
            </label>
            <input
              id="doc-arquivo"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setNovoArquivo(e.target.files?.[0] || null)}
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '8px',
                background: '#09090b',
                border: '1px dashed #3f3f46',
                color: '#a1a1aa',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setShowNovoForm(false)}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                border: '1px solid #3f3f46',
                color: '#cbd5e1',
                borderRadius: '8px',
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={uploading}
              style={{
                padding: '0.5rem 1.2rem',
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              {uploading ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm"
                    role="status"
                    aria-hidden="true"
                  />
                  Enviando...
                </>
              ) : (
                <>
                  <i className="bi bi-cloud-arrow-up-fill" />
                  Enviar Documento
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Tabela de Documentos Enviados */}
      {loading ? (
        <div
          style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.85rem' }}
        >
          <i className="bi bi-hourglass-split" /> Carregando documentos enviados...
        </div>
      ) : documentos.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '1.5rem',
            background: '#18181b',
            borderRadius: '8px',
            color: '#94a3b8',
            fontSize: '0.82rem',
          }}
        >
          <i
            className="bi bi-folder2-open"
            style={{
              fontSize: '1.5rem',
              display: 'block',
              marginBottom: '0.5rem',
              color: '#52525b',
            }}
          />
          Nenhum documento assinado enviado para este aluno ainda.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.82rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #27272a', color: '#94a3b8' }}>
                <th style={{ padding: '0.6rem 0.5rem' }}>Nome do documento</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Tipo</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Aluno</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Data de envio</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((doc) => {
                const statusColor = STATUS_COLORS[doc.status] || '#3b82f6';
                const isPdf = doc.arquivo?.mimeType === 'application/pdf';
                const downloadUrl = `${apiBase}/documentos-responsaveis/${doc._id}/download`;

                return (
                  <tr key={doc._id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '0.65rem 0.5rem', color: '#fff', fontWeight: 500 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <i
                          className={`bi ${isPdf ? 'bi-file-earmark-pdf-fill' : 'bi-file-earmark-image-fill'}`}
                          style={{ color: isPdf ? '#ef4444' : '#3b82f6' }}
                        />
                        {doc.nomeDocumento}
                      </span>
                      {doc.observacoes && (
                        <small
                          style={{
                            display: 'block',
                            color: 'rgba(255,255,255,0.4)',
                            fontSize: '0.72rem',
                          }}
                        >
                          {doc.observacoes}
                        </small>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', color: '#cbd5e1' }}>
                      <span
                        style={{
                          padding: '0.15rem 0.5rem',
                          background: 'rgba(255,255,255,0.06)',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                        }}
                      >
                        {doc.tipoDocumento}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', color: '#cbd5e1' }}>
                      {doc.alunoNome || alunoNomeCompleto}
                    </td>
                    <td
                      style={{
                        padding: '0.65rem 0.5rem',
                        color: '#94a3b8',
                        fontSize: '0.75rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(doc.dataEnvio).toLocaleString('pt-BR')}
                      {doc.ultimaAtualizacao && doc.ultimaAtualizacao !== doc.dataEnvio && (
                        <small style={{ display: 'block', color: '#10b981', fontSize: '0.68rem' }}>
                          Atualizado: {new Date(doc.ultimaAtualizacao).toLocaleDateString('pt-BR')}
                        </small>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: '12px',
                          background: `${statusColor}22`,
                          color: statusColor,
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '0.65rem 0.5rem',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        {/* Botão Visualizar */}
                        <button
                          type="button"
                          onClick={() => setDocVisualizando(doc)}
                          title="Visualizar documento sem baixar"
                          style={{
                            padding: '0.35rem 0.6rem',
                            background: 'rgba(16,185,129,0.15)',
                            color: '#34d399',
                            border: '1px solid rgba(16,185,129,0.3)',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}
                        >
                          <i className="bi bi-eye-fill" /> Visualizar
                        </button>

                        {/* Botão Download */}
                        <a
                          href={downloadUrl}
                          download={doc.arquivo?.nomeOriginal}
                          title="Baixar arquivo"
                          style={{
                            padding: '0.35rem 0.6rem',
                            background: 'rgba(59,130,246,0.15)',
                            color: '#60a5fa',
                            border: '1px solid rgba(59,130,246,0.3)',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}
                        >
                          <i className="bi bi-download" /> Download
                        </a>

                        {/* Botão Substituir Documento */}
                        <button
                          type="button"
                          onClick={() => {
                            setDocSubstituindo(doc);
                            setArquivoSubstituto(null);
                          }}
                          title="Substituir arquivo mantendo o vínculo"
                          style={{
                            padding: '0.35rem 0.6rem',
                            background: 'rgba(139,92,246,0.15)',
                            color: '#a78bfa',
                            border: '1px solid rgba(139,92,246,0.3)',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}
                        >
                          <i className="bi bi-arrow-repeat" /> Substituir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Visualização Inline (Sem necessidade de download) */}
      {docVisualizando && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#09090b',
              border: '1px solid #27272a',
              borderRadius: '12px',
              width: 'min(900px, 95vw)',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '0.85rem 1.25rem',
                borderBottom: '1px solid #27272a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h5 style={{ margin: 0, color: '#fff', fontSize: '0.95rem' }}>
                  <i
                    className="bi bi-file-earmark-text"
                    style={{ color: '#10b981', marginRight: '0.4rem' }}
                  />
                  {docVisualizando.nomeDocumento}
                </h5>
                <small style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                  {docVisualizando.tipoDocumento} • {docVisualizando.arquivo?.nomeOriginal}
                </small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <a
                  href={`${apiBase}/documentos-responsaveis/${docVisualizando._id}/download`}
                  download={docVisualizando.arquivo?.nomeOriginal}
                  style={{
                    padding: '0.35rem 0.7rem',
                    background: '#27272a',
                    color: '#fff',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <i className="bi bi-download" /> Baixar
                </a>
                <button
                  type="button"
                  onClick={() => setDocVisualizando(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#a1a1aa',
                    fontSize: '1.2rem',
                    cursor: 'pointer',
                    padding: '0 0.3rem',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div
              style={{
                padding: '1rem',
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '350px',
              }}
            >
              {docVisualizando.arquivo?.mimeType === 'application/pdf' ? (
                <iframe
                  src={`${apiBase}/documentos-responsaveis/${docVisualizando._id}/visualizar`}
                  title={docVisualizando.nomeDocumento}
                  style={{ width: '100%', height: '70vh', border: 'none', borderRadius: '8px' }}
                />
              ) : (
                <img
                  src={`${apiBase}/documentos-responsaveis/${docVisualizando._id}/visualizar`}
                  alt={docVisualizando.nomeDocumento}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '70vh',
                    objectFit: 'contain',
                    borderRadius: '8px',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Substituição de Documento */}
      {docSubstituindo && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: '12px',
              width: 'min(480px, 95vw)',
              padding: '1.5rem',
            }}
          >
            <h5
              style={{
                margin: '0 0 0.5rem',
                color: '#fff',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <i className="bi bi-arrow-repeat" style={{ color: '#8b5cf6' }} /> Substituir Documento
            </h5>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 1rem' }}>
              Você está substituindo o arquivo de <strong>{docSubstituindo.nomeDocumento}</strong>.
              O vínculo com o aluno <strong>{alunoNomeCompleto}</strong> será mantido e a data será
              atualizada.
            </p>

            <form onSubmit={handleConfirmarSubstituicao}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  htmlFor="doc-arquivo-substituto"
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    color: 'rgba(255,255,255,0.7)',
                    marginBottom: '0.4rem',
                  }}
                >
                  Novo Arquivo (PDF, JPG, JPEG ou PNG — Limite 10 MB) *
                </label>
                <input
                  id="doc-arquivo-substituto"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setArquivoSubstituto(e.target.files?.[0] || null)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '8px',
                    background: '#09090b',
                    border: '1px dashed #3f3f46',
                    color: '#a1a1aa',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setDocSubstituindo(null)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'transparent',
                    border: '1px solid #3f3f46',
                    color: '#cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={substituindo}
                  style={{
                    padding: '0.5rem 1.2rem',
                    background: '#8b5cf6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  {substituindo ? 'Substituindo...' : 'Confirmar Substituição'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
