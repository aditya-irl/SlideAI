import { Router } from 'express';
import { JobController } from '../controllers/job.controller';

const router = Router();

/**
 * Dashboard & Editor helper routing table
 * Delegates all request contexts directly to JobController
 */
router.get('/', JobController.getJobsList);
router.get('/:id', JobController.getJobDetail);
router.get('/:id/questions', JobController.getQuestionsList);
router.put('/:id/questions', JobController.updateQuestions);
router.delete('/:id', JobController.deleteJob);
router.get('/:id/diagrams/:filename', JobController.serveDiagram);
router.get('/:id/pages/:filename', JobController.servePageImage);
router.get('/:id/pages', JobController.getPagesList);
router.get('/:id/progress', JobController.getProgressSse);

export default router;
