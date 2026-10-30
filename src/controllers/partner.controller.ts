import { Response, NextFunction } from 'express';
import { partnerService } from '../services/partner.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { AppError } from '../middlewares/error.middleware';
import { LeadStatus } from '../shared';

export class PartnerController {
  private getPartnerId(req: AuthenticatedRequest): string {
    const partnerId = req.user?.partnerId;
    if (!partnerId) {
      throw new AppError('Authenticated user does not have a linked partner profile', 403, 'FORBIDDEN');
    }
    return partnerId;
  }

  async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const partnerId = this.getPartnerId(req);
      const data = await partnerService.getDashboard(partnerId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getQrAssets(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const partnerId = this.getPartnerId(req);
      const assets = await partnerService.getQrAssets(partnerId);
      res.status(200).json({ success: true, data: assets });
    } catch (err) {
      next(err);
    }
  }

  async getLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const partnerId = this.getPartnerId(req);
      const status = req.query.status as LeadStatus | undefined;
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await partnerService.getLeads(partnerId, status, search, page, limit);
      res.status(200).json({ success: true, data: result.leads, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getCommissions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const partnerId = this.getPartnerId(req);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await partnerService.getCommissions(partnerId, page, limit);
      res.status(200).json({ success: true, data: result.commissions, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getSettlements(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const partnerId = this.getPartnerId(req);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await partnerService.getSettlements(partnerId, page, limit);
      res.status(200).json({ success: true, data: result.settlements, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async createTicket(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const partnerId = this.getPartnerId(req);
      const userId = req.user!.userId;
      const ticket = await partnerService.createTicket(partnerId, userId, req.body);
      res.status(201).json({ success: true, data: ticket, message: 'Support ticket raised successfully' });
    } catch (err) {
      next(err);
    }
  }
}

export const partnerController = new PartnerController();

