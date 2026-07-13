import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_DIR } from '../config';
import { JobController } from '../controllers/job.controller';

const router = Router();

// Multer config for temporary file storage
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max limit
});

/**
 * REST API endpoint routing table
 * Delegates request context and execution to JobController
 */
router.post('/upload', upload.array('files'), JobController.uploadFiles);
router.post('/process', JobController.processJob);
router.get('/status/:jobId', JobController.getJobStatus);
router.get('/download/:jobId', JobController.downloadPresentation);
router.post('/jobs/:jobId/cancel', JobController.cancelJob);

export default router;
