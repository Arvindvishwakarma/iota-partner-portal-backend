import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { counsellorService } from '../services/counsellor.service';
import { LeadStatus } from '../shared';

export class CounsellorController {
  async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const data = await counsellorService.getDashboard(counsellorId, role);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const status = req.query.status as LeadStatus | undefined;
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await counsellorService.getLeads(counsellorId, role, { status, search, page, limit });
      res.status(200).json({ success: true, data: result.leads, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getLeadById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const { id } = req.params;
      const lead = await counsellorService.getLeadById(counsellorId, id, role);
      res.status(200).json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  }

  async logActivity(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const { id } = req.params;
      const activity = await counsellorService.logActivity(counsellorId, id, role, req.body);
      res.status(201).json({ success: true, data: activity, message: 'Outreach activity recorded successfully' });
    } catch (err) {
      next(err);
    }
  }

  async updateLeadStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const { id } = req.params;
      const updated = await counsellorService.updateLeadStatus(counsellorId, id, role, req.body);
      res.status(200).json({ success: true, data: updated, message: 'Lead status updated successfully' });
    } catch (err) {
      next(err);
    }
  }

  async convertAdmission(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const { id } = req.params;
      const result = await counsellorService.convertAdmission(counsellorId, id, role, req.body);
      res.status(201).json({
        success: true,
        data: result,
        message: `Lead converted to confirmed admission (${result.admission.admissionCode}) successfully!`
      });
    } catch (err) {
      next(err);
    }
  }

  async getFollowups(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const counsellorId = req.user!.userId;
      const role = req.user!.role;
      const followups = await counsellorService.getFollowups(counsellorId, role);
      res.status(200).json({ success: true, data: followups });
    } catch (err) {
      next(err);
    }
  }

  async getCourses(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courses = await counsellorService.getCourses();
      res.status(200).json({ success: true, data: courses });
    } catch (err) {
      next(err);
    }
  }
}

export const counsellorController = new CounsellorController();

