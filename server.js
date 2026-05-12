const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Directories ----
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

// ---- Data helpers ----
function loadProjects() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch { return []; }
}
function saveProjects(projects) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}
function findProjectByShareToken(token) {
  return loadProjects().find(p => p.shareToken === token) || null;
}
function findProjectById(id) {
  return loadProjects().find(p => p.id === id) || null;
}
function genId() { return crypto.randomUUID(); }

// ---- Multer ----
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, genId() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(png|jpg|jpeg|gif|webp|pdf|bmp|tiff?)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('仅支持图片格式 (PNG/JPG/GIF/WEBP/BMP/TIFF)'));
  }
});

// ---- Middleware ----
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ---- API Routes ----

// List all projects
app.get('/api/projects', (req, res) => {
  const projects = loadProjects().map(p => ({
    id: p.id,
    title: p.title,
    clientName: p.clientName,
    imagePath: p.imagePath,
    shareToken: p.shareToken,
    createdAt: p.createdAt,
    annotationCount: (p.annotations || []).length,
    unresolvedCount: (p.annotations || []).filter(a => !a.resolved).length
  }));
  res.json(projects);
});

// Create project (upload)
app.post('/api/projects', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  if (!req.body.title) return res.status(400).json({ error: '请输入项目名称' });

  const project = {
    id: genId(),
    title: req.body.title,
    clientName: req.body.clientName || '未命名客户',
    imagePath: '/uploads/' + req.file.filename,
    shareToken: genId().slice(0, 12),
    createdAt: new Date().toISOString(),
    annotations: []
  };

  const projects = loadProjects();
  projects.unshift(project);
  saveProjects(projects);

  res.json(project);
});

// Get project by share token
app.get('/api/share/:token', (req, res) => {
  const project = findProjectByShareToken(req.params.token);
  if (!project) return res.status(404).json({ error: '项目不存在或链接已失效' });
  res.json({
    id: project.id,
    title: project.title,
    clientName: project.clientName,
    imagePath: project.imagePath,
    annotations: project.annotations || []
  });
});

// Add annotation
app.post('/api/share/:token/annotations', (req, res) => {
  const { x, y, comment, author } = req.body;
  if (x === undefined || y === undefined || !comment) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const projects = loadProjects();
  const project = projects.find(p => p.shareToken === req.params.token);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const annotation = {
    id: genId(),
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    comment: comment,
    author: author || '匿名',
    color: pickColor(project.annotations.length),
    createdAt: new Date().toISOString(),
    resolved: false
  };

  project.annotations.push(annotation);
  saveProjects(projects);
  res.json(annotation);
});

// Resolve / unresolve annotation
app.patch('/api/projects/:id/annotations/:annotationId', (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const annotation = (project.annotations || []).find(a => a.id === req.params.annotationId);
  if (!annotation) return res.status(404).json({ error: '批注不存在' });

  annotation.resolved = req.body.resolved !== undefined ? req.body.resolved : !annotation.resolved;
  saveProjects(projects);
  res.json(annotation);
});

// Delete annotation
app.delete('/api/projects/:id/annotations/:annotationId', (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  project.annotations = (project.annotations || []).filter(a => a.id !== req.params.annotationId);
  saveProjects(projects);
  res.json({ ok: true });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  let projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  // Delete image file
  const filename = path.basename(project.imagePath);
  const filepath = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  projects = projects.filter(p => p.id !== req.params.id);
  saveProjects(projects);
  res.json({ ok: true });
});

// ---- Serve frontend pages ----
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/upload', (req, res) => res.sendFile(path.join(__dirname, 'public', 'upload.html')));
app.get('/review', (req, res) => res.sendFile(path.join(__dirname, 'public', 'review.html')));
app.get('/project', (req, res) => res.sendFile(path.join(__dirname, 'public', 'project.html')));

// Color palette
const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA'
];
function pickColor(index) { return COLORS[index % COLORS.length]; }

// Error handling
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件太大，最大 100MB' });
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`✅ 设计批注工具已启动！`);
  console.log(`   本地访问: http://localhost:${PORT}`);
});
