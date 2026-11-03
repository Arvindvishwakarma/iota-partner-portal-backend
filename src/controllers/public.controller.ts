import { Request, Response, NextFunction } from 'express';
import { leadService } from '../services/lead.service';
import { partnerService } from '../services/partner.service';

export class PublicController {
  async verifyPartner(req: Request, res: Response, next: NextFunction) {
    try {
      const { partnerCode } = req.params;
      const partner = await leadService.verifyPartnerCode(partnerCode);
      res.status(200).json({ success: true, data: partner });
    } catch (err) {
      next(err);
    }
  }

  async getCourses(req: Request, res: Response, next: NextFunction) {
    try {
      const courses = await leadService.getActiveCourses();
      res.status(200).json({ success: true, data: courses });
    } catch (err) {
      next(err);
    }
  }

  async submitLead(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await leadService.submitPublicLead(req.body);
      res.status(201).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async registerPartner(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await partnerService.registerPublicPartner(req.body);
      res.status(201).json({
        success: true,
        data: result,
        message: 'Your affiliate application has been submitted successfully! Our team will contact you shortly to activate your dashboard.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export const publicController = new PublicController();

