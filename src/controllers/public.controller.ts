import { Request, Response, NextFunction } from 'express';
import { leadService } from '../services/lead.service';
import { partnerService } from '../services/partner.service';
import { prisma } from '../config/prisma';

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

  async submitContactMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, phone, category, subject, message } = req.body;
      const refCode = `INQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      console.log(`[Contact Inquiry ${refCode}] From: ${name} (${email}, ${phone}) | Category: ${category} | Subject: ${subject}`);

      try {
        const admins = await prisma.user.findMany({
          where: { role: 'ADMIN', status: 'ACTIVE' },
          select: { id: true }
        });
        if (admins.length > 0) {
          await prisma.notification.createMany({
            data: admins.map((a) => ({
              userId: a.id,
              title: `New Inquiry [${refCode}]: ${subject}`,
              message: `${name} (${phone}, ${email}) submitted an inquiry under "${category}": ${message.slice(0, 150)}...`,
              type: 'SYSTEM',
              isRead: false
            }))
          });
        }
      } catch (logErr) {
        console.warn('Could not persist admin notification for inquiry:', logErr);
      }

      res.status(200).json({
        success: true,
        data: { referenceCode: refCode },
        message: 'Thank you! Your message has been received. Our team will get back to you shortly.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export const publicController = new PublicController();

