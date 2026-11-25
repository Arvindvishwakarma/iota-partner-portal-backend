import { Request, Response, NextFunction } from 'express';
import { leadService } from '../services/lead.service';
import { partnerService } from '../services/partner.service';
import { whatsappOtpService } from '../services/whatsapp-otp.service';
import { emailOtpService } from '../services/email-otp.service';
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
        message: 'Affiliate application submitted successfully. Your profile is currently pending approval.'
      });
    } catch (err) {
      next(err);
    }
  }

  async sendWhatsAppOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone } = req.body;
      const result = await whatsappOtpService.sendOtp(phone);
      res.status(200).json({
        success: true,
        message: result.message,
        cooldown: result.cooldown,
        debugOtp: result.debugOtp
      });
    } catch (err) {
      next(err);
    }
  }

  async verifyWhatsAppOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, otp } = req.body;
      const result = await whatsappOtpService.verifyOtp(phone, otp);
      res.status(200).json({
        success: true,
        verified: true,
        verificationToken: result.verificationToken,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async sendEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      const result = await emailOtpService.sendOtp(email);
      res.status(200).json({
        success: true,
        message: result.message,
        cooldown: result.cooldown,
        debugOtp: result.debugOtp
      });
    } catch (err) {
      next(err);
    }
  }

  async verifyEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp } = req.body;
      const result = await emailOtpService.verifyOtp(email, otp);
      res.status(200).json({
        success: true,
        verified: true,
        verificationToken: result.verificationToken,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async getWhatsAppStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await whatsappOtpService.getWhatsAppStatus();
      res.status(200).json({
        success: true,
        data: status
      });
    } catch (err) {
      next(err);
    }
  }

  async submitContactMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, phone, category, subject, message } = req.body;
      const year = new Date().getFullYear();
      const count = await prisma.contactMessage.count();
      const refCode = `INQ-${year}-${(count + 101).toString().padStart(5, '0')}`;

      // Persist contact enquiry in database
      const savedMessage = await prisma.contactMessage.create({
        data: {
          referenceCode: refCode,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          category,
          subject: subject.trim(),
          message: message.trim(),
          status: 'NEW'
        }
      });

      console.log(`[Contact Enquiry ${refCode}] From: ${name} (${email}, ${phone}) | Category: ${category} | Subject: ${subject}`);

      try {
        const admins = await prisma.user.findMany({
          where: { role: 'ADMIN', isActive: true },
          select: { id: true }
        });
        if (admins.length > 0) {
          await prisma.notification.createMany({
            data: admins.map((a) => ({
              userId: a.id,
              title: `New Contact Enquiry [${refCode}]: ${subject}`,
              message: `${name} (${phone}, ${email}) submitted an enquiry under "${category}": ${message.slice(0, 150)}...`,
              actionUrl: '/admin/contacts'
            }))
          });
        }
      } catch (logErr) {
        console.warn('Could not persist admin notification for enquiry:', logErr);
      }

      res.status(200).json({
        success: true,
        data: {
          referenceCode: refCode,
          id: savedMessage.id
        },
        message: 'Thank you! Your message has been received. Our team will get back to you shortly.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export const publicController = new PublicController();

