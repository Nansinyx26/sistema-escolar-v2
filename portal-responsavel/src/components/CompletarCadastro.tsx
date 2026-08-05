import { useState } from 'react';
import { updateProfile, ApiError } from '../services/apiService';
import type { AuthUser } from '../types';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface CompletarCadastroProps {
  user: AuthUser;
  onSuccess: (updatedUser: AuthUser) => void;
}

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export default function CompletarCadastro({ user, onSuccess }: CompletarCadastroProps) {
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [finalUser, setFinalUser] = useState<AuthUser | null>(null);

  // ─── Form State ────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    nome: user.nome || '',
    email: user.email || '',
    telefone: (user as any).telefone || '',
    whatsApp: (user as any).whatsApp || '',
    vinculoAluno: (user as any).vinculoAluno || '',
    responsavelPrincipal: (user as any).responsavelPrincipal || false,
    guardaLegal: (user as any).guardaLegal || false,
    autorizadoRetirar: (user as any).autorizadoRetirar || false,
    
    segundoResponsavel: (user as any).segundoResponsavel || {
      nome: '',
      vinculo: '',
      telefone: '',
      whatsApp: '',
      email: '',
      guardaLegal: false,
      autorizadoRetirar: false,
      principal: false
    },

    pessoasAutorizadas: ((user as any).pessoasAutorizadas || []) as Array<{
      nome: string;
      parentesco: string;
      telefone: string;
      observacoes: string;
    }>,

    lgpdConsents: (user as any).lgpdConsents || {
      imagemInternaFotos: false,
      imagemInternaVideos: false,
      imagemSite: false,
      imagemRedes: false,
      comunicadosEmail: false,
      comunicadosWhatsApp: false,
      comunicadosSistema: false,
      pedagogicoTrabalhos: false,
      pedagogicoProjetos: false,
      pedagogicoMaker: false,
      pedagogicoFeiras: false,
      institucionalSecretaria: false,
      institucionalSistemas: false,
      institucionalPlataformas: false
    },
    agreeTerms: false
  });

  const [authorizedPerson, setAuthorizedPerson] = useState({
    nome: '',
    parentesco: '',
    telefone: '',
    observacoes: ''
  });
  const [viewingPolicy, setViewingPolicy] = useState<string | null>(null);
  const [signatureMethod, setSignatureMethod] = useState<'digital' | 'manual'>('digital');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateSubField = (parent: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [parent]: { ...(prev as any)[parent], [field]: value }
    }));
  };

  const addAuthorizedPerson = () => {
    if (!authorizedPerson.nome || !authorizedPerson.telefone) {
      setError('Nome e telefone são obrigatórios para autorizar uma pessoa.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      pessoasAutorizadas: [...prev.pessoasAutorizadas, authorizedPerson]
    }));
    setAuthorizedPerson({ nome: '', parentesco: '', telefone: '', observacoes: '' });
    setError('');
  };

  const removeAuthorizedPerson = (index: number) => {
    setFormData(prev => ({
      ...prev,
      pessoasAutorizadas: prev.pessoasAutorizadas.filter((_, i) => i !== index)
    }));
  };

  const handlePhoneMask = (val: string) => {
    let raw = val.replace(/\D/g, '');
    if (raw.length > 11) raw = raw.slice(0, 11);
    if (raw.length > 10) return raw.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (raw.length > 6) return raw.replace(/^(\d{2})(\d{4})(\d{1,4})$/, '($1) $2-$3');
    if (raw.length > 2) return raw.replace(/^(\d{2})(\d{1,4})$/, '($1) $2');
    return raw;
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const recordsToSign = [
        { termoId: 'politica_privacidade', versao: '2.0' },
        { termoId: 'termos_uso', versao: '2.0' },
        { termoId: 'politica_dados', versao: '2.0' }
      ];

      const updatedUser = await updateProfile({
        ...formData,
        consentimentoAceiteEm: true,
        profileCompleted: true,
        newLgpdRecords: recordsToSign
      } as any);

      setFinalUser(updatedUser);
      setStep(7);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar cadastro.');
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    setError('');
    // Validation per step
    if (step === 1) {
      if (!formData.nome || !formData.telefone || !formData.email) {
        setError('Preencha os campos obrigatórios de identificação.');
        return;
      }
    }
    if (step === 2) {
      if (!formData.vinculoAluno) {
        setError('Selecione seu vínculo com o aluno.');
        return;
      }
    }
    if (step === 6) {
      if (!formData.agreeTerms) {
        setError('Você deve aceitar os termos de uso e privacidade.');
        return;
      }
      handleSubmit();
      return;
    }
    setStep(prev => (prev + 1) as Step);
  };

  const prevStep = () => {
    setError('');
    setStep(prev => (prev - 1) as Step);
  };

  // ─── Renderers ─────────────────────────────────────────────────────────────
  
  const renderProgressBar = () => (
    <div className={styles.onboardingProgress}>
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <div 
          key={i} 
          className={`${styles.progressDot} ${step >= i ? styles.active : ''} ${step > i ? styles.completed : ''}`}
        />
      ))}
    </div>
  );

  return (
    <div className={styles.onboardingContainer}>
      <div className={styles.onboardingCard}>
        {step < 7 && renderProgressBar()}

        {error && (
          <div className={styles.errorAlert} style={{ margin: '16px' }}>
            <Icon name="alert-circle" /> {error}
          </div>
        )}

        {/* STEP 0: WELCOME */}
        {step === 0 && (
          <div className={styles.onboardingStep}>
            <div className={styles.stepIcon} style={{ background: 'linear-gradient(135deg, #10b981, #8b5cf6)' }}>
              <Icon name="confetti" />
            </div>
            <h2>Bem-vindo ao Portal do Responsável!</h2>
            <p>
              Estamos felizes em tê-lo conosco. Para garantir a segurança das informações e a conformidade com a <strong>LGPD</strong>, 
              precisamos concluir seu cadastro em poucas etapas rápidas.
            </p>
            <div className={styles.stepFooter}>
              <button className={styles.primaryBtn} onClick={nextStep}>
                Começar agora <Icon name="arrow-right" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: IDENTIFICATION */}
        {step === 1 && (
          <div className={styles.onboardingStep}>
            <h3><Icon name="id-badge" /> Identificação da Conta</h3>
            <div className={styles.accountBadge}>
              <i className={`ti ${user.loginGoogle ? 'ti-brand-google' : 'ti-user-circle'}`} />
              <div>
                <strong>{user.loginGoogle ? 'Conta Google' : 'Conta Local'}</strong>
                <span>Criada em: {user.criadoEm ? new Date(user.criadoEm).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeader}>
                <Icon name="user-circle" />
                <h4>Dados Pessoais</h4>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>Nome Completo</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="user" />
                    <input 
                      type="text" 
                      value={formData.nome} 
                      onChange={e => updateField('nome', e.target.value)} 
                      placeholder="Como deseja ser chamado?"
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>E-mail</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="mail" />
                    <input 
                      type="email" 
                      value={formData.email} 
                      onChange={e => updateField('email', e.target.value)}
                      placeholder="seu@email.com"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeader}>
                <Icon name="phone-call" />
                <h4>Contatos</h4>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>Telefone Principal</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="phone" />
                    <input 
                      type="text" 
                      value={formData.telefone} 
                      onChange={e => updateField('telefone', handlePhoneMask(e.target.value))}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>WhatsApp (Opcional)</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="brand-whatsapp" />
                    <input 
                      type="text" 
                      value={formData.whatsApp} 
                      onChange={e => updateField('whatsApp', handlePhoneMask(e.target.value))}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.stepFooter}>
              <button className={styles.secondaryBtn} onClick={prevStep}>Voltar</button>
              <button className={styles.primaryBtn} onClick={nextStep}>Próximo</button>
            </div>
          </div>
        )}

        {/* STEP 2: STUDENT LINK */}
        {step === 2 && (
          <div className={styles.onboardingStep}>
            <h3><Icon name="users-group" /> Vínculo com o Aluno</h3>
            <p>Selecione seu grau de parentesco ou responsabilidade legal.</p>
            
            <div className={styles.formSection}>
              <div className={styles.sectionHeader}>
                <Icon name="link" />
                <h4>Grau de Parentesco</h4>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>Tipo de Responsável</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="affiliate" />
                    <select value={formData.vinculoAluno} onChange={e => updateField('vinculoAluno', e.target.value)}>
                      <option value="">Selecione...</option>
                      <option>Pai</option>
                      <option>Mãe</option>
                      <option>Avô</option>
                      <option>Avó</option>
                      <option>Tio</option>
                      <option>Tia</option>
                      <option>Irmão</option>
                      <option>Irmã</option>
                      <option>Tutor Legal</option>
                      <option>Responsável Legal</option>
                      <option>Guardião Judicial</option>
                      <option>Outro</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeader}>
                <Icon name="gavel" />
                <h4>Responsabilidade e Guarda</h4>
              </div>
              <div className={styles.checkboxGrid}>
                <label className={styles.checkItem}>
                  <input type="checkbox" checked={formData.responsavelPrincipal} onChange={e => updateField('responsavelPrincipal', e.target.checked)} />
                  <div className={styles.checkLabel}>
                    <strong>Responsável Principal?</strong>
                    <span>Você é o principal ponto de contato da escola?</span>
                  </div>
                </label>
                <label className={styles.checkItem}>
                  <input type="checkbox" checked={formData.guardaLegal} onChange={e => updateField('guardaLegal', e.target.checked)} />
                  <div className={styles.checkLabel}>
                    <strong>Possui Guarda Legal?</strong>
                    <span>Você detém a guarda jurídica do menor?</span>
                  </div>
                </label>
                <label className={styles.checkItem}>
                  <input type="checkbox" checked={formData.autorizadoRetirar} onChange={e => updateField('autorizadoRetirar', e.target.checked)} />
                  <div className={styles.checkLabel}>
                    <strong>Autorizado a Retirar?</strong>
                    <span>Você pode retirar o aluno da escola?</span>
                  </div>
                </label>
              </div>
            </div>

            <div className={styles.stepFooter}>
              <button className={styles.secondaryBtn} onClick={prevStep}>Voltar</button>
              <button className={styles.primaryBtn} onClick={nextStep}>Próximo</button>
            </div>
          </div>
        )}

        {/* STEP 3: SECOND GUARDIAN (OPTIONAL) */}
        {step === 3 && (
          <div className={styles.onboardingStep}>
            <h3><Icon name="user-plus" /> Segundo Responsável (Opcional)</h3>
            <p>Deseja cadastrar uma segunda pessoa de contato?</p>
            
            <div className={styles.formSection}>
              <div className={styles.sectionHeader}>
                <Icon name="id" />
                <h4>Identificação do 2º Responsável</h4>
              </div>
              <div className={styles.formGrid}>
                 <div className={styles.formGroup}>
                  <label>Nome Completo</label>
                  <div className={styles.inputWrapper}><Icon name="user" />
                    <input type="text" value={formData.segundoResponsavel.nome} onChange={e => updateSubField('segundoResponsavel', 'nome', e.target.value)} placeholder="Nome do segundo responsável" />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>Vínculo</label>
                  <div className={styles.inputWrapper}><Icon name="affiliate" />
                    <select value={formData.segundoResponsavel.vinculo} onChange={e => updateSubField('segundoResponsavel', 'vinculo', e.target.value)}>
                      <option value="">Selecione...</option>
                      <option>Pai</option><option>Mãe</option><option>Avô/Avó</option><option>Tio/Tia</option><option>Outros</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeader}>
                <Icon name="device-mobile" />
                <h4>Contatos Adicionais</h4>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>Telefone</label>
                  <div className={styles.inputWrapper}><Icon name="phone" />
                    <input type="text" value={formData.segundoResponsavel.telefone} onChange={e => updateSubField('segundoResponsavel', 'telefone', handlePhoneMask(e.target.value))} placeholder="(00) 00000-0000" />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>E-mail</label>
                  <div className={styles.inputWrapper}><Icon name="mail" />
                    <input type="email" value={formData.segundoResponsavel.email} onChange={e => updateSubField('segundoResponsavel', 'email', e.target.value)} placeholder="email@exemplo.com" />
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.stepFooter}>
              <button className={styles.secondaryBtn} onClick={prevStep}>Voltar</button>
              <button className={styles.primaryBtn} onClick={nextStep}>Próximo</button>
            </div>
          </div>
        )}

        {/* STEP 4: AUTHORIZED PEOPLE */}
        {step === 4 && (
          <div className={styles.onboardingStep}>
            <h3><Icon name="key" /> Pessoas Autorizadas a Retirar</h3>
            <p>Quem mais pode buscar o aluno na escola?</p>

            <div className={styles.listSection}>
              {formData.pessoasAutorizadas.map((p, i) => (
                <div key={i} className={styles.listItem}>
                  <div>
                    <strong>{p.nome}</strong>
                    <span>{p.parentesco} • {p.telefone}</span>
                  </div>
                  <button onClick={() => removeAuthorizedPerson(i)} className={styles.removeBtn}><Icon name="trash" /></button>
                </div>
              ))}
            </div>

            <div className={styles.addItemForm}>
              <input type="text" placeholder="Nome" value={authorizedPerson.nome} onChange={e => setAuthorizedPerson({...authorizedPerson, nome: e.target.value})} />
              <input type="text" placeholder="Parentesco" value={authorizedPerson.parentesco} onChange={e => setAuthorizedPerson({...authorizedPerson, parentesco: e.target.value})} />
              <input type="text" placeholder="Telefone" value={authorizedPerson.telefone} onChange={e => setAuthorizedPerson({...authorizedPerson, telefone: handlePhoneMask(e.target.value)})} />
              <button onClick={addAuthorizedPerson} className={styles.addBtn}>+ Adicionar</button>
            </div>

            <div className={styles.stepFooter}>
              <button className={styles.secondaryBtn} onClick={prevStep}>Voltar</button>
              <button className={styles.primaryBtn} onClick={nextStep}>Próximo</button>
            </div>
          </div>
        )}

        {/* STEP 5: LGPD CONSENTS */}
        {step === 5 && (
          <div className={styles.onboardingStep}>
            <h3><Icon name="shield-lock" /> Central de Privacidade LGPD</h3>
            <p>Seus dados são tratados com transparência. Defina suas preferências abaixo:</p>

            <div className={styles.consentScrollArea}>
              <div className={styles.consentSection}>
                <h4>Uso de Imagem</h4>
                <label><input type="checkbox" checked={formData.lgpdConsents.imagemInternaFotos} onChange={e => updateSubField('lgpdConsents', 'imagemInternaFotos', e.target.checked)} /> Fotos em atividades internas</label>
                <label><input type="checkbox" checked={formData.lgpdConsents.imagemInternaVideos} onChange={e => updateSubField('lgpdConsents', 'imagemInternaVideos', e.target.checked)} /> Vídeos em atividades internas</label>
                <label><input type="checkbox" checked={formData.lgpdConsents.imagemSite} onChange={e => updateSubField('lgpdConsents', 'imagemSite', e.target.checked)} /> Site institucional</label>
                <label><input type="checkbox" checked={formData.lgpdConsents.imagemRedes} onChange={e => updateSubField('lgpdConsents', 'imagemRedes', e.target.checked)} /> Redes sociais</label>
              </div>

              <div className={styles.consentSection}>
                <h4>Comunicação</h4>
                <label><input type="checkbox" checked={formData.lgpdConsents.comunicadosEmail} onChange={e => updateSubField('lgpdConsents', 'comunicadosEmail', e.target.checked)} /> Comunicados por E-mail</label>
                <label><input type="checkbox" checked={formData.lgpdConsents.comunicadosWhatsApp} onChange={e => updateSubField('lgpdConsents', 'comunicadosWhatsApp', e.target.checked)} /> Comunicados por WhatsApp</label>
                <label><input type="checkbox" checked={formData.lgpdConsents.comunicadosSistema} onChange={e => updateSubField('lgpdConsents', 'comunicadosSistema', e.target.checked)} /> Notificações do Sistema</label>
              </div>

              <div className={styles.consentSection}>
                <h4>Uso Pedagógico</h4>
                <label><input type="checkbox" checked={formData.lgpdConsents.pedagogicoTrabalhos} onChange={e => updateSubField('lgpdConsents', 'pedagogicoTrabalhos', e.target.checked)} /> Trabalhos escolares</label>
                <label><input type="checkbox" checked={formData.lgpdConsents.pedagogicoProjetos} onChange={e => updateSubField('lgpdConsents', 'pedagogicoProjetos', e.target.checked)} /> Projetos maker/pedagógicos</label>
              </div>
            </div>

            <div className={styles.stepFooter}>
              <button className={styles.secondaryBtn} onClick={prevStep}>Voltar</button>
              <button className={styles.primaryBtn} onClick={nextStep}>Próximo</button>
            </div>
          </div>
        )}

        {/* STEP 6: TERMS & SIGNATURE */}
        {step === 6 && (
          <div className={styles.onboardingStep}>
            <h3><Icon name="signature" /> Termos e Assinatura Eletrônica</h3>
            <p>Leia atentamente os documentos abaixo para finalizar.</p>

            <div className={styles.termsLinks}>
              <a href="#" onClick={e => { e.preventDefault(); setViewingPolicy('privacidade'); }}><Icon name="file-text" /> Política de Privacidade</a>
              <a href="#" onClick={e => { e.preventDefault(); setViewingPolicy('termos'); }}><Icon name="file-check" /> Termo de Uso</a>
              <a href="#" onClick={e => { e.preventDefault(); setViewingPolicy('lgpd'); }}><Icon name="database" /> Política de Tratamento de Dados</a>
            </div>

            <div className={styles.signatureMethodToggle}>
              <button 
                className={signatureMethod === 'digital' ? styles.active : ''} 
                onClick={() => setSignatureMethod('digital')}
              >
                <Icon name="signature" /> Assinatura Digital
              </button>
              <button 
                className={signatureMethod === 'manual' ? styles.active : ''} 
                onClick={() => setSignatureMethod('manual')}
              >
                <Icon name="upload" /> Upload de Documento
              </button>
            </div>

            {signatureMethod === 'digital' ? (
              <div className={styles.signatureBox}>
                <p>Ao marcar a prevenção abaixo, você confirma sua identidade e assina eletronicamente este termo de adesão.</p>
                <label className={styles.agreeLabel}>
                  <input type="checkbox" checked={formData.agreeTerms} onChange={e => updateField('agreeTerms', e.target.checked)} />
                  <span>Li e concordo com os termos apresentados.</span>
                </label>
                
                <div className={styles.signMetadata}>
                  <div><strong>Assinante:</strong> {formData.nome}</div>
                  <div><strong>E-mail:</strong> {formData.email}</div>
                  <div><strong>Data/Hora:</strong> {new Date().toLocaleString()}</div>
                  <div><strong>Login:</strong> {user.loginGoogle ? 'GoogleAccount' : 'Portal Local Authentication'}</div>
                </div>
              </div>
            ) : (
              <div className={styles.uploadBox}>
                <p>Caso tenha assinado os documentos fisicamente na secretaria, faça o upload da foto ou PDF do documento assinado abaixo.</p>
                <label className={styles.dropZone}>
                  <input 
                    type="file" 
                    accept="image/*,.pdf" 
                    onChange={e => setUploadedFile(e.target.files?.[0] || null)} 
                    style={{ display: 'none' }}
                  />
                  <Icon name="file-upload" />
                  {uploadedFile ? (
                    <div className={styles.fileInfo}>
                      <strong>{uploadedFile.name}</strong>
                      <span>{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB • Clique para trocar</span>
                    </div>
                  ) : (
                    <div className={styles.filePlaceholder}>
                      <strong>Clique para selecionar o arquivo</strong>
                      <span>Suporta Imagens (PNG, JPG) ou PDF</span>
                    </div>
                  )}
                </label>
              </div>
            )}

            <div className={styles.stepFooter}>
              <button className={styles.secondaryBtn} onClick={prevStep}>Voltar</button>
              <button className={styles.primaryBtn} disabled={loading} onClick={nextStep}>
                {loading ? 'Finalizando...' : 'Concluir Assinatura'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 7: RECEIPT */}
        {step === 7 && (
          <div className={styles.onboardingStep} style={{ textAlign: 'center' }}>
            <div className={styles.stepIcon} style={{ background: '#22c55e' }}>
              <Icon name="checkbox" />
            </div>
            <h2>Cadastro concluído com sucesso!</h2>
            <p>Suas credenciais de acesso foram geradas. Guarde estas informações para futuras consultas.</p>
            
            <div className={styles.receiptCard}>
              <h4>Comprovante de Cadastro Digital</h4>
              <div className={styles.receiptGrid}>
                <div className={styles.receiptItem}>
                  <label>ID da Conta</label>
                  <strong>{(finalUser as any)?.contaId || (user as any).contaId || 'RP-000123'}</strong>
                </div>
                <div className={styles.receiptItem}>
                  <label>Nome do Responsável</label>
                  <strong>{finalUser?.nome || user.nome || formData.nome}</strong>
                </div>
                <div className={styles.receiptItem}>
                  <label>E-mail de Acesso</label>
                  <strong>{finalUser?.email || user.email || formData.email}</strong>
                </div>
                <div className={styles.receiptItem}>
                  <label>Método de Acesso</label>
                  <strong>{finalUser?.loginGoogle ? 'Google Account' : 'Senha Local'}</strong>
                </div>
                <div className={styles.receiptItem}>
                  <label>Data de Criação</label>
                  <strong>{new Date().toLocaleDateString('pt-BR')}</strong>
                </div>
              </div>
            </div>

            <div className={styles.stepFooter} style={{ justifyContent: 'center', marginTop: '32px' }}>
              <button 
                className={styles.primaryBtn} 
                onClick={() => onSuccess(finalUser || user)}
                style={{ width: '100%', maxWidth: '300px' }}
              >
                Acessar Portal do Responsável <Icon name="arrow-right" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* POLICY MODAL */}
      {viewingPolicy && (
        <div className={styles.modalOverlay} onClick={() => setViewingPolicy(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className={styles.modalHeader}>
              <h3>
                {viewingPolicy === 'privacidade' && <><Icon name="file-text" /> Política de Privacidade</>}
                {viewingPolicy === 'termos' && <><Icon name="file-check" /> Termos de Uso</>}
                {viewingPolicy === 'lgpd' && <><Icon name="database" /> Política de Dados (LGPD)</>}
              </h3>
              <button className={styles.modalClose} onClick={() => setViewingPolicy(null)}><Icon name="x" /></button>
            </div>
            <div className={styles.modalMessage} style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto' }}>
              {viewingPolicy === 'privacidade' && (
                <>
                  <h4>1. Coleta de Informações</h4>
                  <p>A Escola Jaguari coleta dados essenciais para o registro acadêmico e segurança do aluno, incluindo nome, CPF, e-mail e contatos de emergência.</p>
                  
                  <h4>2. Uso dos Dados</h4>
                  <p>Os dados são utilizados exclusivamente para fins educacionais, emissão de documentos oficiais e comunicação direta entre a escola e os responsáveis.</p>
                  
                  <h4>3. Segurança</h4>
                  <p>Implementamos rigorosas medidas de segurança digital para proteger suas informações contra acesso não autorizado.</p>
                </>
              )}
              {viewingPolicy === 'termos' && (
                <>
                  <h4>1. Acesso ao Portal</h4>
                  <p>Este portal é de uso exclusivo dos responsáveis legais dos alunos matriculados na Escola Jaguari. As credenciais de acesso são pessoais e intransferíveis.</p>
                  
                  <h4>2. Responsabilidades</h4>
                  <p>É responsabilidade do usuário manter seus dados de contato atualizados e acompanhar as comunicações enviadas através deste canal.</p>
                  
                  <h4>3. Conduta Digital</h4>
                  <p>O uso inadequado das ferramentas ou condutas que violem as normas da instituição poderá resultar na suspensão do acesso.</p>
                </>
              )}
              {viewingPolicy === 'lgpd' && (
                <>
                  <h4>Conformidade LGPD (Lei 13.709/2018)</h4>
                  <p>Em total conformidade com a Lei Geral de Proteção de Dados, informamos:</p>
                  <ul>
                    <li><strong>Finalidade:</strong> O tratamento de dados ocorre para o cumprimento de obrigação legal e execução do contrato de serviço educacional.</li>
                    <li><strong>Compartilhamento:</strong> Seus dados não são vendidos ou compartilhados com terceiros para fins comerciais. O compartilhamento ocorre apenas com órgãos governamentais (como o MEC) por exigência legal.</li>
                    <li><strong>Seus Direitos:</strong> Você possui o direito de confirmar a existência do tratamento, acessar seus dados e solicitar correções.</li>
                  </ul>
                </>
              )}
            </div>
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className={styles.primaryBtn} onClick={() => setViewingPolicy(null)}>Entendi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
