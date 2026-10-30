import { Router } from 'express';
import { settlementController } from '../controllers/settlement.controller';
import { authenticateJwt, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { Role } from '../shared';
import {
  disburseSettlementSchema,
  generateSettlementBatchSchema,
  refundAdmissionSchema,
  verifyAdmissionSchema
} from '../validators/settlement.validator';

const router = Router();

// Guard all settlement and admission verification routes: ADMIN only
router.use(authenticateJwt, requireRole([Role.ADMIN]));

// Admissions verification console
router.get('/admissions', (req, res, next) => settlementController.getAdmissions(req, res, next));
router.post('/admissions/:id/verify', validateBody(verifyAdmissionSchema), (req, res, next) =>
  settlementController.verifyAdmission(req, res, next)
);
router.post('/admissions/:id/refund', validateBody(refundAdmissionSchema), (req, res, next) =>
  settlementController.refundAdmission(req, res, next)
);

// Settlements batching & disbursal
router.get('/stats', (req, res, next) => settlementController.getStats(req, res, next));
router.get('/', (req, res, next) => settlementController.getSettlements(req, res, next));
router.get('/:id', (req, res, next) => settlementController.getSettlementById(req, res, next));
router.post('/generate-batch', validateBody(generateSettlementBatchSchema), (req, res, next) =>
  settlementController.generateSettlementBatch(req, res, next)
);
router.post('/:id/disburse', validateBody(disburseSettlementSchema), (req, res, next) =>
  settlementController.disburseSettlement(req, res, next)
);
router.post('/evaluate-cooling-off', (req, res, next) =>
  settlementController.evaluateCoolingOff(req, res, next)
);

export default router;

