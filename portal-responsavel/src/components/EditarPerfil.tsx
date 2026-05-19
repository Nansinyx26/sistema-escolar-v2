import React, { useState, useEffect } from 'react';
import { 
  updateProfile, 
  getStudentDetails, 
  updateStudent, 
  uploadDocument, 
  ApiError, 
  AuthUser 
} from '../services/apiService';
import type { Student } from '../types';
import styles from '../styles/portal.module.scss';

interface EditarPerfilProps {
  user: AuthUser;
  activeStudent: Student | null;
  onSuccess: (updatedUser: AuthUser) => void;
}

type TabType = 'responsavel' | 'filho' | 'saude' | 'lgpd';

export default function EditarPerfil({ user, activeStudent, onSuccess }: EditarPerfilProps) {
  // --- Active Tab State ---
  const [activeTab, setActiveTab] = useState<TabType>('responsavel');

  // --- Guardian States ---
  const [nome, setNome] = useState(user.nome || '');
  const [cpf, setCpf] = useState(user.cpf || '');
  const [telefone, setTelefone] = useState(user.telefone || '');
  
  // --- Consent States ---
  const [consent1, setConsent1] = useState(!!user.consentimentoAceiteEm);
  const [consent2, setConsent2] = useState(!!user.consentimentoAceiteEm);
  const [consent3, setConsent3] = useState(!!user.consentimentoAceiteEm);
  const [consent4, setConsent4] = useState(!!user.consentimentoAceiteEm);

  // --- Student Full Details States ---
  const [studentDetails, setStudentDetails] = useState<any>(null);
  const [loadingStudent, setLoadingStudent] = useState(false);

  // Student Basic Fields
  const [nomeAluno, setNomeAluno] = useState('');
  const [sobrenomeAluno, setSobrenomeAluno] = useState('');
  const [matriculaAluno, setMatriculaAluno] = useState('');
  const [nascimentoAluno, setNascimentoAluno] = useState('');
  const [turmaAluno, setTurmaAluno] = useState('');
  const [nivelAluno, setNivelAluno] = useState('');
  const [cpfAluno, setCpfAluno] = useState('');
  const [nacionalidadeAluno, setNacionalidadeAluno] = useState('Brasileira');
  const [etniaAluno, setEtniaAluno] = useState('');
  const [religiaoAluno, setReligiaoAluno] = useState('');

  // Address Fields
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('SP');

  // Health Fields
  const [pcd, setPcd] = useState<'Sim' | 'Não'>('Não');
  const [deficiencia, setDeficiencia] = useState('');
  const [alergiasAlimentos, setAlergiasAlimentos] = useState('');
  const [alergiasRemedio, setAlergiasRemedio] = useState('');
  const [planoSaude, setPlanoSaude] = useState('');
  const [condicao, setCondicao] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Document Uploads List
  const [docsList, setDocsList] = useState<any[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // General Page States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // --- Initializing Guardian Data ---
  useEffect(() => {
    setNome(user.nome || '');
    setCpf(user.cpf || '');
    setTelefone(user.telefone || '');
    
    const signed = !!user.consentimentoAceiteEm;
    setConsent1(signed);
    setConsent2(signed);
    setConsent3(signed);
    setConsent4(signed);
  }, [user]);

  // --- Initializing / Fetching Student Data ---
  useEffect(() => {
    if (activeStudent?.id) {
      setLoadingStudent(true);
      setError('');
      getStudentDetails(activeStudent.id)
        .then((data) => {
          setStudentDetails(data);
          
          // Populate basic student fields
          setNomeAluno(data.nome || activeStudent.nome || '');
          setSobrenomeAluno(data.sobrenome || activeStudent.sobrenome || '');
          setMatriculaAluno(data.matricula || activeStudent.matricula || '');
          
          if (data.nascimento) {
            setNascimentoAluno(new Date(data.nascimento).toISOString().split('T')[0]);
          } else if (activeStudent.dataNascimento) {
            try {
              setNascimentoAluno(new Date(activeStudent.dataNascimento).toISOString().split('T')[0]);
            } catch (e) {
              setNascimentoAluno('');
            }
          } else {
            setNascimentoAluno('');
          }
          
          setTurmaAluno(data.turma || activeStudent.turma || '');
          setNivelAluno(data.nivel || '');
          setCpfAluno(data.cpfAluno || '');
          setNacionalidadeAluno(data.nacionalidade || 'Brasileira');
          setEtniaAluno(data.etnia || '');
          setReligiaoAluno(data.religiao || '');

          // Populate address fields
          if (data.endereco && typeof data.endereco === 'object') {
            setCep(data.endereco.cep || '');
            setLogradouro(data.endereco.logradouro || '');
            setNumero(data.endereco.numero || '');
            setComplemento(data.endereco.complemento || '');
            setBairro(data.endereco.bairro || '');
            setCidade(data.endereco.cidade || '');
            setEstado(data.endereco.estado || 'SP');
          } else {
            setCep('');
            setLogradouro('');
            setNumero('');
            setComplemento('');
            setBairro('');
            setCidade('');
            setEstado('SP');
          }

          // Populate health fields
          setPcd(data.pcd ? 'Sim' : 'Não');
          setDeficiencia(data.deficiencia || '');
          setAlergiasAlimentos(data.alergiasAlimentos || '');
          setAlergiasRemedio(data.alergiasRemedio || '');
          setPlanoSaude(data.planoSaude || '');
          setCondicao(data.condicao || '');
          setObservacoes(data.observacoes || '');

          // Populate documents
          setDocsList(data.documentos || []);
        })
        .catch((err) => {
          console.error('Erro ao buscar detalhes do aluno:', err);
          setError('Não foi possível carregar as informações do filho.');
        })
        .finally(() => setLoadingStudent(false));
    }
  }, [activeStudent]);

  // CPF Mask: 000.000.000-00
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    if (val.length > 9) {
      val = val.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
    } else if (val.length > 6) {
      val = val.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
    } else if (val.length > 3) {
      val = val.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
    }
    setCpf(val);
  };

  // Student CPF Mask
  const handleCpfAlunoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    if (val.length > 9) {
      val = val.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
    } else if (val.length > 6) {
      val = val.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
    } else if (val.length > 3) {
      val = val.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
    }
    setCpfAluno(val);
  };

  // Telephone Mask: (00) 00000-0000 or (00) 0000-0000
  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    if (val.length > 10) {
      val = val.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    } else if (val.length > 6) {
      val = val.replace(/^(\d{2})(\d{4})(\d{1,4})$/, '($1) $2-$3');
    } else if (val.length > 2) {
      val = val.replace(/^(\d{2})(\d{1,4})$/, '($1) $2');
    }
    setTelefone(val);
  };

  // CEP Mask and ViaCEP autofill
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '').slice(0, 8);
    if (val.length > 5) {
      val = val.replace(/^(\d{5})(\d{1,3})$/, '$1-$2');
    }
    setCep(val);

    const cleanCep = val.replace(/\D/g, '');
    if (cleanCep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setLogradouro(data.logradouro || '');
          setBairro(data.bairro || '');
          setCidade(data.localidade || '');
          setEstado(data.uf || 'SP');
        }
      } catch (err) {
        console.warn('ViaCEP offline, preencher manualmente.');
      }
    }
  };

  // --- Document File Upload ---
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingDoc(true);
    setError('');
    try {
      const updatedDocs = [...docsList];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 10 * 1024 * 1024) {
          setError(`Arquivo "${file.name}" excede o limite de 10 MB.`);
          continue;
        }
        const uploaded = await uploadDocument(file);
        updatedDocs.push({
          id: uploaded.id,
          nome: file.name,
          tamanho: file.size,
          dataUpload: new Date().toISOString()
        });
      }
      setDocsList(updatedDocs);
      setSuccessMsg('Documento carregado com sucesso!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar arquivo.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleRemoveDoc = (docId: string) => {
    setDocsList(prev => prev.filter(d => d.id !== docId));
  };

  // --- Submit form ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setError('O nome é obrigatório.');
      return;
    }
    if (cpf.length < 14) {
      setError('CPF do responsável inválido. Preencha todos os dígitos.');
      return;
    }
    if (telefone.length < 14) {
      setError('Telefone do responsável inválido. Preencha o telefone com DDD.');
      return;
    }
    if (!consent1 || !consent2 || !consent3 || !consent4) {
      setError('Você deve aceitar todos os termos de consentimento para salvar.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      // 1. Update Guardian Profile
      const updatedUser = await updateProfile({
        nome,
        cpf,
        telefone,
        consentimentoAceiteEm: true,
      });

      // 2. Update Student Profile if activeStudent exists
      if (activeStudent?.id) {
        await updateStudent(activeStudent.id, {
          nome: nomeAluno,
          sobrenome: sobrenomeAluno,
          nascimento: nascimentoAluno ? new Date(nascimentoAluno).toISOString() : undefined,
          cpfAluno: cpfAluno || undefined,
          nacionalidade: nacionalidadeAluno,
          etnia: etniaAluno || undefined,
          religiao: religiaoAluno || undefined,
          endereco: {
            cep,
            logradouro,
            numero,
            complemento,
            bairro,
            cidade,
            estado
          },
          responsavelDados: {
            nome,
            cpf,
            telefone,
            parentesco: studentDetails?.responsavelDados?.parentesco || 'Mãe/Pai',
            email: user.email,
            autorizadoBusca: true
          },
          deficiencia: pcd === 'Sim' ? (deficiencia || 'Não especificada') : '',
          pcd: pcd === 'Sim',
          alergiasAlimentos: alergiasAlimentos || undefined,
          alergiasRemedio: alergiasRemedio || undefined,
          planoSaude: planoSaude || undefined,
          condicao: condicao || undefined,
          observacoes: observacoes || undefined,
          documentos: docsList,
          lgpdConsentimento: {
            dadosMenor: consent2,
            dadosSensiveis: consent1,
            comunicacoes: consent3,
            politicaPrivacidade: consent4,
            dataConsentimento: new Date().toISOString()
          }
        });
      }

      onSuccess(updatedUser);
      setSuccessMsg('Cadastro geral, laudos e termos de consentimento LGPD atualizados com sucesso!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Ocorreu um erro ao salvar o perfil e os dados do aluno.');
      }
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

  const hasTempCpf = user.cpf?.startsWith('temp_cpf');
  const isButtonDisabled = loading || !consent1 || !consent2 || !consent3 || !consent4;

  return (
    <article className={styles.profileViewCard} aria-label="Editar dados cadastrais e termo LGPD">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        <h2>
          <i className="ti ti-signature" aria-hidden="true" />
          Cadastro e Proteção de Dados (LGPD)
        </h2>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#22c55e', padding: '6px 12px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600 }}>
          <i className="ti ti-shield-check" style={{ fontSize: '0.9rem' }} />
          Em conformidade com a LGPD
        </div>
      </div>
      
      <p className={styles.subtitle}>
        Confirme seus dados cadastrais, atualize as informações de saúde/laudos do seu filho(a) e assine as autorizações obrigatórias.
      </p>

      {/* Interactive Tabs */}
      <div className={styles.profileTabs} style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <button 
          type="button"
          onClick={() => setActiveTab('responsavel')}
          className={`${styles.tabBtn} ${activeTab === 'responsavel' ? styles.active : ''}`}
          style={{ background: activeTab === 'responsavel' ? 'rgba(6, 182, 212, 0.15)' : 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: activeTab === 'responsavel' ? '#06b6d4' : '#94a3b8', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}
        >
          <i className="ti ti-user" /> Responsável Legal
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('filho')}
          className={`${styles.tabBtn} ${activeTab === 'filho' ? styles.active : ''}`}
          style={{ background: activeTab === 'filho' ? 'rgba(6, 182, 212, 0.15)' : 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: activeTab === 'filho' ? '#06b6d4' : '#94a3b8', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}
        >
          <i className="ti ti-users" /> Dados do Filho & Endereço
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('saude')}
          className={`${styles.tabBtn} ${activeTab === 'saude' ? styles.active : ''}`}
          style={{ background: activeTab === 'saude' ? 'rgba(6, 182, 212, 0.15)' : 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: activeTab === 'saude' ? '#06b6d4' : '#94a3b8', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}
        >
          <i className="ti ti-heart-handshake" /> Saúde & Laudos Médicos
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('lgpd')}
          className={`${styles.tabBtn} ${activeTab === 'lgpd' ? styles.active : ''}`}
          style={{ background: activeTab === 'lgpd' ? 'rgba(6, 182, 212, 0.15)' : 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: activeTab === 'lgpd' ? '#06b6d4' : '#94a3b8', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}
        >
          <i className="ti ti-shield-lock" /> Termos LGPD e Retenção
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className={styles.sidebarError} role="alert" style={{ marginBottom: '20px' }}>
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{ marginBottom: '24px', padding: '12px 16px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600 }} role="alert">
          <i className="ti ti-circle-check-filled" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      )}

      {loadingStudent ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '12px' }}>
          <span className={styles.spinner} />
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Buscando cadastro completo do aluno no banco de dados…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {/* TAB 1: DADOS DO RESPONSÁVEL */}
          {activeTab === 'responsavel' && (
            <div className={styles.profileFormSection}>
              {/* Avatar Section */}
              <div className={styles.avatarSection} style={{ marginBottom: '20px' }}>
                <div className={styles.avatarUploadPreview}>
                  <span>{getInitials(nome)}</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Responsável Cadastrado</span>
              </div>

              <h3 className={styles.profileSectionTitle}>
                <i className="ti ti-id-badge" /> Informações do Responsável Legal
              </h3>

              <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                <label className={styles.formLabel}>Nome Completo</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-user" aria-hidden="true" />
                  <input
                    type="text"
                    className={styles.formInput}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>CPF</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-id" aria-hidden="true" />
                    <input
                      type="text"
                      className={styles.formInput}
                      value={hasTempCpf && cpf.startsWith('temp_cpf') ? '' : cpf}
                      placeholder="000.000.000-00"
                      onChange={handleCpfChange}
                      required
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Telefone Celular</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-phone" aria-hidden="true" />
                    <input
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
            </div>
          )}

          {/* TAB 2: DADOS DO FILHO E ENDEREÇO */}
          {activeTab === 'filho' && (
            <div className={styles.profileFormSection}>
              <h3 className={styles.profileSectionTitle}>
                <i className="ti ti-school" /> Dados Básicos do Filho
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Nome Completo</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-user" />
                    <input
                      type="text"
                      className={styles.formInput}
                      value={`${nomeAluno} ${sobrenomeAluno}`}
                      disabled
                      style={{ opacity: 0.7 }}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Matrícula / RA</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-numbers" />
                    <input
                      type="text"
                      className={styles.formInput}
                      value={matriculaAluno}
                      disabled
                      style={{ opacity: 0.7 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Data de Nascimento</label>
                  <div className={styles.inputWrapper}>
                    <input
                      type="date"
                      className={styles.formInput}
                      value={nascimentoAluno}
                      onChange={(e) => setNascimentoAluno(e.target.value)}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Turma</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-door" />
                    <input
                      type="text"
                      className={styles.formInput}
                      value={turmaAluno}
                      disabled
                      style={{ opacity: 0.7 }}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Nível</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-chart-bar" />
                    <select
                      className={styles.formInput}
                      value={nivelAluno}
                      onChange={(e) => setNivelAluno(e.target.value)}
                      style={{ background: '#1a1a2e', color: '#fff' }}
                    >
                      <option value="">Não informado</option>
                      <option value="Básico">Básico</option>
                      <option value="Intermediário">Intermediário</option>
                      <option value="Avançado">Avançado</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>CPF do Aluno</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-id" />
                    <input
                      type="text"
                      className={styles.formInput}
                      value={cpfAluno}
                      placeholder="000.000.000-00"
                      onChange={handleCpfAlunoChange}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Nacionalidade</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-world" />
                    <input
                      type="text"
                      className={styles.formInput}
                      value={nacionalidadeAluno}
                      onChange={(e) => setNacionalidadeAluno(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Cor / Etnia <span style={{ fontSize: '0.62rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>Sensível</span>
                  </label>
                  <select
                    className={styles.formInput}
                    value={etniaAluno}
                    onChange={(e) => setEtniaAluno(e.target.value)}
                    style={{ background: '#1a1a2e', color: '#fff' }}
                  >
                    <option value="">Prefere não informar</option>
                    <option value="Branca">Branca</option>
                    <option value="Preta">Preta</option>
                    <option value="Parda">Parda</option>
                    <option value="Amarela">Amarela</option>
                    <option value="Indígena">Indígena</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Religião <span style={{ fontSize: '0.62rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>Sensível</span>
                  </label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-award" />
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Opcional"
                      value={religiaoAluno}
                      onChange={(e) => setReligiaoAluno(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* ADDRESS SECTION */}
              <h3 className={styles.profileSectionTitle} style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                <i className="ti ti-map-pin" style={{ color: '#10b981' }} /> Endereço Residencial
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>CEP</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-mailbox" />
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="00000-000"
                      value={cep}
                      onChange={handleCepChange}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Logradouro</label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-road" />
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Rua, Avenida, Travessa..."
                      value={logradouro}
                      onChange={(e) => setLogradouro(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Número</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="S/N"
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Complemento</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Bloco, apto, fundos..."
                    value={complemento}
                    onChange={(e) => setComplemento(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Bairro</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Bairro"
                    value={bairro}
                    onChange={(e) => setBairro(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Cidade</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Cidade"
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Estado</label>
                  <select
                    className={styles.formInput}
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    style={{ background: '#1a1a2e', color: '#fff' }}
                  >
                    <option value="SP">SP</option>
                    <option value="RJ">RJ</option>
                    <option value="MG">MG</option>
                    <option value="PR">PR</option>
                    <option value="SC">SC</option>
                    <option value="RS">RS</option>
                    <option value="DF">DF</option>
                    <option value="BA">BA</option>
                    <option value="GO">GO</option>
                    <option value="PE">PE</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SAÚDE E LAUDOS MÉDICOS */}
          {activeTab === 'saude' && (
            <div className={styles.profileFormSection}>
              <h3 className={styles.profileSectionTitle} style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                <i className="ti ti-heart-pulse" style={{ color: '#ef4444' }} /> Saúde & Necessidades Especiais
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Possui Deficiência (PCD)?</label>
                  <select
                    className={styles.formInput}
                    value={pcd}
                    onChange={(e) => setPcd(e.target.value as 'Sim' | 'Não')}
                    style={{ background: '#1a1a2e', color: '#fff' }}
                  >
                    <option value="Não">Não</option>
                    <option value="Sim">Sim</option>
                  </select>
                </div>

                {pcd === 'Sim' && (
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Especifique a Deficiência</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Ex: Visual, Auditiva, TEA, Autismo..."
                      value={deficiencia}
                      onChange={(e) => setDeficiencia(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Alergias Alimentares</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Ex: Glúten, Lactose, Corantes ou nenhuma"
                    value={alergiasAlimentos}
                    onChange={(e) => setAlergiasAlimentos(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Alergias Medicamentosas</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Ex: Penicilina, Ibuprofeno..."
                    value={alergiasRemedio}
                    onChange={(e) => setAlergiasRemedio(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Plano de Saúde</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Nome do plano de saúde ou 'Nenhum'"
                    value={planoSaude}
                    onChange={(e) => setPlanoSaude(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Condição Especial</label>
                  <select
                    className={styles.formInput}
                    value={condicao}
                    onChange={(e) => setCondicao(e.target.value)}
                    style={{ background: '#1a1a2e', color: '#fff' }}
                  >
                    <option value="">Nenhuma</option>
                    <option value="Autismo (TEA)">Autismo (TEA)</option>
                    <option value="TDAH">TDAH</option>
                    <option value="Dislexia">Dislexia</option>
                    <option value="Outra">Outra</option>
                  </select>
                </div>
              </div>

              <div className={styles.formGroup} style={{ marginBottom: '24px' }}>
                <label className={styles.formLabel}>Observações Pedagógicas / Cuidados</label>
                <textarea
                  className={styles.formInput}
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  placeholder="Informações relevantes sobre a saúde do seu filho para os professores..."
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
              </div>

              {/* UPLOAD DOCUMENT ZONE */}
              <h3 className={styles.profileSectionTitle} style={{ borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                <i className="ti ti-folder" style={{ color: '#8b5cf6' }} /> Documentos & Laudos Digitais
              </h3>

              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(139, 92, 246, 0.06)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', color: '#d8b4fe', fontSize: '0.8rem', display: 'flex', gap: '8px' }}>
                <i className="ti ti-info-circle" style={{ fontSize: '1.1rem', marginTop: '2px' }} />
                <span>Formatos aceitos: PDF, JPG, PNG. Tamanho máximo: 10 MB por arquivo. Os laudos são criptografados com acesso restrito.</span>
              </div>

              {/* Drag and Drop zone */}
              <div 
                className={`${styles.docUploadZone} ${dragOver ? styles.dragOver : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFileUpload(e.dataTransfer.files);
                }}
                onClick={() => document.getElementById('portalDocInput')?.click()}
                style={{ border: dragOver ? '2px dashed #8b5cf6' : '2px dashed rgba(255,255,255,0.12)', borderRadius: '12px', padding: '32px', textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', transition: 'all 0.2s', marginBottom: '20px' }}
              >
                <input 
                  type="file" 
                  id="portalDocInput" 
                  accept=".pdf,.jpg,.jpeg,.png"
                  multiple 
                  onChange={(e) => handleFileUpload(e.target.files)} 
                  style={{ display: 'none' }} 
                />
                <i className="ti ti-cloud-upload" style={{ fontSize: '2.5rem', color: '#8b5cf6', display: 'block', marginBottom: '8px' }} />
                <p style={{ fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 600 }}>Clique ou arraste arquivos aqui</p>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PDF, JPG ou PNG — no máximo 10 MB cada</span>
              </div>

              {/* Upload Loader */}
              {uploadingDoc && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: '#8b5cf6', fontSize: '0.85rem' }}>
                  <span className={styles.spinnerSm} />
                  <span>Enviando documento de forma segura para o servidor…</span>
                </div>
              )}

              {/* List of uploaded documents */}
              {docsList.length > 0 ? (
                <div className={styles.docList} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {docsList.map((doc, idx) => (
                    <div key={doc.id || idx} className={styles.docItem} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="ti ti-file-text" style={{ fontSize: '1.25rem', color: '#06b6d4' }} />
                        <span style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 500 }}>{doc.nome}</span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>({(doc.tamanho / 1024).toFixed(0)} KB)</span>
                      </div>
                      <button 
                        type="button"
                        onClick={() => handleRemoveDoc(doc.id)}
                        className={styles.docItemRemove}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', fontSize: '1.1rem' }}
                        title="Remover documento"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', textAlign: 'center' }}>Nenhum laudo médico anexado.</p>
              )}
            </div>
          )}

          {/* TAB 4: LGPD CONSENTIMENTOS E RETENÇÃO */}
          {activeTab === 'lgpd' && (
            <div className={styles.profileFormSection}>
              {/* RETENTION POLICY TABLE */}
              <h3 className={styles.profileSectionTitle}>
                <i className="ti ti-clock" /> Política de Retenção de Dados
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '16px', lineHeight: 1.5 }}>
                Conforme as diretrizes da <strong>ANPD (Autoridade Nacional de Proteção de Dados)</strong> e o Art. 15 da LGPD, os dados escolares e de saúde são mantidos estritamente pelo prazo mínimo necessário.
              </p>

              <table className={styles.retentionTable} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '32px' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 600, color: '#94a3b8' }}>CATEGORIA</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, color: '#94a3b8' }}>PRAZO DE RETENÇÃO</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, color: '#94a3b8' }}>BASE LEGAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px 12px' }}>Dados acadêmicos (notas, frequência)</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>5 anos</span> após desligamento</td>
                    <td style={{ padding: '8px 12px' }}>Obrigação legal — LDB</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px 12px' }}>Dados de saúde e PCD / Laudos</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>5 anos</span> após desligamento</td>
                    <td style={{ padding: '8px 12px' }}>Art. 11 LGPD — interesse público</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px 12px' }}>Documentos digitalizados</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>2 anos</span> após desligamento</td>
                    <td style={{ padding: '8px 12px' }}>Consentimento (Art. 7, I)</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px 12px' }}>Dados do responsável legal</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>5 anos</span> após desligamento</td>
                    <td style={{ padding: '8px 12px' }}>Obrigação legal — ECA</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px' }}>Log de auditoria</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>Permanente</span></td>
                    <td style={{ padding: '8px 12px' }}>ANPD — imutabilidade</td>
                  </tr>
                </tbody>
              </table>

              {/* CONSENT CHECKBOXES */}
              <h3 className={styles.profileSectionTitle} style={{ borderColor: 'rgba(6, 182, 212, 0.3)' }}>
                <i className="ti ti-shield-lock" style={{ color: '#06b6d4' }} /> Termo de Consentimento e Privacidade
              </h3>
              
              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(6, 182, 212, 0.06)', border: '1px solid rgba(6, 182, 212, 0.2)', borderRadius: '8px', color: '#a5f3fc', fontSize: '0.8rem', display: 'flex', gap: '8px' }}>
                <i className="ti ti-info-circle" style={{ fontSize: '1.1rem', marginTop: '2px' }} />
                <span>
                  Todos os consentimentos abaixo são <strong>obrigatórios</strong> para conformidade legal e ativação completa do acesso ao portal escolar dos alunos.
                </span>
              </div>

              {/* Consent 1 */}
              <div 
                className={`${styles.consentItem} ${consent1 ? styles.checked : ''}`}
                onClick={() => setConsent1(!consent1)}
              >
                <input
                  type="checkbox"
                  id="c1"
                  checked={consent1}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent1(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Autorização para tratamento de dados do Responsável
                    <span className={styles.consentArt}>Art. 7, I LGPD</span>
                  </div>
                  <div className={styles.consentItemDesc}>
                    Autorizo a instituição de ensino a coletar, armazenar e tratar meus dados pessoais cadastrados (nome, CPF, telefone celular) para fins de identificação, segurança nas dependências escolares, faturamento e gestão administrativa.
                  </div>
                </div>
              </div>

              {/* Consent 2 */}
              <div 
                className={`${styles.consentItem} ${consent2 ? styles.checked : ''}`}
                onClick={() => setConsent2(!consent2)}
              >
                <input
                  type="checkbox"
                  id="c2"
                  checked={consent2}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent2(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Exibição e tratamento de dados escolares do menor
                    <span className={styles.consentArt}>Art. 14 LGPD</span>
                  </div>
                  <div className={styles.consentItemDesc}>
                    Como responsável legal do menor vinculado à minha conta, autorizo a exibição de suas notas acadêmicas, boletins, relatórios pedagógicos, endereço residencial, saúde e controle de faltas diretamente no ambiente logado do Portal do Responsável.
                  </div>
                </div>
              </div>

              {/* Consent 3 */}
              <div 
                className={`${styles.consentItem} ${consent3 ? styles.checked : ''}`}
                onClick={() => setConsent3(!consent3)}
              >
                <input
                  type="checkbox"
                  id="c3"
                  checked={consent3}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent3(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Autorização para notificações e comunicados escolares
                  </div>
                  <div className={styles.consentItemDesc}>
                    Autorizo o envio de alertas automáticos sobre faltas, liberação de notas bimestrais, recados institucionais, convites para reuniões de pais e comunicados gerais de interesse pedagógico para meu e-mail e telefone cadastrados.
                  </div>
                </div>
              </div>

              {/* Consent 4 */}
              <div 
                className={`${styles.consentItem} ${consent4 ? styles.checked : ''}`}
                onClick={() => setConsent4(!consent4)}
              >
                <input
                  type="checkbox"
                  id="c4"
                  checked={consent4}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent4(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Ciência das Políticas de Privacidade e Direitos do Titular
                    <span className={styles.consentArt}>Art. 18 LGPD</span>
                  </div>
                  <div className={styles.consentItemDesc}>
                    Declaro ciência dos meus direitos de acesso, retificação, portabilidade, anonimização ou exclusão dos meus dados da base institucional, conforme garantido pelo Art. 18 da LGPD, bem como da leitura prévia da{' '}
                    <a href="/politica-privacidade.html" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      Política de Privacidade Completa da Escola
                    </a>.
                  </div>
                </div>
              </div>

              {/* DPO details */}
              <div className={styles.dpoBox}>
                <i className="ti ti-shield-check" />
                <div className={styles.dpoBoxBody}>
                  <div className={styles.dpoBoxTitle}>Encarregado pelo Tratamento de Dados (DPO)</div>
                  <div className={styles.dpoBoxDesc}>
                    Para exercer seus direitos LGPD ou tirar qualquer dúvida relacionada à privacidade dos seus dados, entre em contato diretamente com o DPO da escola via e-mail:{' '}
                    <a href="mailto:dpo@escola.edu.br" onClick={(e) => e.stopPropagation()}>
                      dpo@escola.edu.br
                    </a>.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isButtonDisabled}
            style={{ background: isButtonDisabled ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #06b6d4, #8b5cf6)', border: 'none', fontWeight: 700, transition: 'all 0.3s', display: 'block', width: '100%', padding: '14px', borderRadius: '12px', cursor: isButtonDisabled ? 'not-allowed' : 'pointer', color: '#fff', fontSize: '0.95rem', marginTop: '32px' }}
          >
            {loading ? 'Processando...' : 'Salvar Cadastro Completo e Assinar Termo LGPD'}
          </button>
        </form>
      )}
    </article>
  );
}
