import { Router } from 'express';
import { reportController } from '../controllers/report.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { Role } from '../shared';

const router = Router();

// Reports and Analytics are executive BI consoles: guarded for ADMIN
router.use(authenticateJwt, requireRole([Role.ADMIN]));

router.get('/overview', (req, res, next) => reportController.getOverview(req, res, next));
router.get('/partners-roi', (req, res, next) => reportController.getPartnerRoi(req, res, next));
router.get('/counsellors-performance', (req, res, next) =>
  reportController.getCounsellorPerformance(req, res, next)
);
router.get('/sales-performance', (req, res, next) =>
  reportController.getSalesPerformance(req, res, next)
);
router.get('/export', (req, res, next) => reportController.exportCsv(req, res, next));

export default router;

