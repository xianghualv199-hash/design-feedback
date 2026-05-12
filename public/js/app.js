// ====== Utility ======
function getBaseUrl() {
  return window.location.origin;
}
function showToast(msg, duration) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.style.display = 'none', duration || 2500);
}
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function getImageNaturalSize(img) {
  return { w: img.naturalWidth, h: img.naturalHeight };
}

// ====== Dashboard ======
async function loadDashboard() {
  const listEl = document.getElementById('project-list');
  const emptyEl = document.getElementById('empty-state');
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    if (projects.length === 0) {
      listEl.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }
    listEl.style.display = 'grid';
    emptyEl.style.display = 'none';
    listEl.innerHTML = projects.map(p => `
      <div class="project-card" onclick="location.href='/project?id=${p.id}'">
        <img class="project-thumb" src="${p.imagePath}" alt="${p.title}"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22200%22><rect fill=%22%23eee%22 width=%22300%22 height=%22200%22/><text x=%22150%22 y=%22110%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2232%22>🎨</text></svg>'">
        <div class="project-info">
          <h3>${escHtml(p.title)}</h3>
          <div class="project-meta">
            <span>👤 ${escHtml(p.clientName)}</span>
            <span>${formatDate(p.createdAt)}</span>
          </div>
          <div class="project-stats">
            <span class="stat">💬 ${p.annotationCount} 条批注</span>
            ${p.unresolvedCount > 0 ? `<span class="stat-unresolved">🔴 ${p.unresolvedCount} 条待处理</span>` : '<span class="stat">✅ 已全部处理</span>'}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="loading" style="color:red">加载失败，请确认服务已启动</div>';
  }
}
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ====== Upload ======
function initUploadForm() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('drop-preview');
  const previewImg = document.getElementById('preview-img');
  const dropText = dropZone.querySelector('.drop-zone-text');
  const submitBtn = document.getElementById('submit-btn');
  const form = document.getElementById('upload-form');
  const resultCard = document.getElementById('result-card');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });

  document.getElementById('change-file-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    fileInput.value = '';
    dropText.style.display = 'block';
    preview.style.display = 'none';
    submitBtn.disabled = true;
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      previewImg.src = e.target.result;
      dropText.style.display = 'none';
      preview.style.display = 'flex';
      submitBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = '上传中...';

    const fd = new FormData(form);
    try {
      const res = await fetch('/api/projects', { method: 'POST', body: fd });
      const project = await res.json();
      if (res.ok) {
        form.style.display = 'none';
        resultCard.style.display = 'block';
        const link = `${getBaseUrl()}/review?token=${project.shareToken}`;
        document.getElementById('share-link').value = link;
        window._lastProject = project;
      } else {
        showToast(project.error || '上传失败');
        submitBtn.disabled = false;
        submitBtn.textContent = '上传并生成链接';
      }
    } catch (e) {
      showToast('上传失败，请检查网络');
      submitBtn.disabled = false;
      submitBtn.textContent = '上传并生成链接';
    }
  });
}

function copyShareLink() {
  const input = document.getElementById('share-link') || document.getElementById('project-share-link');
  if (!input) return;
  input.select();
  navigator.clipboard?.writeText(input.value).catch(() => {});
  showToast('已复制链接！');
}

function openReviewPage() {
  const p = window._lastProject;
  if (!p) {
    // Try from project page
    const input = document.getElementById('project-share-link');
    if (input) window.open(input.value, '_blank');
    return;
  }
  window.open(`${getBaseUrl()}/review?token=${p.shareToken}`, '_blank');
}

// ====== Review Page (Client-facing) ======
let reviewState = {
  project: null,
  annotations: [],
  dialogPos: null,
  currentFilter: 'all'
};

async function initReviewPage() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    document.getElementById('review-title').textContent = '链接无效';
    return;
  }
  try {
    const res = await fetch(`/api/share/${token}`);
    if (!res.ok) throw new Error('Not found');
    reviewState.project = await res.json();
    reviewState.annotations = reviewState.project.annotations || [];
    renderReview();
  } catch (e) {
    document.getElementById('review-title').textContent = '项目不存在或链接已失效';
    document.getElementById('image-loading').textContent = '❌ 请检查链接是否正确';
  }
}

function renderReview() {
  const p = reviewState.project;
  document.getElementById('review-title').textContent = p.title;
  document.getElementById('review-client').textContent = `客户：${p.clientName}`;
  document.getElementById('annotation-count').textContent = `${p.annotations.length} 条批注`;
  document.getElementById('sidebar-count').textContent = p.annotations.length;

  const img = document.getElementById('review-image');
  const loading = document.getElementById('image-loading');

  img.onload = () => {
    loading.style.display = 'none';
    img.style.display = 'block';
    renderPins('pins-container', reviewState.annotations, onClickPin);
  };
  img.onerror = () => {
    loading.textContent = '❌ 图片加载失败';
  };
  img.src = p.imagePath;

  // Click on image to add pin
  const wrapper = document.getElementById('image-wrapper');
  wrapper.addEventListener('click', e => {
    if (e.target !== img && !e.target.closest('.pin')) return;
    if (e.target.closest('.pin')) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    reviewState.dialogPos = { x, y };
    showCommentDialog();
  });

  renderAnnotationsList('annotations-list', reviewState.annotations, onClickPin);
}

function onClickPin(annotation) {
  // Highlight in sidebar
  document.querySelectorAll('.annotation-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById(`anno-${annotation.id}`);
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function showCommentDialog() {
  const author = localStorage.getItem('review_author') || '';
  document.getElementById('dialog-author').value = author;
  document.getElementById('dialog-comment').value = '';
  document.getElementById('comment-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('dialog-comment').focus(), 100);
}

function closeDialog() {
  document.getElementById('comment-dialog').style.display = 'none';
  reviewState.dialogPos = null;
}

async function submitAnnotation() {
  const comment = document.getElementById('dialog-comment').value.trim();
  const author = document.getElementById('dialog-author').value.trim() || '匿名';
  if (!comment) { showToast('请输入批注内容'); return; }
  if (!reviewState.dialogPos) return;

  localStorage.setItem('review_author', author);
  const token = new URLSearchParams(location.search).get('token');

  try {
    const res = await fetch(`/api/share/${token}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x: reviewState.dialogPos.x,
        y: reviewState.dialogPos.y,
        comment,
        author
      })
    });
    if (!res.ok) throw new Error('提交失败');
    const annotation = await res.json();
    reviewState.annotations.push(annotation);
    annotation._justAdded = true;
    closeDialog();
    renderReview();
    showToast('批注已添加 ✅');
  } catch (e) {
    showToast('提交失败，请重试');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('hidden');
  const btn = document.getElementById('toggle-sidebar-btn');
  if (sidebar.classList.contains('hidden')) {
    btn.textContent = '☰ 展开';
  } else {
    btn.textContent = '☰ 列表';
  }
}

