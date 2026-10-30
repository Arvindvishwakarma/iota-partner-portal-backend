import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import publicRoutes from './public.routes';
import partnerRoutes from './partner.routes';
import counsellorRoutes from './counsellor.routes';
import salesRoutes from './sales.routes';
import settlementRoutes from './settlement.routes';
import notificationRoutes from './notification.routes';
import reportRoutes from './report.routes';

const apiRouter = Router();

// Mount Health Check under /api/v1/health
apiRouter.use('/health', healthRoutes);

// Mount Public Intake & Verification endpoints under /api/v1/public
apiRouter.use('/public', publicRoutes);

// Mount Auth endpoints under /api/v1/auth
apiRouter.use('/auth', authRoutes);

// Mount Admin endpoints under /api/v1/admin
apiRouter.use('/admin', adminRoutes);

// Mount Partner Portal endpoints under /api/v1/partner
apiRouter.use('/partner', partnerRoutes);

// Mount Counselor CRM endpoints under /api/v1/counsellor
apiRouter.use('/counsellor', counsellorRoutes);

// Mount Field Sales Module endpoints under /api/v1/sales
apiRouter.use('/sales', salesRoutes);

// Mount Settlement & Admissions Engine under /api/v1/settlements
apiRouter.use('/settlements', settlementRoutes);

// Mount Central Notification Hub under /api/v1/notifications
apiRouter.use('/notifications', notificationRoutes);

// Mount Reports & Analytics under /api/v1/reports
apiRouter.use('/reports', reportRoutes);

export default apiRouter;

