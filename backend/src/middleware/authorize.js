/**
 * Middleware para Controle de Acesso Baseado em Cargos (RBAC)
 * @param {...String} allowedProfiles - Perfis permitidos (admin, diretor, professor, coordenacao)
 */
function authorize(...allowedProfiles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Usuário não autenticado' 
            });
        }

        const userProfile = (req.user.perfil || '').toLowerCase();
        const normalizedAllowed = allowedProfiles.flat().map(p => p.toLowerCase());

        // Admin tem acesso total sempre
        if (userProfile === 'admin') {
            return next();
        }

        if (normalizedAllowed.includes(userProfile)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            error: `Acesso negado. Requer perfil: [${allowedProfiles.join(', ')}]`
        });
    };
}

/**
 * Variante ESTRITA: mesmo RBAC, mas o atalho de `admin` acima deixa de valer
 * como passe livre entre escolas.
 *
 * O `authorize` normal libera `admin` antes de qualquer outra verificação, e
 * isso é adequado para quase tudo — o admin de plataforma precisa mesmo abrir
 * qualquer tela. O problema aparece em rota que serve CONTEÚDO de conversa: ali
 * o atalho vira acesso silencioso a mensagem de responsável e de aluno de
 * qualquer escola da base, sem que ninguém tenha escolhido um tenant.
 *
 * Aqui o admin continua passando, mas precisa dizer de qual escola está falando
 * (`filtrarPorEscola` resolveu `req.escolaId`, ou ele mandou `?escolaId=`). Não
 * é uma barreira de segurança forte — ele pode informar qualquer uma —, é uma
 * barreira de INTENÇÃO: o acesso deixa de ser efeito colateral do perfil e passa
 * a ser um ato deliberado, com escola registrada no AuditLog de quem chamar.
 *
 * Uso pretendido: rotas de /api/moderacao/* (fila e revisão de conteúdo
 * sinalizado). Ainda não há consumidor — ver docs/moderacao/ESPEC-MODERACAO-CHAT.md §7.2.
 */
authorize.estrito = function authorizeEstrito(...allowedProfiles) {
    const base = authorize(...allowedProfiles);

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
        }

        const perfil = String(req.user.perfil || '').toLowerCase();
        const escola = req.escolaId || req.query?.escolaId || req.body?.escolaId;

        if (perfil === 'admin' && !escola) {
            return res.status(400).json({
                success: false,
                codigo: 'ESCOLA_NAO_INFORMADA',
                error: 'Informe a escola (escolaId) para acessar conteúdo moderado.'
            });
        }

        return base(req, res, next);
    };
};

module.exports = authorize;
