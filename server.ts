import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { 
  startSynthesisJob, 
  startMslPlanJob, 
  startPS01PlanJob, 
  getJob 
} from "./src/services/metallizer/serverJobManager";
import {
  startSynthesisJob as startSSSynthesisJob,
  startSSPlanJob,
  startPS01PlanJob as startSSPS01PlanJob,
  getJob as getSSJob
} from "./src/services/ss/ssServerJobManager";

async function startServer() {
  const app = express();
  const PORT = 3002;

  app.use(express.json({ limit: "25mb" }));

  // API Route: Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Route: Generic Job Polling Status endpoint
  app.get("/api/metallizer/jobs/:jobId", (req, res) => {
    try {
      const { jobId } = req.params;
      const job = getJob(jobId);
      if (!job) {
        return res.status(404).json({ success: false, error: "Job not found or expired" });
      }
      return res.json({
        success: true,
        job: {
          id: job.id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          currentStage: job.currentStage,
          result: job.status === "COMPLETED" ? job.result : undefined,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  // API Route: Start or fetch Synthesize Jumbo Requirements & PS01 Handshake Job
  app.post("/api/metallizer/synthesize-requirements", (req, res) => {
    try {
      const { orders, settings, film } = req.body;
      if (!orders || !Array.isArray(orders)) {
        return res.status(400).json({ error: "Missing or invalid orders array" });
      }

      const job = startSynthesisJob(orders, settings, film);

      if (job.status === "COMPLETED") {
        return res.json({
          success: true,
          status: "COMPLETED",
          jobId: job.id,
          requirements: job.result.requirements,
          count: job.result.count,
          cached: true,
        });
      }

      return res.json({
        success: true,
        status: job.status,
        jobId: job.id,
        progress: job.progress,
        currentStage: job.currentStage,
      });
    } catch (err: any) {
      console.error("Error in /api/metallizer/synthesize-requirements:", err);
      return res.status(500).json({
        error: "Failed to initialize synthesis job",
        message: err?.message || String(err),
      });
    }
  });

  // API Route: Generate Metallizer Slitter Plans against Mother Roll Inventory
  app.post("/api/metallizer/generate-plans", (req, res) => {
    try {
      const { orders, jumboRolls, settings, film } = req.body;
      if (!orders || !Array.isArray(orders)) {
        return res.status(400).json({ error: "Missing or invalid orders array" });
      }

      const job = startMslPlanJob(orders, jumboRolls || [], settings, film);

      if (job.status === "COMPLETED") {
        return res.json({
          success: true,
          status: "COMPLETED",
          jobId: job.id,
          ...job.result,
          cached: true,
        });
      }

      return res.json({
        success: true,
        status: job.status,
        jobId: job.id,
        progress: job.progress,
        currentStage: job.currentStage,
      });
    } catch (err: any) {
      console.error("Error in /api/metallizer/generate-plans:", err);
      return res.status(500).json({
        error: "Failed to initialize MSL planning job",
        message: err?.message || String(err),
      });
    }
  });

  // API Route: Generate PS01 Manufacturing Plans for Jumbos
  app.post("/api/metallizer/generate-ps01-plans", (req, res) => {
    try {
      const { requirements, film, userName } = req.body;
      if (!requirements || !Array.isArray(requirements)) {
        return res.status(400).json({ error: "Missing or invalid requirements array" });
      }

      const job = startPS01PlanJob(requirements, film, userName);

      if (job.status === "COMPLETED") {
        return res.json({
          success: true,
          status: "COMPLETED",
          jobId: job.id,
          plans: job.result.plans,
          logs: job.result.logs,
          cached: true,
        });
      }

      return res.json({
        success: true,
        status: job.status,
        jobId: job.id,
        progress: job.progress,
        currentStage: job.currentStage,
      });
    } catch (err: any) {
      console.error("Error in /api/metallizer/generate-ps01-plans:", err);
      return res.status(500).json({
        error: "Failed to initialize PS01 planning job",
        message: err?.message || String(err),
      });
    }
  });

  // ==========================================
  // SECONDARY SLITTER (SS) MODULE API ROUTES
  // ==========================================

  // SS Job Polling Status endpoint
  app.get("/api/ss/jobs/:jobId", (req, res) => {
    try {
      const { jobId } = req.params;
      const job = getSSJob(jobId);
      if (!job) {
        return res.status(404).json({ success: false, error: "Job not found or expired" });
      }
      return res.json({
        success: true,
        job: {
          id: job.id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          currentStage: job.currentStage,
          result: job.status === "COMPLETED" ? job.result : undefined,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  // SS Synthesize Jumbo Requirements & PS01 Handshake Job
  app.post("/api/ss/synthesize-requirements", (req, res) => {
    try {
      const { orders, settings, film } = req.body;
      if (!orders || !Array.isArray(orders)) {
        return res.status(400).json({ error: "Missing or invalid orders array" });
      }

      const job = startSSSynthesisJob(orders, settings, film);

      if (job.status === "COMPLETED") {
        return res.json({
          success: true,
          status: "COMPLETED",
          jobId: job.id,
          requirements: job.result.requirements,
          count: job.result.count,
          cached: true,
        });
      }

      return res.json({
        success: true,
        status: job.status,
        jobId: job.id,
        progress: job.progress,
        currentStage: job.currentStage,
      });
    } catch (err: any) {
      console.error("Error in /api/ss/synthesize-requirements:", err);
      return res.status(500).json({
        error: "Failed to initialize SS synthesis job",
        message: err?.message || String(err),
      });
    }
  });

  // SS Generate Slitter Plans against Mother Roll Inventory
  app.post("/api/ss/generate-plans", (req, res) => {
    try {
      const { orders, jumboRolls, settings, film } = req.body;
      if (!orders || !Array.isArray(orders)) {
        return res.status(400).json({ error: "Missing or invalid orders array" });
      }

      const job = startSSPlanJob(orders, jumboRolls || [], settings, film);

      if (job.status === "COMPLETED") {
        return res.json({
          success: true,
          status: "COMPLETED",
          jobId: job.id,
          ...job.result,
          cached: true,
        });
      }

      return res.json({
        success: true,
        status: job.status,
        jobId: job.id,
        progress: job.progress,
        currentStage: job.currentStage,
      });
    } catch (err: any) {
      console.error("Error in /api/ss/generate-plans:", err);
      return res.status(500).json({
        error: "Failed to initialize SS planning job",
        message: err?.message || String(err),
      });
    }
  });

  // SS Generate PS01 Manufacturing Plans for Jumbos
  app.post("/api/ss/generate-ps01-plans", (req, res) => {
    try {
      const { requirements, film, userName } = req.body;
      if (!requirements || !Array.isArray(requirements)) {
        return res.status(400).json({ error: "Missing or invalid requirements array" });
      }

      const job = startSSPS01PlanJob(requirements, film, userName);

      if (job.status === "COMPLETED") {
        return res.json({
          success: true,
          status: "COMPLETED",
          jobId: job.id,
          plans: job.result.plans,
          logs: job.result.logs,
          cached: true,
        });
      }

      return res.json({
        success: true,
        status: job.status,
        jobId: job.id,
        progress: job.progress,
        currentStage: job.currentStage,
      });
    } catch (err: any) {
      console.error("Error in /api/ss/generate-ps01-plans:", err);
      return res.status(500).json({
        error: "Failed to initialize SS PS01 planning job",
        message: err?.message || String(err),
      });
    }
  });

  // Vite middleware setup (development vs production)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { port: 24680 } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Production-ready Full-Stack Server running on port ${PORT}`);
  });
}

startServer();


