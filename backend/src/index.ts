import express from 'express';
import cors from 'cors';
import { PORT } from './config';
import uploadRouter from './routes/upload';
import jobsRouter from './routes/jobs';
import coreRouter from './routes/core';
import { triggerWorker } from './queue';

const app = express();

// Configure Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Register Core APIs (STEP 7: support root endpoints and api sub-routes)
app.use('/api', coreRouter);
app.use('/', coreRouter);

// Register additional dashboard/workspace management APIs
app.use('/api/upload', uploadRouter);
app.use('/api/jobs', jobsRouter);

// Base Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Start Background Worker Queue on launch (resumes pending tasks)
triggerWorker();

// Start Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`  AI Math Question Splitter Server Running       `);
  console.log(`  URL: http://localhost:${PORT}                  `);
  console.log(`  Uptime start: ${new Date().toISOString()}      `);
  console.log(`=================================================`);
});
