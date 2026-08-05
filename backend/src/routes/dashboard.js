const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/DashboardController');
const authorize = require('../middleware/authorize');
const authJWT = require('../middleware/authJWT');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');

router.get('/public-summary', DashboardController.getPublicSummary);
router.get('/summary', authJWT, filtrarPorEscola, DashboardController.getSummary);
router.get('/chart-data', authJWT, filtrarPorEscola, DashboardController.getChartData);
router.get('/charts', authJWT, filtrarPorEscola, DashboardController.getChartData);
router.get('/ranking', authJWT, filtrarPorEscola, DashboardController.getRanking);
router.get('/teacher-panel', authJWT, filtrarPorEscola, DashboardController.getTeacherPanel);
router.get('/director-notices', authJWT, filtrarPorEscola, authorize('admin', 'diretor'), DashboardController.getDirectorNotices);
router.get('/summary/notices', authJWT, filtrarPorEscola, authorize('admin', 'diretor'), DashboardController.getDirectorNotices);

module.exports = router;
