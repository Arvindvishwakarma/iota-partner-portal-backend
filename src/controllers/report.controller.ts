import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { reportService } from '../services/report.service';
import { Role } from '../shared';
import { ExportQueryInput, ReportFilterInput } from '../validators/report.validator';

export class ReportController {
  async getOverview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const filters: ReportFilterInput = {
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        city: req.query.city as string | undefined,
        partnerId: req.query.partnerId as string | undefined,
        counsellorId: req.query.counsellorId as string | undefined
      };

      const data = await reportService.getOverviewAnalytics(filters);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getPartnerRoi(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const data = await reportService.getPartnerRoiReport(limit);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getCounsellorPerformance(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = await reportService.getCounsellorPerformanceReport();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getSalesPerformance(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = await reportService.getSalespersonPerformanceReport();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async exportCsv(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const type = (req.query.type as string) || 'leads';
      const userRole = req.user?.role;
      const maskPii = userRole !== Role.ADMIN && userRole !== Role.COUNSELLOR;

      const exportQuery: ExportQueryInput = {
        type: type as any,
        format: 'csv',
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        city: req.query.city as string | undefined,
        status: req.query.status as string | undefined
      };

      if (type === 'settlements') {
        await reportService.streamSettlementsCsv(res, exportQuery);
      } else {
        await reportService.streamLeadsCsv(res, exportQuery, maskPii);
      }
    } catch (err) {
      next(err);
    }
  }
}

export const reportController = new ReportController();

