import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import courseRoutes from './course.routes.js';
import lessonRoutes from './lesson.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import paymentRoutes from './payment.routes.js';
import eventRoutes from './event.routes.js';
import blogRoutes from './blog.routes.js';

export const apiRoutes = Router();

apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/users', userRoutes);
apiRoutes.use('/courses', courseRoutes);
apiRoutes.use('/courses/:courseId/lessons', lessonRoutes);
apiRoutes.use('/subscriptions', subscriptionRoutes);
apiRoutes.use('/payments', paymentRoutes);
apiRoutes.use('/events', eventRoutes);
apiRoutes.use('/blog', blogRoutes);
