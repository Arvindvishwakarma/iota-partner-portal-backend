import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { salesService } from '../services/sales.service';

export class SalesController {
  async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const role = req.user!.role;
      const data = await salesService.getDashboard(salespersonId, role);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getPremises(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const role = req.user!.role;
      const city = req.query.city as string | undefined;
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;

      const premises = await salesService.getPremises(salespersonId, role, { city, search, status });
      res.status(200).json({ success: true, data: premises });
    } catch (err) {
      next(err);
    }
  }

  async checkIn(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const { premisesId } = req.params;
      const visit = await salesService.checkIn(salespersonId, premisesId, req.body);
      res.status(200).json({
        success: true,
        data: visit,
        message: `Checked in successfully at ${visit.premises.premisesName}. Visit timer started.`
      });
    } catch (err) {
      next(err);
    }
  }

  async checkOut(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const { visitId } = req.params;
      const visit = await salesService.checkOut(salespersonId, visitId, req.body);
      res.status(200).json({
        success: true,
        data: visit,
        message: 'Visit checked out and outcome recorded successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const { id } = req.params;
      const visit = await salesService.updateVisitStatus(salespersonId, id, req.body);
      res.status(200).json({
        success: true,
        data: visit,
        message: 'Premises visit status updated successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  async onboardPartner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const partner = await salesService.onboardPartner(salespersonId, req.body);
      res.status(201).json({
        success: true,
        data: partner,
        message: `Partner '${partner.businessName}' onboarded successfully with Code ${partner.partnerCode}!`
      });
    } catch (err) {
      next(err);
    }
  }

  async getLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const salespersonId = req.user!.userId;
      const role = req.user!.role;
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await salesService.getLeads(salespersonId, role, { search, status, page, limit });
      res.status(200).json({ success: true, data: result.leads, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }
}

export const salesController = new SalesController();

