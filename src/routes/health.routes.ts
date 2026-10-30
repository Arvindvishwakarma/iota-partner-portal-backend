import { Router, Request, Response } from 'express';
import { APP_NAME, APP_ORGANIZATION } from '../shared';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      application: APP_NAME,
      organization: APP_ORGANIZATION,
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development'
    },
    message: 'IOTA Partner Portal Backend Service Operational'
  });
});

export default router;

