/**
 * /api/superadmin — administração GLOBAL do sistema (Issue #463).
 *
 * `authJWT` e `requireSuperAdmin` são aplicados no MONTE (routes/api.js), para
 * uma rota nova neste arquivo nascer protegida sem depender de alguém lembrar.
 *
 * NÃO passa por `filtrarPorEscola`, de propósito: o super admin opera sobre a
 * rede inteira, e o filtro de tenant (assim como o bloqueio de escola que ele
 * aplica) não pode recortar esta área. O escopo de cada operação é o `:id`.
 */
const express = require('express');
const SuperAdminController = require('../controllers/SuperAdminController');

const router = express.Router();

router.get('/escolas', SuperAdminController.listar);
router.get('/escolas/:id', SuperAdminController.detalhar);
router.patch('/escolas/:id/bloquear', SuperAdminController.bloquear);
router.patch('/escolas/:id/desbloquear', SuperAdminController.desbloquear);
router.post('/escolas/:id/acessar', SuperAdminController.acessar);
router.get('/contexto', SuperAdminController.contexto);
router.delete('/contexto', SuperAdminController.sairContexto);

module.exports = router;
