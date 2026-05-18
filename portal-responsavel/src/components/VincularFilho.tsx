import { useState, useEffect } from 'react';
import { buscarAlunosParaVinculo, vincularAluno } from '../services/apiService';
import styles from '../styles/portal.module.scss';

interface SearchResult {
  id: string;
  nome: string;
  matricula: string;
  turma: string;
  vinculado: boolean;
}

interface VincularFilhoProps {
  onSuccess: () => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

export default function VincularFilho({ onSuccess, onCancel, canCancel = false }: VincularFilhoProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Modal de dupla confirmação
  const [selectedStudent, setSelectedStudent] = useState<SearchResult | null>(null);
  const [linking, setLinking] = useState(false);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setError('');
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await buscarAlunosParaVinculo(query);
        setResults(data);
        if (data.length === 0) {
          setError('Nenhum aluno encontrado.');
        }
      } catch (err: any) {
        setError(err.message || 'Erro ao buscar alunos.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  const handleLinkClick = (student: SearchResult) => {
    setSelectedStudent(student);
  };

  const handleConfirmLink = async () => {
    if (!selectedStudent) return;
    setLinking(true);
    setError('');
    
    try {
      await vincularAluno(selectedStudent.id);
      setSelectedStudent(null);
      onSuccess(); // Refetch user's students
    } catch (err: any) {
      setError(err.message || 'Erro ao vincular aluno.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className={styles.vincularContainer}>
      <div className={styles.vincularCard}>
        <h2><i className="ti ti-user-plus" aria-hidden="true" /> Vincular meu filho</h2>
        <p>Pesquise pelo nome completo ou matrícula do aluno para confirmar o vínculo.</p>

        <div className={styles.searchBox}>
          <i className="ti ti-search" aria-hidden="true" />
          <input 
            type="text" 
            placeholder="Digite o nome ou matrícula do aluno..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {loading && <p className={styles.loadingText}>Buscando alunos...</p>}
        {error && <p className={styles.errorText}>{error}</p>}

        {results.length > 0 && (
          <div className={styles.resultsList}>
            {results.map(aluno => (
              <div key={aluno.id} className={styles.resultItem}>
                <div className={styles.resultInfo}>
                  <div className={styles.resultAvatar}>{aluno.nome.charAt(0)}</div>
                  <div>
                    <h4>{aluno.nome}</h4>
                    <p>Turma: {aluno.turma} | Mat.: {aluno.matricula}</p>
                  </div>
                </div>
                
                {aluno.vinculado ? (
                  <span className={styles.badgeVinculado}>
                    <i className="ti ti-lock" aria-hidden="true" /> Já Vinculado
                  </span>
                ) : (
                  <button 
                    className={styles.btnVincular} 
                    onClick={() => handleLinkClick(aluno)}
                  >
                    Vincular
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canCancel && (
          <button className={styles.btnCancel} onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>

      {selectedStudent && (
        <div className={styles.modalOverlay} onClick={() => !linking && setSelectedStudent(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Confirmação de Vínculo</h2>
              <button 
                className={styles.modalClose} 
                onClick={() => !linking && setSelectedStudent(null)}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            
            <p>Você está prestes a vincular o seguinte aluno à sua conta:</p>
            <div className={styles.modalStudentCard}>
              <h3>{selectedStudent.nome}</h3>
              <p>Turma: {selectedStudent.turma} | Matrícula: {selectedStudent.matricula}</p>
            </div>
            <p className={styles.warningText}>
              <strong>Atenção:</strong> Por questões de segurança, este aluno será bloqueado para novos vínculos. 
              <br/><br/>Este aluno é realmente seu filho/responsabilidade?
            </p>

            {error && <p className={styles.errorText}>{error}</p>}

            <div className={styles.modalActions}>
              <button 
                className={styles.btnCancel} 
                onClick={() => setSelectedStudent(null)}
                disabled={linking}
              >
                Cancelar
              </button>
              <button 
                className={styles.btnConfirm} 
                onClick={handleConfirmLink}
                disabled={linking}
              >
                {linking ? 'Vinculando...' : 'Sim, confirmo o vínculo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