// ====== Project Page (Designer) ======
let projectState = { id: null, project: null, annotations: [], currentFilter: 'all' };

async function initProjectPage() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { showToast('缺少项目 ID'); return; }
  projectState.id = id;
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const p = projects.find(x => x.id === id);
    if (!p) { showToast('项目不存在'); return; }
    // Load full detail
    const shareRes = await fetch(`/api/share/${p.shareToken}`);
    const full = await shareRes.json();
    projectState.project = full;
    projectState.annotations = full.annotations || [];

    document.getElementById('project-title').textContent = full.title;
    const link = `${getBaseUrl()}/review?token=${full.shareToken}`;
    document.getElementById('project-share-link').value = link;

    const img = document.getElementById('project-image');
    const loading = document.getElementById('project-image-loading');
    img.onload = () => {
      loading.style.display = 'none';
      img.style.display = 'block';
      renderPins('project-pins-container', projectState.annotations, onClickProjectPin, true);
    };
    img.onerror = () => { loading.textContent = '❌ 图片加载失败'; };
    img.src = full.imagePath;

    renderProjectAnnotations();
  } catch (e) {
    showToast('加载失败');
  }
}

function onClickProjectPin(annotation) {
  document.querySelectorAll('#project-annotations-list .annotation-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById(`panno-${annotation.id}`);
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function filterAnnotations(filter) {
  projectState.currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderProjectAnnotations();
}

function renderProjectAnnotations() {
  const filter = projectState.currentFilter;
  let list = projectState.annotations;
  if (filter === 'unresolved') list = list.filter(a => !a.resolved);
  if (filter === 'resolved') list = list.filter(a => a.resolved);
  document.getElementById('project-count').textContent = list.length;

  const container = document.getElementById('project-annotations-list');
  if (list.length === 0) {
    container.innerHTML = `<div class="loading" style="padding:20px;color:var(--text-secondary)">
      ${filter === 'unresolved' ? '🎉 全部已处理！' : filter === 'resolved' ? '暂无已处理的批注' : '暂无批注'}
    </div>`;
    return;
  }
  container.innerHTML = list.map(a => `
    <div class="annotation-item ${a.resolved ? 'resolved' : ''}" id="panno-${a.id}" onclick="onClickProjectPin(${JSON.stringify(a).replace(/"/g,'&quot;')})">
      <div class="annotation-header">
        <span class="annotation-dot" style="background:${a.color}"></span>
        <span class="annotation-author">${escHtml(a.author)}</span>
        <span class="annotation-time">${formatDate(a.createdAt)}</span>
      </div>
      <div class="annotation-comment">${escHtml(a.comment)}</div>
      <div class="annotation-actions">
        <button class="btn btn-sm" onclick="event.stopPropagation(); toggleResolve('${a.id}')">
          ${a.resolved ? '↩ 撤销' : '✅ 标记完成'}
        </button>
        <button class="btn btn-sm" onclick="event.stopPropagation(); deleteAnnotation('${a.id}')" style="color:var(--danger)">🗑 删除</button>
      </div>
    </div>
  `).join('');
}

async function toggleResolve(annotationId) {
  try {
    const res = await fetch(`/api/projects/${projectState.id}/annotations/${annotationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const updated = await res.json();
    const idx = projectState.annotations.findIndex(a => a.id === annotationId);
    if (idx >= 0) projectState.annotations[idx] = updated;

    // Re-render pins and list
    const img = document.getElementById('project-image');
    renderPins('project-pins-container', projectState.annotations, onClickProjectPin, true);
    renderProjectAnnotations();
  } catch (e) {
    showToast('操作失败');
  }
}

async function deleteAnnotation(annotationId) {
  if (!confirm('确定删除这条批注？')) return;
  try {
    await fetch(`/api/projects/${projectState.id}/annotations/${annotationId}`, { method: 'DELETE' });
    projectState.annotations = projectState.annotations.filter(a => a.id !== annotationId);
    renderPins('project-pins-container', projectState.annotations, onClickProjectPin, true);
    renderProjectAnnotations();
  } catch (e) {
    showToast('删除失败');
  }
}

async function deleteCurrentProject() {
  if (!confirm('确定删除整个项目？此操作不可撤销。')) return;
  try {
    await fetch(`/api/projects/${projectState.id}`, { method: 'DELETE' });
    location.href = '/';
  } catch (e) {
    showToast('删除失败');
  }
}

// ====== Shared: Pins Rendering ======
function renderPins(containerId, annotations, onClick, showResolvedState) {
  const container = document.getElementById(containerId);
  const img = containerId.includes('project') ?
    document.getElementById('project-image') :
    document.getElementById('review-image');
  if (!container || !img || !img.naturalWidth) return;

  container.style.position = 'absolute';
  container.style.inset = '0';
  container.style.pointerEvents = 'none';

  container.innerHTML = annotations.map((a, i) => `
    <div class="pin ${a.resolved ? 'resolved' : ''}"
         style="left:${(a.x * 100).toFixed(2)}%;top:${(a.y * 100).toFixed(2)}%;pointer-events:auto"
         onclick="event.stopPropagation(); (${onClick.toString()})(${JSON.stringify(a).replace(/"/g,'&quot;')})"
         title="${escHtml(a.comment)}">
      <div class="pin-tooltip">${escHtml(a.comment)}</div>
      <div class="pin-circle" style="background:${a.color}">
        <span class="pin-number">${i + 1}</span>
      </div>
    </div>
  `).join('');
}

function renderAnnotationsList(containerId, annotations, onClick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (annotations.length === 0) {
    container.innerHTML = '<div class="loading" style="padding:20px;color:var(--text-secondary)">点击图片添加批注</div>';
    return;
  }
  container.innerHTML = annotations.map((a, i) => `
    <div class="annotation-item" id="anno-${a.id}" onclick="(${onClick.toString()})(${JSON.stringify(a).replace(/"/g,'&quot;')})">
      <div class="annotation-header">
        <span class="annotation-dot" style="background:${a.color}"></span>
        <span class="annotation-author">${escHtml(a.author)}</span>
        <span class="annotation-time">${formatDate(a.createdAt)}</span>
      </div>
      <div class="annotation-comment">${escHtml(a.comment)}</div>
    </div>
  `).join('');
}
