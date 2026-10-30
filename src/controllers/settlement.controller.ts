import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { settlementService } from '../services/settlement.service';
import { AdmissionStatus, SettlementStatus } from '../shared';

export class SettlementController {
  async getAdmissions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as AdmissionStatus | undefined;
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await settlementService.getAdmissions({ status, search, page, limit });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  async verifyAdmission(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminUserId = req.user!.userId;
      const { id } = req.params;
      const result = await settlementService.verifyAdmission(adminUserId, id, req.body);
      res.status(200).json({
        success: true,
        data: result,
        message: req.body.approved
          ? 'Admission successfully verified. Partner commission credited to cooling-off period.'
          : 'Admission rejected and associated commission cancelled.'
      });
    } catch (err) {
      next(err);
    }
  }

  async refundAdmission(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminUserId = req.user!.userId;
      const { id } = req.params;
      const result = await settlementService.refundAdmission(adminUserId, id, req.body);
      res.status(200).json({
        success: true,
        data: result,
        message: 'Student refund processed successfully. Commission cancellation/clawback executed.'
      });
    } catch (err) {
      next(err);
    }
  }

  async getSettlements(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as SettlementStatus | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await settlementService.getSettlements({ status, page, limit });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  async getSettlementById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const settlement = await settlementService.getSettlementById(id);
      res.status(200).json({ success: true, data: settlement });
    } catch (err) {
      next(err);
    }
  }

  async generateSettlementBatch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminUserId = req.user!.userId;
      const result = await settlementService.generateSettlementBatch(adminUserId, req.body);
      res.status(201).json({
        success: true,
        data: result,
        message: `Successfully generated ${result.batchesCreated} partner settlement batch(es).`
      });
    } catch (err) {
      next(err);
    }
  }

  async disburseSettlement(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminUserId = req.user!.userId;
      const { id } = req.params;
      const result = await settlementService.disburseSettlement(adminUserId, id, req.body);
      res.status(200).json({
        success: true,
        data: result,
        message: `Bank payment disbursed successfully. Settlement marked as PAID with UTR: ${req.body.transactionRef}.`
      });
    } catch (err) {
      next(err);
    }
  }

  async getStats(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const stats = await settlementService.getStats();
      res.status(200).json({ success: true, data: stats });
    } catch (err) {
      next(err);
    }
  }

  async evaluateCoolingOff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const count = await settlementService.evaluateCoolingOffWindow();
      res.status(200).json({
        success: true,
        message: `Evaluated cooling-off window: ${count} commissions transitioned to ELIGIBLE.`
      });
    } catch (err) {
      next(err);
    }
  }
}

export const settlementController = new SettlementController();
