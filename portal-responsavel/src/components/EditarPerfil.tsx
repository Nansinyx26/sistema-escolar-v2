import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  removeManualPhoto,
  updateProfile,
  uploadManualPhoto,
} from '../services/apiService';
import styles from '../styles/portal.module.scss';
import type { AuthUser, Student } from '../types';
import { getPhotoUrl } from '../utils/photoUtils';
import Icon from './ui/Icon';

interface EditarPerfilProps {
  user: AuthUser;
  activeStudent: Student | null;
  onSuccess: (updatedUser: AuthUser) => void;
}

type TabType = 'responsavel' | 'lgpd';

export default function EditarPerfil({ user, onSuccess }: EditarPerfilProps) {
  const [activeTab, setActiveTab] = useState<TabType>('responsavel');
  const [nome, setNome] = useState(user.nome || '');
  const [telefone, setTelefone] = useState(user.telefone || '');

  // Photo
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [fotoEmFoco, setFotoEmFoco] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Consentimentos (Issue #280): cada caixa é uma escolha própria, e nenhuma é
  // condição para salvar nome e telefone. As três primeiras moram em
  // `lgpdConsents`; a quarta é a ciência da política, o consentimento geral.
  const [consent1, setConsent1] = useState(!!user.lgpdConsents?.perfilDadosCadastrais);
  const [consent2, setConsent2] = useState(!!user.lgpdConsents?.perfilNotasDesempenho);
  const [consent3, setConsent3] = useState(!!user.lgpdConsents?.perfilComunicacoes);
  const [consent4, setConsent4] = useState(!!user.consentimentoAceiteEm);
  const politicaAssinada = !!user.consentimentoAceiteEm;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setNome(user.nome || '');
    setTelefone(user.telefone || '');
    setPhotoFile(null);
    setPhotoRemoved(false);
    setPhotoPreview('');
    setConsent1(!!user.lgpdConsents?.perfilDadosCadastrais);
    setConsent2(!!user.lgpdConsents?.perfilNotasDesempenho);
    setConsent3(!!user.lgpdConsents?.perfilComunicacoes);
    setConsent4(!!user.consentimentoAceiteEm);
  }, [user]);

  const autorizacoesMudaram =
    consent1 !== !!user.lgpdConsents?.perfilDadosCadastrais ||
    consent2 !== !!user.lgpdConsents?.perfilNotasDesempenho ||
    consent3 !== !!user.lgpdConsents?.perfilComunicacoes ||
    consent4 !== politicaAssinada;

  const currentPhotoUrl = getPhotoUrl(user.foto || user.fotoGoogle || '');
  const hasCurrentPhoto = currentPhotoUrl !== '/img/default-avatar.png';
  const displayPreview = photoRemoved
    ? ''
    : photoPreview || (hasCurrentPhoto ? currentPhotoUrl : '');

  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    if (val.length > 10) val = val.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    else if (val.length > 6) val = val.replace(/^(\d{2})(\d{4})(\d{1,4})$/, '($1) $2-$3');
    else if (val.length > 2) val = val.replace(/^(\d{2})(\d{1,4})$/, '($1) $2');
    setTelefone(val);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('A foto deve ter no máximo 5MB.');
      return;
    }
    setPhotoFile(file);
    setPhotoRemoved(false);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview('');
    setPhotoRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const avisarSucesso = (mensagem: string) => {
    setSuccessMsg(mensagem);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  // Cada aba salva o que é dela: "Salvar dados" não manda consentimento, e
  // "Salvar autorizações" não manda nome nem telefone.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'lgpd') void salvarAutorizacoes();
    else void salvarDados();
  };

  const salvarAutorizacoes = async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const finalizedUser = await updateProfile({
        lgpdConsents: {
          perfilDadosCadastrais: consent1,
          perfilNotasDesempenho: consent2,
          perfilComunicacoes: consent3,
        },
        // A ciência da política só é enviada quando é dada agora; o servidor
        // assina uma vez e não move a data em salvamentos seguintes.
        ...(consent4 && !politicaAssinada ? { consentimentoAceiteEm: true } : {}),
      });
      onSuccess(finalizedUser);
      avisarSucesso('Autorizações atualizadas com sucesso!');
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Ocorreu um erro ao salvar as autorizações.');
    } finally {
      setLoading(false);
    }
  };

  const salvarDados = async () => {
    if (!nome.trim()) {
      setError('O nome é obrigatório.');
      return;
    }
    if (telefone.length < 14) {
      setError('Telefone inválido. Preencha com DDD.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      if (photoFile && photoPreview) {
        setUploadingPhoto(true);
        try {
          // O backend agora recebe o Base64 diretamente e converte para WebP
          const updatedUser = await uploadManualPhoto(photoPreview);
          onSuccess(updatedUser);
        } finally {
          setUploadingPhoto(false);
        }
      } else if (photoRemoved) {
        const updatedUser = await removeManualPhoto();
        onSuccess(updatedUser);
      }

      // Atualiza os outros dados do perfil — sem consentimento nenhum no corpo.
      const finalizedUser = await updateProfile({ nome, telefone });
      onSuccess(finalizedUser);

      setPhotoFile(null);
      setPhotoPreview('');
      setPhotoRemoved(false);
      avisarSucesso('Perfil atualizado com sucesso!');
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Ocorreu um erro ao salvar o perfil.');
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  };

  const isButtonDisabled =
    loading || uploadingPhoto || (activeTab === 'lgpd' && !autorizacoesMudaram);

  return (
    <article className={styles.profileViewCard} aria-label="Editar dados cadastrais e termo LGPD">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <h2>
          <Icon name="signature" aria-hidden="true" /> Cadastro e Proteção de Dados (LGPD)
        </h2>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
            color: '#22c55e',
            padding: '6px 12px',
            borderRadius: '20px',
            fontSize: '0.78rem',
            fontWeight: 600,
          }}
        >
          <Icon name="shield-check" style={{ fontSize: '0.9rem' }} /> Em conformidade com a LGPD
        </div>
      </div>
      <p className={styles.subtitle}>
        Mantenha seus dados em dia e escolha, uma a uma, o que você autoriza.
      </p>

      <div className={styles.profileTabs}>
        <button
          type="button"
          onClick={() => setActiveTab('responsavel')}
          className={`${styles.tabBtn} ${activeTab === 'responsavel' ? styles.active : ''}`}
        >
          <Icon name="user" /> Responsável Legal
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lgpd')}
          className={`${styles.tabBtn} ${activeTab === 'lgpd' ? styles.active : ''}`}
        >
          <Icon name="shield-lock" /> Termos LGPD
        </button>
      </div>

      {error && (
        <div className={styles.sidebarError} role="alert" style={{ marginBottom: '20px' }}>
          <Icon name="alert-circle" /> <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div
          style={{
            marginBottom: '24px',
            padding: '12px 16px',
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: '8px',
            color: '#22c55e',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
          role="alert"
        >
          <Icon name="circle-check-filled" /> <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {activeTab === 'responsavel' && (
          <div className={styles.profileFormSection}>
            {/* ── Photo Upload ── */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '28px',
              }}
            >
              <button
                type="button"
                style={{
                  position: 'relative',
                  width: '100px',
                  height: '100px',
                  cursor: 'pointer',
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  borderRadius: '50%',
                }}
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={() => setFotoEmFoco(true)}
                onMouseLeave={() => setFotoEmFoco(false)}
                onFocus={() => setFotoEmFoco(true)}
                onBlur={() => setFotoEmFoco(false)}
                title="Clique para alterar a foto"
                aria-label={displayPreview ? 'Alterar foto de perfil' : 'Adicionar foto de perfil'}
              >
                {displayPreview ? (
                  <img
                    src={displayPreview}
                    alt="Foto de perfil"
                    style={{
                      width: '100px',
                      height: '100px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '3px solid rgba(16, 185, 129,0.4)',
                      boxShadow: '0 0 20px rgba(16, 185, 129,0.2)',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100px',
                      height: '100px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg,#10b981,#7c3aed)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '2rem',
                      fontWeight: 700,
                      color: '#fff',
                      border: '3px solid rgba(16, 185, 129,0.3)',
                    }}
                  >
                    {getInitials(nome)}
                  </div>
                )}
                {/* camera overlay */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: fotoEmFoco ? 1 : 0,
                    transition: 'opacity 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <Icon name="camera" style={{ fontSize: '1.6rem', color: '#fff' }} />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handlePhotoChange}
              />
              <div
                style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    background: 'rgba(16, 185, 129,0.1)',
                    border: '1px solid rgba(16, 185, 129,0.3)',
                    color: '#10b981',
                    cursor: 'pointer',
                  }}
                >
                  <Icon name="upload" /> {displayPreview ? 'Alterar Foto' : 'Adicionar Foto'}
                </button>
                {displayPreview && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 14px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.25)',
                      color: '#ef4444',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="trash" /> Remover
                  </button>
                )}
              </div>
              <p style={{ fontSize: '0.72rem', color: '#71717a', margin: 0 }}>
                JPG, PNG ou WebP · máx. 5MB
              </p>
            </div>

            <h3 className={styles.profileSectionTitle}>
              <Icon name="id-badge" /> Informações do Responsável Legal
            </h3>

            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
              <label className={styles.formLabel} htmlFor="editar-perfil-nome">
                Nome Completo
              </label>
              <div className={styles.inputWrapper}>
                <Icon name="user" />
                <input
                  id="editar-perfil-nome"
                  type="text"
                  className={styles.formInput}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Seu nome completo"
                  required
                />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="editar-perfil-telefone">
                Telefone Celular
              </label>
              <div className={styles.inputWrapper}>
                <Icon name="phone" />
                <input
                  id="editar-perfil-telefone"
                  type="text"
                  className={styles.formInput}
                  value={telefone === '(00) 00000-0000' ? '' : telefone}
                  placeholder="(00) 00000-0000"
                  onChange={handleTelefoneChange}
                  required
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'lgpd' && (
          <div className={styles.profileFormSection}>
            <h3
              className={styles.profileSectionTitle}
              style={{ borderColor: 'rgba(16, 185, 129,0.3)' }}
            >
              <Icon name="shield-lock" style={{ color: '#10b981' }} /> Termos de Consentimento
              Ativos
            </h3>
            <p
              style={{
                color: '#94a3b8',
                fontSize: '0.85rem',
                marginBottom: '20px',
                lineHeight: '1.5',
              }}
            >
              Cada autorização é independente: marque só as que você aceita. Você pode desmarcar uma
              autorização quando quiser, e isso não afeta os seus dados cadastrais.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                {
                  state: consent1,
                  set: setConsent1,
                  travada: false,
                  title: 'Tratamento de Dados Cadastrais do Responsável',
                  art: 'Art. 7, I LGPD',
                  desc: 'Permite o processamento do seu nome, telefone e e-mail para autenticação de segurança e contato da secretaria.',
                },
                {
                  state: consent2,
                  set: setConsent2,
                  travada: false,
                  title: 'Exibição e Consulta de Notas e Desempenho do Menor',
                  art: 'Art. 14 LGPD',
                  desc: 'Autoriza a exibição do histórico de notas, boletins escolares e faltas do aluno diretamente no portal.',
                },
                {
                  state: consent3,
                  set: setConsent3,
                  travada: false,
                  title: 'Comunicações Rápidas e Alertas Escolares',
                  art: '',
                  desc: 'Autoriza o envio de avisos de reuniões, ocorrências e alertas de faltas para o e-mail ou telefone cadastrado.',
                },
                // A ciência da política é uma declaração já assinada, com data e
                // IP no histórico: depois de dada, fica registrada e não se desmarca aqui.
                {
                  state: consent4,
                  set: setConsent4,
                  travada: politicaAssinada,
                  title: 'Ciência das Políticas de Privacidade Gerais',
                  art: 'Art. 18 LGPD',
                  desc: politicaAssinada
                    ? 'Ciência já registrada. Declaro ciência sobre o armazenamento seguro de logs de acesso e os direitos garantidos por lei.'
                    : 'Declaro ciência sobre o armazenamento seguro de logs de acesso e os direitos garantidos por lei.',
                },
              ].map((item) => (
                // `<label>` em volta da caixa: o clique em qualquer ponto do
                // cartão alterna a caixa, e o teclado funciona sem código extra.
                <label
                  key={item.title}
                  className={`${styles.consentItem} ${item.state ? styles.checked : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={item.state}
                    disabled={item.travada}
                    onChange={(e) => item.set(e.target.checked)}
                  />
                  <div className={styles.consentItemBody}>
                    <div className={styles.consentItemTitle}>
                      {item.title}
                      {item.art && <span className={styles.consentArt}>{item.art}</span>}
                    </div>
                    <div className={styles.consentItemDesc}>{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            <div
              style={{
                marginTop: '24px',
                padding: '16px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '8px',
              }}
            >
              <h4
                style={{ margin: '0 0 8px', fontSize: '0.9rem', color: '#f1f5f9', fontWeight: 600 }}
              >
                Período de Retenção de Dados
              </h4>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem', lineHeight: '1.5' }}>
                Conforme obrigatoriedades legais do MEC, o histórico acadêmico é de retenção
                definitiva. Os dados cadastrais do responsável são mantidos enquanto o aluno possuir
                matrícula ativa.
              </p>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: '32px',
            display: 'flex',
            justifyContent: 'flex-end',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: '20px',
          }}
        >
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isButtonDisabled}
            style={{
              maxWidth: '240px',
              background: isButtonDisabled
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(135deg,#10b981,#8b5cf6)',
              border: 'none',
              fontWeight: 700,
              transition: 'all 0.3s',
            }}
          >
            {uploadingPhoto
              ? 'Enviando foto...'
              : loading
                ? 'Salvando...'
                : activeTab === 'lgpd'
                  ? 'Salvar Autorizações'
                  : 'Salvar Dados'}
          </button>
        </div>
      </form>
    </article>
  );
}
