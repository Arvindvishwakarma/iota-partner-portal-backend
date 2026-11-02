import { Response, NextFunction } from 'express';
import { adminService } from '../services/admin.service';
import { salesService } from '../services/sales.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { PartnerCategory, PartnerStatus, PremisesStatus, Role, VisitStatus } from '../shared';

export class AdminController {
  async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = await adminService.getDashboardMetrics();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  // Staff Handlers
  async listStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const role = req.query.role as Role | undefined;
      const search = req.query.search as string | undefined;
      const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await adminService.listStaff(role, search, isActive, page, limit);
      res.status(200).json({ success: true, data: result.staff, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async createStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await adminService.createStaff(req.body);
      res.status(201).json({ success: true, data: user, message: 'Staff user created successfully' });
    } catch (err) {
      next(err);
    }
  }

  async updateStaffStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const user = await adminService.updateStaffStatus(id, isActive);
      res.status(200).json({ success: true, data: user, message: 'Staff status updated successfully' });
    } catch (err) {
      next(err);
    }
  }

  async updateStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = await adminService.updateStaff(id, req.body);
      res.status(200).json({ success: true, data: user, message: 'Staff details updated successfully' });
    } catch (err) {
      next(err);
    }
  }

  async resetStaffPassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { password } = req.body;
      const result = await adminService.resetStaffPassword(id, password);
      res.status(200).json({ success: true, data: result, message: 'Staff password updated successfully' });
    } catch (err) {
      next(err);
    }
  }

  // Partner Handlers
  async listPartners(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as PartnerStatus | undefined;
      const category = req.query.category as PartnerCategory | undefined;
      const search = req.query.search as string | undefined;
      const city = req.query.city as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await adminService.listPartners(status, category, search, city, page, limit);
      res.status(200).json({ success: true, data: result.partners, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getPartner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const partner = await adminService.getPartnerDetails(id);
      res.status(200).json({ success: true, data: partner });
    } catch (err) {
      next(err);
    }
  }

  async reviewPartner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, rejectionReason } = req.body;
      const updated = await adminService.reviewPartner(id, status, rejectionReason);
      res.status(200).json({
        success: true,
        data: updated,
        message: status === PartnerStatus.ACTIVE ? 'Partner approved and unique ID generated' : 'Partner registration rejected'
      });
    } catch (err) {
      next(err);
    }
  }

  async resetPartnerPassword(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { password } = req.body;
      const result = await adminService.resetPartnerPassword(id, password);
      res.status(200).json({
        success: true,
        data: { partnerId: id, email: result.email, updated: true },
        message: 'Partner password updated successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  async onboardPartner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminId = req.user!.userId;
      const partner = await salesService.onboardPartner(adminId, req.body);
      res.status(201).json({
        success: true,
        data: partner,
        message: `Partner '${partner.businessName}' onboarded successfully with Code ${partner.partnerCode}!`
      });
    } catch (err) {
      next(err);
    }
  }

  // Premises Handlers
  async listPremises(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as PremisesStatus | undefined;
      const category = req.query.category as PartnerCategory | undefined;
      const search = req.query.search as string | undefined;
      const city = req.query.city as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await adminService.listPremises(status, category, search, city, page, limit);
      res.status(200).json({ success: true, data: result.premises, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async createPremises(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const premises = await adminService.createPremises(req.body);
      res.status(201).json({ success: true, data: premises, message: 'Premises created successfully' });
    } catch (err) {
      next(err);
    }
  }

  async updatePremises(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updated = await adminService.updatePremises(id, req.body);
      res.status(200).json({ success: true, data: updated, message: 'Premises updated successfully' });
    } catch (err) {
      next(err);
    }
  }

  async assignVisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { premisesId, salespersonId, scheduledDate } = req.body;
      if (!salespersonId || salespersonId === 'UNASSIGN') {
        const result = await adminService.unassignPremisesVisit(premisesId);
        return res.status(200).json({ success: true, data: result, message: 'Premises unassigned successfully' });
      }
      const visit = await adminService.assignPremisesVisit(premisesId, salespersonId, scheduledDate);
      res.status(200).json({ success: true, data: visit, message: 'Premises visit assigned successfully' });
    } catch (err) {
      next(err);
    }
  }

  async unassignVisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { premisesId } = req.body;
      const result = await adminService.unassignPremisesVisit(premisesId);
      res.status(200).json({ success: true, data: result, message: 'Premises unassigned successfully' });
    } catch (err) {
      next(err);
    }
  }

  async bulkAssignVisits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { premisesIds, salespersonId, scheduledDate } = req.body;
      const result = await adminService.bulkAssignVisits(premisesIds, salespersonId, scheduledDate);
      res.status(200).json({ success: true, data: result, message: `${result.assignedCount} visits assigned successfully` });
    } catch (err) {
      next(err);
    }
  }

  async listVisits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;

      const result = await adminService.listAllVisits(req.query, page, limit);
      res.status(200).json({ success: true, data: result.visits, stats: result.stats, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  // Lead Handlers
  async listLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await adminService.listAllLeads(req.query, page, limit);
      res.status(200).json({ success: true, data: result.leads, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async reassignLead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { counsellorId, remarks } = req.body;
      const adminUserId = req.user!.userId;

      const updated = await adminService.reassignLead(id, counsellorId, adminUserId, remarks);
      res.status(200).json({ success: true, data: updated, message: 'Lead reassigned successfully' });
    } catch (err) {
      next(err);
    }
  }
}

export const adminController = new AdminController();

